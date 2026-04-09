import {validateHostPrivilegedActionRequest} from "@anikitenko/fdo-sdk";
import {clipboard as electronClipboard} from "electron";
import {spawn} from "node:child_process";
import crypto from "node:crypto";
import {appendFile, mkdir, readFile, rename, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {getHostFsScopePolicy} from "./privilegedFsScopeRegistry";
import {getHostProcessScopePolicy} from "./privilegedProcessScopeRegistry";
import {isCuratedOperatorProcessScopeId, isHostFallbackProcessScopeId} from "./processScopeCatalog";

export const HOSTS_FILE_PATH = "/etc/hosts";
export const HOST_PRIVILEGED_HANDLER = "__host.privilegedAction";
export const HOST_PRIVILEGED_ACTION_SYSTEM_HOSTS_WRITE = "system.hosts.write";
export const HOST_PRIVILEGED_ACTION_SYSTEM_FS_MUTATE = "system.fs.mutate";
export const HOST_PRIVILEGED_ACTION_SYSTEM_PROCESS_EXEC = "system.process.exec";
export const HOST_PRIVILEGED_ACTION_SYSTEM_WORKFLOW_RUN = "system.workflow.run";
export const HOST_PRIVILEGED_ACTION_SYSTEM_CLIPBOARD_READ = "system.clipboard.read";
export const HOST_PRIVILEGED_ACTION_SYSTEM_CLIPBOARD_WRITE = "system.clipboard.write";
export const DEFAULT_HOSTS_TAG = "default";

function nowIso() {
    return new Date().toISOString();
}

function successEnvelope(correlationId, result) {
    return {
        ok: true,
        correlationId,
        result,
    };
}

function errorEnvelope(code, message, correlationId, extra = {}) {
    return {
        ok: false,
        code,
        error: message,
        correlationId,
        ...extra,
    };
}

function missingCapabilitiesFor(required = [], granted = []) {
    const grantedSet = new Set(Array.isArray(granted) ? granted : []);
    return required.filter((capability) => !grantedSet.has(capability));
}

function formatMissingCapabilitiesMessage(capabilities = []) {
    const items = Array.isArray(capabilities) ? capabilities.filter((item) => typeof item === "string" && item.trim()) : [];
    const noun = items.length === 1 ? "capability" : "capabilities";
    return `Missing required ${noun}: ${items.join(", ")}.`;
}

function classifyProcessExecutionError(error, plan = {}, correlationId = "") {
    const rawCode = typeof error?.code === "string" ? error.code.trim() : "";
    const commandLabel = plan.command || "requested executable";

    if (rawCode === "ENOENT") {
        return errorEnvelope(
            "PROCESS_SPAWN_ENOENT",
            `Executable "${commandLabel}" was not found on the host. Install it on the host or choose an allowlisted path for scope "${plan.scope}".`,
            correlationId,
            {
                details: {
                    command: plan.command,
                    args: Array.isArray(plan.args) ? plan.args : [],
                    cwd: plan.cwd,
                    scope: plan.scope,
                    allowlistedExecutables: Array.isArray(plan.allowlistedExecutables) ? plan.allowlistedExecutables : [],
                },
            }
        );
    }

    if (rawCode === "EACCES" || rawCode === "EPERM") {
        return errorEnvelope(
            "PROCESS_SPAWN_PERMISSION_DENIED",
            `Host execution could not start "${commandLabel}" because the executable is not permitted by the OS.`,
            correlationId,
            {
                details: {
                    command: plan.command,
                    args: Array.isArray(plan.args) ? plan.args : [],
                    cwd: plan.cwd,
                    scope: plan.scope,
                    allowlistedExecutables: Array.isArray(plan.allowlistedExecutables) ? plan.allowlistedExecutables : [],
                },
            }
        );
    }

    return errorEnvelope("OS_ERROR", error?.message || String(error), correlationId);
}

function isRecord(value) {
    return Boolean(value) && typeof value === "object";
}

function isValidHostName(value) {
    return /^[a-zA-Z0-9.-]+$/.test(value) && !value.startsWith(".") && !value.endsWith(".");
}

function isValidIpAddress(value) {
    const ipv4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
    const ipv6 = /^[0-9a-fA-F:]+$/;
    return ipv4.test(value) || ipv6.test(value);
}

function isAbsolutePath(value) {
    return typeof value === "string" && path.isAbsolute(value);
}

function isWorkflowStepId(value) {
    return typeof value === "string" && /^[a-z0-9][a-z0-9._-]*$/.test(value);
}

function validateHostPrivilegedActionRequestCompat(payload) {
    if (!isRecord(payload)) {
        throw new Error("Host privileged action request must be an object.");
    }

    if (payload.action === HOST_PRIVILEGED_ACTION_SYSTEM_HOSTS_WRITE) {
        if (!isRecord(payload.payload)) {
            throw new Error('Host privileged action "payload" must be an object.');
        }
        const {records, dryRun, tag} = payload.payload;
        if (!Array.isArray(records) || records.length === 0) {
            throw new Error('Host privileged action payload field "records" must be a non-empty array.');
        }
        for (let index = 0; index < records.length; index += 1) {
            const record = records[index];
            if (!isRecord(record)) {
                throw new Error(`Host privileged action payload record at index ${index} must be an object.`);
            }
            if (typeof record.address !== "string" || !isValidIpAddress(record.address)) {
                throw new Error(`Host privileged action payload record at index ${index} has invalid "address".`);
            }
            if (typeof record.hostname !== "string" || !isValidHostName(record.hostname)) {
                throw new Error(`Host privileged action payload record at index ${index} has invalid "hostname".`);
            }
            if (record.comment !== undefined && typeof record.comment !== "string") {
                throw new Error(`Host privileged action payload record at index ${index} has invalid "comment".`);
            }
        }
        if (dryRun !== undefined && typeof dryRun !== "boolean") {
            throw new Error('Host privileged action payload field "dryRun" must be a boolean when provided.');
        }
        if (tag !== undefined && (typeof tag !== "string" || tag.trim().length === 0)) {
            throw new Error('Host privileged action payload field "tag" must be a non-empty string when provided.');
        }
        return payload;
    }

    if (payload.action === HOST_PRIVILEGED_ACTION_SYSTEM_FS_MUTATE) {
        if (!isRecord(payload.payload)) {
            throw new Error('Host privileged action "payload" must be an object.');
        }
        const {scope, operations, dryRun, reason} = payload.payload;
        if (typeof scope !== "string" || !scope.trim()) {
            throw new Error('Host privileged action payload field "scope" must be a non-empty string.');
        }
        if (!Array.isArray(operations) || operations.length === 0) {
            throw new Error('Host privileged action payload field "operations" must be a non-empty array.');
        }
        for (let index = 0; index < operations.length; index += 1) {
            const op = operations[index];
            if (!isRecord(op) || typeof op.type !== "string") {
                throw new Error(`Host privileged action operation at index ${index} is invalid.`);
            }
            switch (op.type) {
                case "mkdir":
                case "remove":
                    if (typeof op.path !== "string" || !isAbsolutePath(op.path)) {
                        throw new Error(`Host privileged action operation at index ${index} has invalid "path".`);
                    }
                    break;
                case "writeFile":
                case "appendFile":
                    if (typeof op.path !== "string" || !isAbsolutePath(op.path)) {
                        throw new Error(`Host privileged action operation at index ${index} has invalid "path".`);
                    }
                    if (typeof op.content !== "string") {
                        throw new Error(`Host privileged action operation at index ${index} requires string "content".`);
                    }
                    if (op.encoding !== undefined && op.encoding !== "utf8" && op.encoding !== "base64") {
                        throw new Error(`Host privileged action operation at index ${index} has invalid "encoding".`);
                    }
                    break;
                case "rename":
                    if (typeof op.from !== "string" || !isAbsolutePath(op.from)) {
                        throw new Error(`Host privileged action operation at index ${index} has invalid "from".`);
                    }
                    if (typeof op.to !== "string" || !isAbsolutePath(op.to)) {
                        throw new Error(`Host privileged action operation at index ${index} has invalid "to".`);
                    }
                    break;
                default:
                    throw new Error(`Host privileged action operation at index ${index} has unsupported type "${op.type}".`);
            }
        }
        if (dryRun !== undefined && typeof dryRun !== "boolean") {
            throw new Error('Host privileged action payload field "dryRun" must be a boolean when provided.');
        }
        if (reason !== undefined && (typeof reason !== "string" || !reason.trim())) {
            throw new Error('Host privileged action payload field "reason" must be a non-empty string when provided.');
        }
        return payload;
    }

    if (payload.action === HOST_PRIVILEGED_ACTION_SYSTEM_PROCESS_EXEC) {
        if (!isRecord(payload.payload)) {
            throw new Error('Host privileged action "payload" must be an object.');
        }
        const {scope, command, args, cwd, env, timeoutMs, input, encoding, dryRun, reason} = payload.payload;
        if (typeof scope !== "string" || !scope.trim()) {
            throw new Error('Host privileged action payload field "scope" must be a non-empty string.');
        }
        if (typeof command !== "string" || !isAbsolutePath(command)) {
            throw new Error('Host privileged action payload field "command" must be an absolute path string.');
        }
        if (args !== undefined && (!Array.isArray(args) || args.some((entry) => typeof entry !== "string"))) {
            throw new Error('Host privileged action payload field "args" must be an array of strings when provided.');
        }
        if (cwd !== undefined && (typeof cwd !== "string" || !isAbsolutePath(cwd))) {
            throw new Error('Host privileged action payload field "cwd" must be an absolute path string when provided.');
        }
        if (env !== undefined && !isRecord(env)) {
            throw new Error('Host privileged action payload field "env" must be an object when provided.');
        }
        if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
            throw new Error('Host privileged action payload field "timeoutMs" must be a positive number when provided.');
        }
        if (input !== undefined && typeof input !== "string") {
            throw new Error('Host privileged action payload field "input" must be a string when provided.');
        }
        if (encoding !== undefined && encoding !== "utf8" && encoding !== "base64") {
            throw new Error('Host privileged action payload field "encoding" must be "utf8" or "base64" when provided.');
        }
        if (dryRun !== undefined && typeof dryRun !== "boolean") {
            throw new Error('Host privileged action payload field "dryRun" must be a boolean when provided.');
        }
        if (reason !== undefined && (typeof reason !== "string" || !reason.trim())) {
            throw new Error('Host privileged action payload field "reason" must be a non-empty string when provided.');
        }
        return payload;
    }

    if (payload.action === HOST_PRIVILEGED_ACTION_SYSTEM_WORKFLOW_RUN) {
        if (!isRecord(payload.payload)) {
            throw new Error('Host privileged action "payload" must be an object.');
        }
        const {kind, scope, title, summary, steps, dryRun, confirmation} = payload.payload;
        if (kind !== "process-sequence") {
            throw new Error('Host privileged workflow payload field "kind" must be "process-sequence".');
        }
        if (typeof scope !== "string" || !scope.trim()) {
            throw new Error('Host privileged action payload field "scope" must be a non-empty string.');
        }
        if (typeof title !== "string" || !title.trim()) {
            throw new Error('Host privileged workflow payload field "title" must be a non-empty string.');
        }
        if (summary !== undefined && (typeof summary !== "string" || !summary.trim())) {
            throw new Error('Host privileged workflow payload field "summary" must be a non-empty string when provided.');
        }
        if (!Array.isArray(steps) || steps.length === 0) {
            throw new Error('Host privileged action payload field "steps" must be a non-empty array.');
        }
        const seenStepIds = new Set();
        for (let index = 0; index < steps.length; index += 1) {
            const step = steps[index];
            if (!isRecord(step)) {
                throw new Error(`Host privileged workflow step at index ${index} must be an object.`);
            }
            if (!isWorkflowStepId(step.id)) {
                throw new Error(`Host privileged workflow step at index ${index} field "id" must match /^[a-z0-9][a-z0-9._-]*$/.`);
            }
            if (seenStepIds.has(step.id)) {
                throw new Error('Host privileged workflow payload field "steps" must not contain duplicate step ids.');
            }
            seenStepIds.add(step.id);
            if (typeof step.title !== "string" || !step.title.trim()) {
                throw new Error(`Host privileged workflow step at index ${index} field "title" must be a non-empty string.`);
            }
            if (typeof step.command !== "string" || !isAbsolutePath(step.command)) {
                throw new Error(`Host privileged workflow step at index ${index} field "command" must be an absolute path.`);
            }
            if (step.args !== undefined && (!Array.isArray(step.args) || step.args.some((entry) => typeof entry !== "string"))) {
                throw new Error(`Host privileged workflow step at index ${index} field "args" must be an array of strings when provided.`);
            }
            if (step.cwd !== undefined && (typeof step.cwd !== "string" || !isAbsolutePath(step.cwd))) {
                throw new Error(`Host privileged workflow step at index ${index} field "cwd" must be an absolute path when provided.`);
            }
            if (step.env !== undefined && !isRecord(step.env)) {
                throw new Error(`Host privileged workflow step at index ${index} field "env" must be an object when provided.`);
            }
            if (step.timeoutMs !== undefined && (!Number.isFinite(step.timeoutMs) || step.timeoutMs <= 0)) {
                throw new Error(`Host privileged workflow step at index ${index} field "timeoutMs" must be a positive number when provided.`);
            }
            if (step.input !== undefined && typeof step.input !== "string") {
                throw new Error(`Host privileged workflow step at index ${index} field "input" must be a string when provided.`);
            }
            if (step.encoding !== undefined && step.encoding !== "utf8" && step.encoding !== "base64") {
                throw new Error(`Host privileged workflow step at index ${index} field "encoding" must be "utf8" or "base64" when provided.`);
            }
            if (step.reason !== undefined && (typeof step.reason !== "string" || !step.reason.trim())) {
                throw new Error(`Host privileged workflow step at index ${index} field "reason" must be a non-empty string when provided.`);
            }
            if (step.phase !== undefined && !["inspect", "preview", "mutate", "apply", "cleanup"].includes(step.phase)) {
                throw new Error(`Host privileged workflow step at index ${index} field "phase" is invalid.`);
            }
            if (step.onError !== undefined && step.onError !== "abort" && step.onError !== "continue") {
                throw new Error(`Host privileged workflow step at index ${index} field "onError" must be "abort" or "continue" when provided.`);
            }
        }
        if (dryRun !== undefined && typeof dryRun !== "boolean") {
            throw new Error('Host privileged action payload field "dryRun" must be a boolean when provided.');
        }
        if (confirmation !== undefined) {
            if (!isRecord(confirmation) || typeof confirmation.message !== "string" || !confirmation.message.trim()) {
                throw new Error('Host privileged workflow payload field "confirmation.message" must be a non-empty string.');
            }
            if (confirmation.requiredForStepIds !== undefined) {
                if (!Array.isArray(confirmation.requiredForStepIds) || confirmation.requiredForStepIds.some((entry) => typeof entry !== "string")) {
                    throw new Error('Host privileged workflow confirmation field "requiredForStepIds" must be an array of strings when provided.');
                }
                for (const stepId of confirmation.requiredForStepIds) {
                    if (!seenStepIds.has(stepId)) {
                        throw new Error(`Host privileged workflow confirmation field "requiredForStepIds" references unknown step id "${stepId}".`);
                    }
                }
            }
        }
        return payload;
    }

    if (payload.action === HOST_PRIVILEGED_ACTION_SYSTEM_CLIPBOARD_READ) {
        if (!isRecord(payload.payload)) {
            throw new Error('Host privileged action "payload" must be an object.');
        }
        const {reason} = payload.payload;
        if (reason !== undefined && (typeof reason !== "string" || !reason.trim())) {
            throw new Error('Host privileged clipboard read field "reason" must be a non-empty string when provided.');
        }
        return payload;
    }

    if (payload.action === HOST_PRIVILEGED_ACTION_SYSTEM_CLIPBOARD_WRITE) {
        if (!isRecord(payload.payload)) {
            throw new Error('Host privileged action "payload" must be an object.');
        }
        const {text, reason} = payload.payload;
        if (typeof text !== "string" || !text.trim()) {
            throw new Error('Host privileged clipboard write field "text" must be a non-empty string.');
        }
        if (reason !== undefined && (typeof reason !== "string" || !reason.trim())) {
            throw new Error('Host privileged clipboard write field "reason" must be a non-empty string when provided.');
        }
        return payload;
    }

    throw new Error(
        `Host privileged action "action" must be "${HOST_PRIVILEGED_ACTION_SYSTEM_HOSTS_WRITE}", "${HOST_PRIVILEGED_ACTION_SYSTEM_FS_MUTATE}", "${HOST_PRIVILEGED_ACTION_SYSTEM_PROCESS_EXEC}", "${HOST_PRIVILEGED_ACTION_SYSTEM_WORKFLOW_RUN}", "${HOST_PRIVILEGED_ACTION_SYSTEM_CLIPBOARD_READ}", or "${HOST_PRIVILEGED_ACTION_SYSTEM_CLIPBOARD_WRITE}".`
    );
}

function validatePrivilegedActionRequest(payload) {
    if (typeof validateHostPrivilegedActionRequest === "function") {
        try {
            return validateHostPrivilegedActionRequest(payload);
        } catch (error) {
            return validateHostPrivilegedActionRequestCompat(payload);
        }
    }
    return validateHostPrivilegedActionRequestCompat(payload);
}

function sanitizeTag(tag) {
    const raw = typeof tag === "string" && tag.trim() ? tag.trim() : DEFAULT_HOSTS_TAG;
    const normalized = raw.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").slice(0, 64);
    return normalized || DEFAULT_HOSTS_TAG;
}

function markersFor(pluginId, tag) {
    const safeTag = sanitizeTag(tag);
    return {
        safeTag,
        begin: `# BEGIN FDO:${pluginId}:${safeTag}`,
        end: `# END FDO:${pluginId}:${safeTag}`,
    };
}

function normalizeRecords(records) {
    const dedupe = new Map();
    for (const record of records) {
        const comment = typeof record.comment === "string" ? record.comment.trim() : "";
        const key = `${record.address}\u0000${record.hostname}\u0000${comment}`;
        if (!dedupe.has(key)) {
            dedupe.set(key, {address: record.address, hostname: record.hostname, comment});
        }
    }
    return [...dedupe.values()];
}

function recordToLine(record) {
    return record.comment
        ? `${record.address} ${record.hostname} # ${record.comment}`
        : `${record.address} ${record.hostname}`;
}

function renderSection(markers, records) {
    return `${[markers.begin, ...records.map(recordToLine), markers.end].join("\n")}\n`;
}

function splitTaggedSection(content, markers) {
    const normalized = String(content ?? "");
    const beginIdx = normalized.indexOf(markers.begin);
    if (beginIdx < 0) {
        return {hasSection: false, before: normalized, section: "", after: ""};
    }
    const endIdx = normalized.indexOf(markers.end, beginIdx);
    if (endIdx < 0) {
        return {hasSection: false, before: normalized, section: "", after: ""};
    }
    const sectionEnd = endIdx + markers.end.length;
    const trailingLf = normalized.charAt(sectionEnd) === "\n" ? 1 : 0;
    return {
        hasSection: true,
        before: normalized.slice(0, beginIdx),
        section: normalized.slice(beginIdx, sectionEnd + trailingLf),
        after: normalized.slice(sectionEnd + trailingLf),
    };
}

function applyTaggedSection(content, markers, sectionText) {
    const parts = splitTaggedSection(content, markers);
    const before = parts.before.replace(/\s*$/, "");
    const after = parts.after.replace(/^\s*/, "");
    const chunks = [];
    if (before) chunks.push(`${before}\n`);
    chunks.push(sectionText);
    if (after) chunks.push(`\n${after}`);
    return chunks.join("").replace(/\n{3,}/g, "\n\n");
}

function toBuffer(content, encoding) {
    return encoding === "base64"
        ? Buffer.from(content, "base64")
        : Buffer.from(content, "utf8");
}

function normalizeScopeOperation(operation) {
    switch (operation.type) {
        case "mkdir":
        case "remove":
        case "writeFile":
        case "appendFile":
            return [{type: operation.type, path: path.resolve(operation.path)}];
        case "rename":
            return [
                {type: "rename", path: path.resolve(operation.from)},
                {type: "rename", path: path.resolve(operation.to)},
            ];
        default:
            return [];
    }
}

function isUnderRoot(candidatePath, root) {
    const normalizedRoot = path.resolve(root);
    const normalizedPath = path.resolve(candidatePath);
    return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}${path.sep}`);
}

function ensureScopeOperationAllowed(operation, policy) {
    if (!policy.allowedOperationTypes.includes(operation.type)) {
        return `Operation "${operation.type}" is not allowed for scope "${policy.scope}".`;
    }

    const targets = normalizeScopeOperation(operation);
    const allowed = targets.every((target) =>
        policy.allowedRoots.some((root) => isUnderRoot(target.path, root))
    );
    if (!allowed) {
        return `Operation "${operation.type}" targets path outside allowed roots for scope "${policy.scope}".`;
    }
    return "";
}

function summarizeFsOperation(operation) {
    switch (operation.type) {
        case "mkdir":
            return `mkdir ${operation.path}`;
        case "writeFile":
            return `writeFile ${operation.path} (${operation.encoding || "utf8"})`;
        case "appendFile":
            return `appendFile ${operation.path} (${operation.encoding || "utf8"})`;
        case "rename":
            return `rename ${operation.from} -> ${operation.to}`;
        case "remove":
            return `remove ${operation.path}`;
        default:
            return `${operation.type}`;
    }
}

function summarizeProcessRequest({command = "", args = [], cwd = "", scope = "", timeoutMs = 0, dryRun = false} = {}) {
    return {
        scope,
        command,
        args: Array.isArray(args) ? [...args] : [],
        cwd: cwd || "",
        dryRun: !!dryRun,
        timeoutMs: Number(timeoutMs) || 0,
    };
}

function encodeProcessOutput(buffer, encoding = "utf8") {
    const value = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || "");
    return encoding === "base64" ? value.toString("base64") : value.toString("utf8");
}

function getClipboardAdapter(deps = {}) {
    if (typeof deps.readClipboardText === "function" && typeof deps.writeClipboardText === "function") {
        return {
            readText: async () => deps.readClipboardText(),
            writeText: async (text) => deps.writeClipboardText(text),
        };
    }
    if (!electronClipboard || typeof electronClipboard.readText !== "function" || typeof electronClipboard.writeText !== "function") {
        const error = new Error("Host clipboard API is unavailable.");
        error.code = "CLIPBOARD_UNSUPPORTED";
        throw error;
    }
    return {
        readText: async () => electronClipboard.readText(),
        writeText: async (text) => electronClipboard.writeText(text),
    };
}

function ensureAllowedKeys(actual = {}, allowed = []) {
    const allowedSet = new Set(Array.isArray(allowed) ? allowed : []);
    return Object.keys(actual).filter((key) => !allowedSet.has(key));
}

function buildProcessExecutionPlan(payload = {}, policy = {}) {
    const timeoutMs = payload.timeoutMs
        ? Math.min(Number(payload.timeoutMs) || 0, Number(policy.timeoutCeilingMs) || Number(payload.timeoutMs) || 0)
        : Number(policy.timeoutCeilingMs) || 0;

    return {
        scope: payload.scope,
        command: path.resolve(payload.command),
        args: Array.isArray(payload.args) ? payload.args.map((entry) => String(entry)) : [],
        cwd: payload.cwd ? path.resolve(payload.cwd) : process.cwd(),
        env: isRecord(payload.env) ? Object.fromEntries(Object.entries(payload.env).map(([key, value]) => [key, String(value)])) : {},
        timeoutMs,
        input: typeof payload.input === "string" ? payload.input : "",
        encoding: payload.encoding === "base64" ? "base64" : "utf8",
        dryRun: !!payload.dryRun,
        reason: typeof payload.reason === "string" ? payload.reason.trim() : "",
        allowlistedExecutables: Array.isArray(policy.allowedExecutables) ? [...policy.allowedExecutables] : [],
    };
}

function buildWorkflowStepCorrelationId(baseCorrelationId = "", stepIndex = 0, stepId = "") {
    const normalizedBase = String(baseCorrelationId || "").trim() || "workflow";
    const normalizedStepId = String(stepId || "").trim() || `step-${stepIndex + 1}`;
    return `${normalizedBase}:step:${stepIndex + 1}:${normalizedStepId}`;
}

function buildWorkflowStepPlan(scope, workflowPayload = {}, step = {}, policy = {}) {
    return buildProcessExecutionPlan({
        ...step,
        scope,
        dryRun: workflowPayload.dryRun === true,
        reason: typeof step.reason === "string" && step.reason.trim() ? step.reason : "",
    }, policy);
}

function classifyProcessScopeApproval(scopeId = "", policy = {}) {
    if (isCuratedOperatorProcessScopeId(scopeId)) {
        return {
            kindLabel: "Curated operator scope",
            summary: "This request uses a curated operator tool family with a narrower, task-shaped trust model.",
        };
    }
    if (policy?.fallback === true || isHostFallbackProcessScopeId(scopeId)) {
        return {
            kindLabel: "Host-specific fallback scope",
            summary: "This request uses a broader host fallback scope. Prefer curated operator fixtures, presets, or workflows when they fit.",
        };
    }
    return {
        kindLabel: "Host-specific scope",
        summary: "This request uses a host-defined scope outside the curated operator families.",
    };
}

function summarizeWorkflowStep(step, plan, index, correlationId) {
    return {
        stepId: typeof step?.id === "string" && step.id.trim() ? step.id.trim() : `step-${index + 1}`,
        title: typeof step?.title === "string" && step.title.trim() ? step.title.trim() : `Step ${index + 1}`,
        index,
        correlationId,
        command: plan.command,
        args: plan.args,
        cwd: plan.cwd,
        timeoutMs: plan.timeoutMs,
        dryRun: plan.dryRun,
        reason: plan.reason,
    };
}

function buildWorkflowSummary(steps = []) {
    const completedSteps = steps.filter((step) => step.status === "ok").length;
    const failedSteps = steps.filter((step) => step.status === "error").length;
    const skippedSteps = steps.filter((step) => step.status === "skipped").length;
    return {
        totalSteps: steps.length,
        completedSteps,
        failedSteps,
        skippedSteps,
    };
}

function buildWorkflowStatus(steps = []) {
    const hasErrors = steps.some((step) => step.status === "error");
    if (!hasErrors) return "completed";
    const hasSuccesses = steps.some((step) => step.status === "ok");
    return hasSuccesses ? "partial" : "failed";
}

function createWorkflowId(scope = "") {
    const suffix = typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    return `${scope || "workflow"}-${suffix}`;
}

function isAllowedExecutable(command, policy) {
    const normalizedCommand = path.resolve(command);
    const allowedExecutables = Array.isArray(policy?.allowedExecutables) ? policy.allowedExecutables : [];
    return allowedExecutables.some((entry) => path.resolve(entry) === normalizedCommand);
}

function validateProcessExecutionPlan(plan, policy) {
    if (!policy) {
        return `Unknown or unsupported process scope "${plan.scope}".`;
    }
    if (!isAbsolutePath(plan.command)) {
        return `Process command must be an absolute executable path for scope "${plan.scope}".`;
    }
    if (!isAllowedExecutable(plan.command, policy)) {
        return `Command "${plan.command}" is not allowed for process scope "${plan.scope}".`;
    }
    if (!isAbsolutePath(plan.cwd)) {
        return `Process cwd must be an absolute path for scope "${plan.scope}".`;
    }
    const cwdAllowed = (policy.allowedCwdRoots || []).some((root) => isUnderRoot(plan.cwd, root));
    if (!cwdAllowed) {
        return `Working directory "${plan.cwd}" is outside allowed roots for process scope "${plan.scope}".`;
    }
    const invalidEnvKeys = ensureAllowedKeys(plan.env, policy.allowedEnvKeys);
    if (invalidEnvKeys.length > 0) {
        return `Environment keys are not allowed for process scope "${plan.scope}": ${invalidEnvKeys.join(", ")}.`;
    }
    const timeoutCeilingMs = Number(policy.timeoutCeilingMs) || 0;
    if (timeoutCeilingMs > 0 && plan.timeoutMs > timeoutCeilingMs) {
        return `Requested timeout ${plan.timeoutMs}ms exceeds process scope "${plan.scope}" ceiling of ${timeoutCeilingMs}ms.`;
    }
    if (typeof policy.validateArgs === "function") {
        const argError = policy.validateArgs(plan.args, plan);
        if (argError) {
            return argError;
        }
    }
    return "";
}

async function runProcessExecution(plan, deps = {}) {
    if (typeof deps.runProcess === "function") {
        return deps.runProcess(plan);
    }

    return new Promise((resolve, reject) => {
        const child = spawn(plan.command, plan.args, {
            cwd: plan.cwd,
            env: {
                ...process.env,
                ...plan.env,
            },
            shell: false,
            stdio: "pipe",
        });

        const stdoutChunks = [];
        const stderrChunks = [];
        let timedOut = false;
        let settled = false;
        let timeoutHandle = null;
        let killEscalationHandle = null;

        const finalize = (fn, value) => {
            if (settled) {
                return;
            }
            settled = true;
            if (timeoutHandle) clearTimeout(timeoutHandle);
            if (killEscalationHandle) clearTimeout(killEscalationHandle);
            fn(value);
        };

        child.stdout?.on("data", (chunk) => stdoutChunks.push(Buffer.from(chunk)));
        child.stderr?.on("data", (chunk) => stderrChunks.push(Buffer.from(chunk)));
        child.on("error", (error) => finalize(reject, error));
        child.on("close", (code) => {
            finalize(resolve, {
                exitCode: Number.isInteger(code) ? code : null,
                stdout: Buffer.concat(stdoutChunks),
                stderr: Buffer.concat(stderrChunks),
                timedOut,
            });
        });

        if (plan.timeoutMs > 0) {
            timeoutHandle = setTimeout(() => {
                timedOut = true;
                try {
                    child.kill("SIGTERM");
                } catch (_) {
                    // Best effort.
                }
                killEscalationHandle = setTimeout(() => {
                    try {
                        child.kill("SIGKILL");
                    } catch (_) {
                        // Best effort.
                    }
                }, 1000);
            }, plan.timeoutMs);
        }

        if (plan.input) {
            child.stdin?.end(plan.encoding === "base64" ? Buffer.from(plan.input, "base64") : Buffer.from(plan.input, "utf8"));
        } else {
            child.stdin?.end();
        }
    });
}

export async function executeHostPrivilegedAction(requestEnvelope, context = {}, deps = {}) {
    const {
        pluginId = "",
        correlationId = "",
        grantedCapabilities = [],
        onAudit = () => {},
        confirmWrite = async () => true,
        confirmPrivilegedAction = null,
        hostsPath = HOSTS_FILE_PATH,
        approvalSessionStore = null,
        approvalSessionTtlMs = 15 * 60 * 1000,
    } = context;
    const {
        readText = async (filePath) => readFile(filePath, "utf8"),
        writeText = async (filePath, text) => writeFile(filePath, text, "utf8"),
    } = deps;

    const startedAt = Date.now();
    const confirmAction = typeof confirmPrivilegedAction === "function" ? confirmPrivilegedAction : confirmWrite;
    const normalizedApprovalTtlMs = Number.isFinite(approvalSessionTtlMs) && approvalSessionTtlMs > 0
        ? Number(approvalSessionTtlMs)
        : 15 * 60 * 1000;

    const buildApprovalCacheKey = ({action: approvalAction, scope = "", kind = ""}) => {
        const safePluginId = String(pluginId || "").trim();
        const safeAction = String(approvalAction || "").trim();
        const safeScope = String(scope || "").trim();
        const safeKind = String(kind || "").trim();
        return [safePluginId, safeAction, safeScope, safeKind].filter(Boolean).join("::");
    };

    const hasCachedApproval = (approvalKey) => {
        if (!(approvalSessionStore instanceof Map) || !approvalKey) {
            return false;
        }
        const expiresAt = approvalSessionStore.get(approvalKey);
        if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
            approvalSessionStore.delete(approvalKey);
            return false;
        }
        return true;
    };

    const rememberApproval = (approvalKey) => {
        if (!(approvalSessionStore instanceof Map) || !approvalKey) {
            return;
        }
        approvalSessionStore.set(approvalKey, Date.now() + normalizedApprovalTtlMs);
    };

    const audit = (event) => {
        onAudit({
            pluginId,
            correlationId,
            timestamp: nowIso(),
            durationMs: Date.now() - startedAt,
            ...event,
        });
    };

    let validated;
    try {
        validated = validatePrivilegedActionRequest(requestEnvelope);
    } catch (error) {
        const failure = errorEnvelope("VALIDATION_FAILED", error?.message || String(error), correlationId);
        audit({
            action: requestEnvelope?.action || "",
            dryRun: false,
            scope: "",
            operationCount: 0,
            success: false,
            error: failure,
        });
        return failure;
    }

    const action = validated.action;
    const dryRun = !!validated.payload?.dryRun;

    if (action === HOST_PRIVILEGED_ACTION_SYSTEM_CLIPBOARD_READ) {
        const requiredCapabilities = [
            HOST_PRIVILEGED_ACTION_SYSTEM_HOSTS_WRITE,
            HOST_PRIVILEGED_ACTION_SYSTEM_CLIPBOARD_READ,
        ];
        const reason = typeof validated?.payload?.reason === "string" ? validated.payload.reason.trim() : "";
        const missingCapabilities = missingCapabilitiesFor(requiredCapabilities, grantedCapabilities);
        if (missingCapabilities.length > 0) {
            const denied = errorEnvelope(
                "CAPABILITY_DENIED",
                formatMissingCapabilitiesMessage(missingCapabilities),
                correlationId,
                {
                    details: {
                        requiredCapabilities,
                        missingCapabilities,
                        reason,
                        action,
                    },
                }
            );
            audit({action, scope: "clipboard", dryRun: false, success: false, reason, error: denied});
            return denied;
        }

        const approvalKey = buildApprovalCacheKey({action, scope: "clipboard"});
        if (!hasCachedApproval(approvalKey)) {
            const detail = [
                `Plugin "${pluginId}" requests reading text from the host clipboard.`,
                `Capabilities required: ${requiredCapabilities.join(", ")}`,
                reason ? `Reason: ${reason}` : "",
                "",
                "Clipboard read can expose sensitive copied content.",
            ].filter(Boolean).join("\n");
            const confirmed = await confirmAction({
                pluginId,
                action,
                correlationId,
                scope: "clipboard",
                approvalKey,
                title: "Confirm Clipboard Read",
                message: "Plugin requests reading text from host clipboard",
                confirmLabel: "Allow",
                cancelLabel: "Cancel",
                detail,
            });
            if (!confirmed) {
                const cancelled = errorEnvelope("CANCELLED", "User cancelled clipboard read.", correlationId);
                audit({
                    action,
                    scope: "clipboard",
                    dryRun: false,
                    success: false,
                    reason,
                    confirmationDecision: "denied",
                    error: cancelled,
                });
                return cancelled;
            }
            rememberApproval(approvalKey);
            audit({
                action,
                scope: "clipboard",
                success: true,
                reason,
                confirmationDecision: "approved",
            });
        }

        try {
            const adapter = getClipboardAdapter(deps);
            const text = String(await adapter.readText());
            const response = successEnvelope(correlationId, {text});
            audit({
                action,
                scope: "clipboard",
                dryRun: false,
                success: true,
                reason,
                result: {
                    ok: true,
                    correlationId,
                    result: {
                        textLength: text.length,
                    },
                },
            });
            return response;
        } catch (error) {
            const code = error?.code === "CLIPBOARD_UNSUPPORTED" ? "CLIPBOARD_UNSUPPORTED" : "CLIPBOARD_READ_FAILED";
            const failed = errorEnvelope(code, error?.message || String(error), correlationId);
            audit({action, scope: "clipboard", dryRun: false, success: false, reason, error: failed});
            return failed;
        }
    }

    if (action === HOST_PRIVILEGED_ACTION_SYSTEM_CLIPBOARD_WRITE) {
        const requiredCapabilities = [
            HOST_PRIVILEGED_ACTION_SYSTEM_HOSTS_WRITE,
            HOST_PRIVILEGED_ACTION_SYSTEM_CLIPBOARD_WRITE,
        ];
        const reason = typeof validated?.payload?.reason === "string" ? validated.payload.reason.trim() : "";
        const text = String(validated?.payload?.text || "");
        if (!text.trim()) {
            const failed = errorEnvelope(
                "VALIDATION_FAILED",
                'Host privileged clipboard write field "text" must be a non-empty string.',
                correlationId
            );
            audit({action, scope: "clipboard", dryRun: false, success: false, reason, error: failed});
            return failed;
        }
        const missingCapabilities = missingCapabilitiesFor(requiredCapabilities, grantedCapabilities);
        if (missingCapabilities.length > 0) {
            const denied = errorEnvelope(
                "CAPABILITY_DENIED",
                formatMissingCapabilitiesMessage(missingCapabilities),
                correlationId,
                {
                    details: {
                        requiredCapabilities,
                        missingCapabilities,
                        reason,
                        action,
                    },
                }
            );
            audit({action, scope: "clipboard", dryRun: false, success: false, reason, error: denied});
            return denied;
        }

        try {
            const adapter = getClipboardAdapter(deps);
            await adapter.writeText(text);
            const response = successEnvelope(correlationId, {bytesWritten: Buffer.byteLength(text, "utf8")});
            audit({
                action,
                scope: "clipboard",
                dryRun: false,
                success: true,
                reason,
                result: response,
            });
            return response;
        } catch (error) {
            const code = error?.code === "CLIPBOARD_UNSUPPORTED" ? "CLIPBOARD_UNSUPPORTED" : "CLIPBOARD_WRITE_FAILED";
            const failed = errorEnvelope(code, error?.message || String(error), correlationId);
            audit({action, scope: "clipboard", dryRun: false, success: false, reason, error: failed});
            return failed;
        }
    }

    if (action === HOST_PRIVILEGED_ACTION_SYSTEM_HOSTS_WRITE) {
        if (!grantedCapabilities.includes(HOST_PRIVILEGED_ACTION_SYSTEM_HOSTS_WRITE)) {
            const denied = errorEnvelope(
                "CAPABILITY_DENIED",
                `Capability "${HOST_PRIVILEGED_ACTION_SYSTEM_HOSTS_WRITE}" is required.`,
                correlationId
            );
            audit({action, scope: "", dryRun, operationCount: validated.payload.records.length, success: false, error: denied});
            return denied;
        }

        const records = normalizeRecords(validated.payload.records || []);
        const markers = markersFor(pluginId, validated.payload.tag);
        const sectionText = renderSection(markers, records);

        try {
            const originalText = await readText(hostsPath);
            const nextText = applyTaggedSection(originalText, markers, sectionText);
            const changed = nextText !== originalText;
            const plan = {
                action,
                scope: "etc-hosts",
                changed,
                changes: records.map((record) => ({
                    address: record.address,
                    hostname: record.hostname,
                    comment: record.comment || "",
                })),
                section: sectionText,
                hostsPath: HOSTS_FILE_PATH,
            };

            if (dryRun) {
                const response = successEnvelope(correlationId, {action, dryRun: true, plan});
                audit({action, scope: "etc-hosts", dryRun: true, operationCount: records.length, success: true, result: response});
                return response;
            }

            const detail = [
                `Plugin "${pluginId}" requests updating /etc/hosts with these entries:`,
                "",
                ...records.map((record) => `- ${recordToLine(record)}`),
            ].join("\n");
            const confirmed = await confirmAction({
                pluginId,
                action,
                correlationId,
                title: "Confirm Hosts File Update",
                message: "Plugin requests updating /etc/hosts",
                confirmLabel: "Apply",
                cancelLabel: "Cancel",
                detail,
            });
            if (!confirmed) {
                const cancelled = errorEnvelope("CANCELLED", "User cancelled hosts file update.", correlationId);
                audit({action, scope: "etc-hosts", dryRun: false, operationCount: records.length, success: false, error: cancelled});
                return cancelled;
            }

            if (changed) {
                await writeText(hostsPath, nextText);
            }
            const response = successEnvelope(correlationId, {action, dryRun: false, changed, plan});
            audit({action, scope: "etc-hosts", dryRun: false, operationCount: records.length, success: true, result: response});
            return response;
        } catch (error) {
            const failed = errorEnvelope("OS_ERROR", error?.message || String(error), correlationId);
            audit({action, scope: "etc-hosts", dryRun, operationCount: records.length, success: false, error: failed});
            return failed;
        }
    }

    if (action === HOST_PRIVILEGED_ACTION_SYSTEM_FS_MUTATE) {
        const scope = validated.payload.scope;
        const scopeCap = `system.fs.scope.${scope}`;
        const operations = validated.payload.operations || [];
        const broadGranted = grantedCapabilities.includes(HOST_PRIVILEGED_ACTION_SYSTEM_HOSTS_WRITE);
        const scopeGranted = grantedCapabilities.includes(scopeCap);

        if (!broadGranted || !scopeGranted) {
            const denied = errorEnvelope("CAPABILITY_DENIED", `Capabilities "${HOST_PRIVILEGED_ACTION_SYSTEM_HOSTS_WRITE}" and "${scopeCap}" are required.`, correlationId);
            audit({action, scope, dryRun, operationCount: operations.length, success: false, error: denied});
            return denied;
        }

        const policy = getHostFsScopePolicy(scope);
        if (!policy) {
            const unknown = errorEnvelope("SCOPE_DENIED", `Unknown or unsupported filesystem scope "${scope}".`, correlationId);
            audit({action, scope, dryRun, operationCount: operations.length, success: false, error: unknown});
            return unknown;
        }

        for (const operation of operations) {
            const err = ensureScopeOperationAllowed(operation, policy);
            if (err) {
                const denied = errorEnvelope("SCOPE_VIOLATION", err, correlationId);
                audit({action, scope, dryRun, operationCount: operations.length, success: false, error: denied});
                return denied;
            }
        }

        const plan = {
            action,
            scope,
            operationCount: operations.length,
            changes: operations.map((operation) => summarizeFsOperation(operation)),
        };

        if (dryRun) {
            const response = successEnvelope(correlationId, {action, scope, dryRun: true, plan});
            audit({action, scope, dryRun: true, operationCount: operations.length, success: true, result: response});
            return response;
        }

        if (policy.requireConfirmation) {
            const detail = [
                `Plugin "${pluginId}" requests filesystem mutations in scope "${scope}":`,
                "",
                ...plan.changes.map((line) => `- ${line}`),
            ].join("\n");
            const confirmed = await confirmAction({
                pluginId,
                action,
                correlationId,
                title: "Confirm Filesystem Mutation",
                message: `Plugin requests filesystem mutations in scope "${scope}"`,
                confirmLabel: "Apply",
                cancelLabel: "Cancel",
                detail,
            });
            if (!confirmed) {
                const cancelled = errorEnvelope("CANCELLED", "User cancelled filesystem mutations.", correlationId);
                audit({action, scope, dryRun: false, operationCount: operations.length, success: false, error: cancelled});
                return cancelled;
            }
        }

        try {
            for (const operation of operations) {
                if (operation.type === "mkdir") {
                    await mkdir(operation.path, {
                        recursive: operation.recursive !== false,
                        mode: operation.mode,
                    });
                    continue;
                }
                if (operation.type === "writeFile") {
                    await writeFile(operation.path, toBuffer(operation.content, operation.encoding), {
                        mode: operation.mode,
                    });
                    continue;
                }
                if (operation.type === "appendFile") {
                    await appendFile(operation.path, toBuffer(operation.content, operation.encoding));
                    continue;
                }
                if (operation.type === "rename") {
                    await rename(operation.from, operation.to);
                    continue;
                }
                if (operation.type === "remove") {
                    await rm(operation.path, {
                        recursive: !!operation.recursive,
                        force: operation.force !== false,
                    });
                }
            }
            const response = successEnvelope(correlationId, {action, scope, dryRun: false, plan});
            audit({action, scope, dryRun: false, operationCount: operations.length, success: true, result: response});
            return response;
        } catch (error) {
            const failed = errorEnvelope("OS_ERROR", error?.message || String(error), correlationId);
            audit({action, scope, dryRun: false, operationCount: operations.length, success: false, error: failed});
            return failed;
        }
    }

    if (action === HOST_PRIVILEGED_ACTION_SYSTEM_PROCESS_EXEC) {
        const scope = validated.payload.scope;
        const broadCap = "system.process.exec";
        const scopeCap = `system.process.scope.${scope}`;
        const scopeGranted = grantedCapabilities.includes(scopeCap);
        const broadGranted = grantedCapabilities.includes(broadCap);
        const policy = getHostProcessScopePolicy(scope, {pluginId});
        const plan = buildProcessExecutionPlan(validated.payload, policy || {});
        let confirmationDecision = "";

        if (!broadGranted || !scopeGranted) {
            const missingCapabilities = missingCapabilitiesFor([broadCap, scopeCap], grantedCapabilities);
            const denied = errorEnvelope(
                "CAPABILITY_DENIED",
                formatMissingCapabilitiesMessage(missingCapabilities),
                correlationId,
                {
                    details: {
                        requiredCapabilities: [broadCap, scopeCap],
                        missingCapabilities,
                        scope,
                        command: plan.command,
                    },
                }
            );
            audit({
                action,
                scope,
                dryRun: plan.dryRun,
                success: false,
                command: plan.command,
                args: plan.args,
                cwd: plan.cwd,
                error: denied,
            });
            return denied;
        }

        if (!policy) {
            const unknown = errorEnvelope("SCOPE_DENIED", `Unknown or unsupported process scope "${scope}".`, correlationId);
            audit({
                action,
                scope,
                dryRun: plan.dryRun,
                success: false,
                command: plan.command,
                args: plan.args,
                cwd: plan.cwd,
                error: unknown,
            });
            return unknown;
        }

        const processValidationError = validateProcessExecutionPlan(plan, policy);
        if (processValidationError) {
            const denied = errorEnvelope("SCOPE_VIOLATION", processValidationError, correlationId);
            audit({
                action,
                scope,
                dryRun: plan.dryRun,
                success: false,
                command: plan.command,
                args: plan.args,
                cwd: plan.cwd,
                error: denied,
            });
            return denied;
        }

        if (plan.dryRun) {
            const response = successEnvelope(correlationId, {
                dryRun: true,
                command: plan.command,
                args: plan.args,
                cwd: plan.cwd,
                scope,
            });
            audit({
                action,
                scope,
                dryRun: true,
                success: true,
                command: plan.command,
                args: plan.args,
                cwd: plan.cwd,
                result: response,
            });
            return response;
        }

        if (policy.requireConfirmation) {
            const approvalKey = buildApprovalCacheKey({action, scope});
            if (hasCachedApproval(approvalKey)) {
                confirmationDecision = "session-approved";
            } else {
            const scopePresentation = classifyProcessScopeApproval(scope, policy);
            const broadCap = "system.process.exec";
            const scopeCap = `system.process.scope.${scope}`;
            const detail = [
                `Plugin "${pluginId}" requests scoped process execution:`,
                "",
                `Scope type: ${scopePresentation.kindLabel}`,
                scopePresentation.summary,
                `Broad capability: ${broadCap}`,
                `Narrow scope: ${scopeCap}`,
                `Scope: ${scope}`,
                `Command: ${plan.command}`,
                `Args: ${plan.args.length > 0 ? plan.args.join(" ") : "(none)"}`,
                `CWD: ${plan.cwd}`,
                `Timeout: ${plan.timeoutMs}ms`,
                plan.reason ? `Reason: ${plan.reason}` : "",
            ].filter(Boolean).join("\n");
            const confirmed = await confirmAction({
                pluginId,
                action,
                correlationId,
                scope,
                approvalKey,
                title: scopePresentation.kindLabel === "Curated operator scope"
                    ? "Confirm Curated Operator Action"
                    : scopePresentation.kindLabel === "Host-specific fallback scope"
                        ? "Confirm Fallback Host Action"
                        : "Confirm Scoped Process Execution",
                message: scopePresentation.kindLabel === "Curated operator scope"
                    ? `Plugin requests running curated operator tool "${path.basename(plan.command)}" in scope "${scope}"`
                    : scopePresentation.kindLabel === "Host-specific fallback scope"
                        ? `Plugin requests running fallback host tool "${path.basename(plan.command)}" in scope "${scope}"`
                        : `Plugin requests running "${path.basename(plan.command)}" in scope "${scope}"`,
                confirmLabel: "Run",
                cancelLabel: "Cancel",
                detail,
            });
            if (!confirmed) {
                const cancelled = errorEnvelope("CANCELLED", "User cancelled scoped process execution.", correlationId);
                audit({
                    action,
                    scope,
                    dryRun: false,
                    success: false,
                    confirmationDecision: "denied",
                    command: plan.command,
                    args: plan.args,
                    cwd: plan.cwd,
                    error: cancelled,
                });
                return cancelled;
            }
                rememberApproval(approvalKey);
                confirmationDecision = "approved";
            }
        }

        try {
            const processStartedAt = Date.now();
            const result = await runProcessExecution(plan, deps);
            const durationMs = Date.now() - processStartedAt;
            if (result?.timedOut) {
                const timedOut = errorEnvelope("TIMEOUT", `Process execution exceeded timeout of ${plan.timeoutMs}ms.`, correlationId);
                audit({
                    action,
                    scope,
                    dryRun: false,
                    success: false,
                    confirmationDecision,
                    command: plan.command,
                    args: plan.args,
                    cwd: plan.cwd,
                    timedOut: true,
                    error: timedOut,
                });
                return timedOut;
            }

            const typedResult = {
                exitCode: result?.exitCode ?? null,
                stdout: encodeProcessOutput(result?.stdout, plan.encoding),
                stderr: encodeProcessOutput(result?.stderr, plan.encoding),
                timedOut: false,
                command: plan.command,
                args: plan.args,
                cwd: plan.cwd,
                durationMs,
                dryRun: false,
            };
            if (typedResult.exitCode !== 0 && typedResult.exitCode !== null) {
                const failed = errorEnvelope(
                    "PROCESS_EXIT_NON_ZERO",
                    `Process "${path.basename(plan.command)}" exited with code ${typedResult.exitCode}.`,
                    correlationId,
                    {
                        result: typedResult,
                    }
                );
                audit({
                    action,
                    scope,
                    dryRun: false,
                    success: false,
                    confirmationDecision,
                    command: plan.command,
                    args: plan.args,
                    cwd: plan.cwd,
                    error: failed,
                });
                return failed;
            }

            const response = successEnvelope(correlationId, typedResult);
            audit({
                action,
                scope,
                dryRun: false,
                success: true,
                confirmationDecision,
                command: plan.command,
                args: plan.args,
                cwd: plan.cwd,
                result: response,
            });
            return response;
        } catch (error) {
            const failed = classifyProcessExecutionError(error, plan, correlationId);
            audit({
                action,
                scope,
                dryRun: false,
                success: false,
                confirmationDecision,
                command: plan.command,
                args: plan.args,
                cwd: plan.cwd,
                error: failed,
            });
            return failed;
        }
    }

    if (action === HOST_PRIVILEGED_ACTION_SYSTEM_WORKFLOW_RUN) {
        const scope = validated.payload.scope;
        const kind = validated.payload.kind;
        const workflowId = createWorkflowId(scope);
        const broadCap = "system.process.exec";
        const scopeCap = `system.process.scope.${scope}`;
        const scopeGranted = grantedCapabilities.includes(scopeCap);
        const broadGranted = grantedCapabilities.includes(broadCap);
        const policy = getHostProcessScopePolicy(scope, {pluginId});
        const stepPlans = [];

        if (!broadGranted || !scopeGranted) {
            const missingCapabilities = missingCapabilitiesFor([broadCap, scopeCap], grantedCapabilities);
            const denied = errorEnvelope(
                "CAPABILITY_DENIED",
                formatMissingCapabilitiesMessage(missingCapabilities),
                correlationId,
                {
                    details: {
                        workflowId,
                        kind,
                        scope,
                        title: validated.payload.title,
                        status: "failed",
                        summary: buildWorkflowSummary([]),
                        requiredCapabilities: [broadCap, scopeCap],
                        missingCapabilities,
                    },
                }
            );
            audit({action, workflowId, scope, workflowTitle: validated.payload.title, workflowKind: kind, workflowStatus: "failed", dryRun, operationCount: validated.payload.steps.length, success: false, error: denied});
            return denied;
        }

        if (!policy) {
            const unknown = errorEnvelope(
                "SCOPE_DENIED",
                `Unknown or unsupported process scope "${scope}".`,
                correlationId,
                {
                    details: {
                        workflowId,
                        kind,
                        scope,
                        title: validated.payload.title,
                        status: "failed",
                        summary: buildWorkflowSummary([]),
                    },
                }
            );
            audit({action, workflowId, scope, workflowTitle: validated.payload.title, workflowKind: kind, workflowStatus: "failed", dryRun, operationCount: validated.payload.steps.length, success: false, error: unknown});
            return unknown;
        }

        for (let index = 0; index < validated.payload.steps.length; index += 1) {
            const step = validated.payload.steps[index];
            const stepId = step.id;
            const stepCorrelationId = buildWorkflowStepCorrelationId(correlationId, index, stepId);
            const plan = buildWorkflowStepPlan(scope, validated.payload, step, policy);
            const processValidationError = validateProcessExecutionPlan(plan, policy);
            if (processValidationError) {
                const stepFailure = {
                    ...summarizeWorkflowStep(step, plan, index, stepCorrelationId),
                    status: "error",
                    code: "SCOPE_VIOLATION",
                    error: processValidationError,
                };
                const denied = errorEnvelope(
                    "STEP_SCOPE_VIOLATION",
                    `Workflow step "${stepFailure.stepId}" is not allowed: ${processValidationError}`,
                    correlationId,
                    {
                        details: {
                            workflowId,
                            kind,
                            scope,
                            title: validated.payload.title,
                            status: "failed",
                            steps: [stepFailure],
                            summary: buildWorkflowSummary([stepFailure]),
                        },
                    }
                );
                audit({
                    action,
                    workflowId,
                    scope,
                    workflowTitle: validated.payload.title,
                    workflowKind: kind,
                    workflowStatus: "failed",
                    dryRun: plan.dryRun,
                    success: false,
                    stepIndex: index,
                    stepId: stepFailure.stepId,
                    stepTitle: stepFailure.title,
                    stepStatus: stepFailure.status,
                    stepCorrelationId,
                    command: plan.command,
                    args: plan.args,
                    cwd: plan.cwd,
                    error: denied,
                });
                return denied;
            }
            stepPlans.push({step, index, stepId, stepCorrelationId, plan});
        }

        if (policy.requireConfirmation) {
            const approvalKey = buildApprovalCacheKey({action, scope, kind});
            if (hasCachedApproval(approvalKey)) {
                audit({
                    action,
                    workflowId,
                    scope,
                    workflowTitle: validated.payload.title,
                    workflowKind: kind,
                    workflowStatus: "approved",
                    success: true,
                    confirmationDecision: "session-approved",
                });
            } else {
            const scopePresentation = classifyProcessScopeApproval(scope, policy);
            const requiredForStepIds = Array.isArray(validated.payload.confirmation?.requiredForStepIds)
                ? new Set(validated.payload.confirmation.requiredForStepIds)
                : null;
            const formatStepLine = ({stepId, step, plan}, index) => {
                const args = Array.isArray(plan.args) ? plan.args.join(" ") : "";
                const commandLine = [plan.command, args].filter(Boolean).join(" ").trim();
                const approval = requiredForStepIds?.has(stepId) ? " [approval]" : "";
                return `${index + 1}. ${step.title} (${stepId})${approval}\n   ${commandLine || plan.command}\n   timeout ${plan.timeoutMs}ms`;
            };
            const compactStepLines = stepPlans.slice(0, 3).map(formatStepLine);
            if (stepPlans.length > 3) {
                compactStepLines.push(`... ${stepPlans.length - 3} more step(s)`);
            }
            const detail = [
                `Plugin: ${pluginId}`,
                `Workflow: ${validated.payload.title} (${kind})`,
                `Workflow ID: ${workflowId}`,
                `Scope type: ${scopePresentation.kindLabel}`,
                `Scope: ${scope}`,
                `Capabilities required: ${broadCap}, ${scopeCap}`,
                `Broad capability: ${broadCap}`,
                `Narrow scope: ${scopeCap}`,
                scopePresentation.summary,
                validated.payload.summary ? `Summary: ${validated.payload.summary}` : "",
                "",
                "Step preview:",
                ...compactStepLines,
                "",
                "Tip: full per-step command output appears in workflow result and plugin logs.",
            ].filter(Boolean).join("\n");
            const confirmed = await confirmAction({
                pluginId,
                action,
                correlationId,
                scope,
                approvalKey,
                title: scopePresentation.kindLabel === "Curated operator scope"
                    ? "Confirm Curated Operator Workflow"
                    : scopePresentation.kindLabel === "Host-specific fallback scope"
                        ? "Confirm Fallback Host Workflow"
                        : "Confirm Scoped Workflow",
                message: validated.payload.confirmation?.message || (
                    scopePresentation.kindLabel === "Curated operator scope"
                        ? `Plugin requests a curated operator ${kind} workflow in scope "${scope}"`
                        : scopePresentation.kindLabel === "Host-specific fallback scope"
                            ? `Plugin requests a fallback host ${kind} workflow in scope "${scope}"`
                            : `Plugin requests a ${kind} workflow in scope "${scope}"`
                ),
                confirmLabel: "Run Workflow",
                cancelLabel: "Cancel",
                detail,
            });
            audit({
                action,
                workflowId,
                scope,
                workflowTitle: validated.payload.title,
                workflowKind: kind,
                workflowStatus: confirmed ? "approved" : "failed",
                success: !!confirmed,
                confirmationDecision: confirmed ? "approved" : "denied",
            });
            if (!confirmed) {
                const cancelled = errorEnvelope(
                    "CANCELLED",
                    "User cancelled scoped workflow execution.",
                    correlationId,
                    {
                        details: {
                            workflowId,
                            kind,
                            scope,
                            title: validated.payload.title,
                            status: "failed",
                            summary: buildWorkflowSummary([]),
                        },
                    }
                );
                audit({action, workflowId, scope, workflowTitle: validated.payload.title, workflowKind: kind, workflowStatus: "failed", dryRun: false, operationCount: stepPlans.length, success: false, error: cancelled});
                return cancelled;
            }
                rememberApproval(approvalKey);
            }
        }

        const stepResults = [];
        for (const {step, index, stepId, stepCorrelationId, plan} of stepPlans) {
            if (plan.dryRun) {
                const dryRunResult = {
                    ...summarizeWorkflowStep(step, plan, index, stepCorrelationId),
                    status: "ok",
                    result: {
                        command: plan.command,
                        args: plan.args,
                        cwd: plan.cwd,
                        exitCode: null,
                        stdout: "",
                        stderr: "",
                        durationMs: 0,
                        dryRun: true,
                    },
                };
                stepResults.push(dryRunResult);
                audit({
                    action,
                    workflowId,
                    scope,
                    workflowTitle: validated.payload.title,
                    workflowKind: kind,
                    workflowStatus: "running",
                    dryRun: true,
                    success: true,
                    stepIndex: index,
                    stepId,
                    stepTitle: step.title,
                    stepStatus: dryRunResult.status,
                    stepCorrelationId,
                    command: plan.command,
                    args: plan.args,
                    cwd: plan.cwd,
                    result: dryRunResult,
                });
                continue;
            }

            const stepStartedAt = Date.now();
            try {
                const result = await runProcessExecution(plan, deps);
                const durationMs = Date.now() - stepStartedAt;
                if (result?.timedOut) {
                    const stepFailure = {
                        ...summarizeWorkflowStep(step, plan, index, stepCorrelationId),
                        status: "error",
                        result: {
                            command: plan.command,
                            args: plan.args,
                            cwd: plan.cwd,
                            exitCode: result?.exitCode ?? null,
                            stdout: encodeProcessOutput(result?.stdout, plan.encoding),
                            stderr: encodeProcessOutput(result?.stderr, plan.encoding),
                            durationMs,
                            dryRun: false,
                        },
                        code: "TIMEOUT",
                        error: `Workflow step "${stepId}" exceeded timeout of ${plan.timeoutMs}ms.`,
                    };
                    stepResults.push(stepFailure);
                    const workflowStatus = buildWorkflowStatus(stepResults);
                    const failed = errorEnvelope(
                        "STEP_TIMEOUT",
                        stepFailure.error,
                        correlationId,
                        {
                            details: {
                                workflowId,
                                kind,
                                scope,
                                title: validated.payload.title,
                                status: workflowStatus,
                                steps: stepResults,
                                summary: buildWorkflowSummary(stepResults),
                            },
                        }
                    );
                    audit({
                        action,
                        workflowId,
                        scope,
                        workflowTitle: validated.payload.title,
                        workflowKind: kind,
                        workflowStatus,
                        dryRun: false,
                        success: false,
                        stepIndex: index,
                        stepId,
                        stepTitle: step.title,
                        stepStatus: stepFailure.status,
                        stepCorrelationId,
                        command: plan.command,
                        args: plan.args,
                        cwd: plan.cwd,
                        timedOut: true,
                        error: failed,
                    });
                    return failed;
                }

                const exitCode = result?.exitCode ?? null;
                const stepResult = {
                    ...summarizeWorkflowStep(step, plan, index, stepCorrelationId),
                    status: (exitCode === 0 || exitCode === null) ? "ok" : "error",
                    result: {
                        command: plan.command,
                        args: plan.args,
                        cwd: plan.cwd,
                        exitCode,
                        stdout: encodeProcessOutput(result?.stdout, plan.encoding),
                        stderr: encodeProcessOutput(result?.stderr, plan.encoding),
                        durationMs,
                        dryRun: false,
                    },
                };
                if (stepResult.status === "error") {
                    stepResult.code = "EXIT_CODE";
                    stepResult.error = `Workflow step "${stepId}" exited with code ${exitCode}.`;
                }
                stepResults.push(stepResult);
                const workflowStatus = buildWorkflowStatus(stepResults);
                audit({
                    action,
                    workflowId,
                    scope,
                    workflowTitle: validated.payload.title,
                    workflowKind: kind,
                    workflowStatus,
                    dryRun: false,
                    success: stepResult.status === "ok",
                    stepIndex: index,
                    stepId,
                    stepTitle: step.title,
                    stepStatus: stepResult.status,
                    stepCorrelationId,
                    command: plan.command,
                    args: plan.args,
                    cwd: plan.cwd,
                    result: stepResult,
                });
                if (stepResult.status === "error") {
                    if (step.onError === "continue") {
                        continue;
                    }
                    return errorEnvelope(
                        "STEP_FAILED",
                        stepResult.error,
                        correlationId,
                        {
                            details: {
                                workflowId,
                                kind,
                                scope,
                                title: validated.payload.title,
                                status: workflowStatus,
                                steps: stepResults,
                                summary: buildWorkflowSummary(stepResults),
                            },
                        }
                    );
                }
            } catch (error) {
                const classified = classifyProcessExecutionError(error, plan, stepCorrelationId);
                const stepFailure = {
                    ...summarizeWorkflowStep(step, plan, index, stepCorrelationId),
                    status: "error",
                    code: classified.code,
                    error: classified.error,
                    result: {
                        command: plan.command,
                        args: plan.args,
                        cwd: plan.cwd,
                        exitCode: null,
                        stdout: "",
                        stderr: "",
                        durationMs: Date.now() - stepStartedAt,
                        dryRun: false,
                    },
                };
                stepResults.push(stepFailure);
                const workflowStatus = buildWorkflowStatus(stepResults);
                const failed = errorEnvelope(
                    classified.code === "PROCESS_SPAWN_ENOENT" ? "STEP_PROCESS_SPAWN_ENOENT" : "STEP_OS_ERROR",
                    `Workflow step "${stepId}" failed: ${stepFailure.error}`,
                    correlationId,
                    {
                        details: {
                            workflowId,
                            kind,
                            scope,
                            title: validated.payload.title,
                            status: workflowStatus,
                            steps: stepResults,
                            summary: buildWorkflowSummary(stepResults),
                        },
                    }
                );
                audit({
                    action,
                    workflowId,
                    scope,
                    workflowTitle: validated.payload.title,
                    workflowKind: kind,
                    workflowStatus,
                    dryRun: false,
                    success: false,
                    stepIndex: index,
                    stepId,
                    stepTitle: step.title,
                    stepStatus: stepFailure.status,
                    stepCorrelationId,
                    command: plan.command,
                    args: plan.args,
                    cwd: plan.cwd,
                    error: failed,
                });
                return failed;
            }
        }

        const workflowStatus = buildWorkflowStatus(stepResults);
        const response = successEnvelope(correlationId, {
            workflowId,
            kind,
            scope,
            title: validated.payload.title,
            status: workflowStatus,
            steps: stepResults,
            summary: buildWorkflowSummary(stepResults),
        });
        audit({
            action,
            workflowId,
            scope,
            workflowTitle: validated.payload.title,
            workflowKind: kind,
            workflowStatus,
            dryRun: dryRun,
            operationCount: stepResults.length,
            success: workflowStatus !== "failed",
            result: response,
        });
        return response;
    }

    const unsupported = errorEnvelope("ACTION_NOT_SUPPORTED", `Action "${action}" is not supported by host.`, correlationId);
    audit({action, scope: "", dryRun, operationCount: 0, success: false, error: unsupported});
    return unsupported;
}
