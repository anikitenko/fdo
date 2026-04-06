import {validateHostPrivilegedActionRequest} from "@anikitenko/fdo-sdk";
import {spawn} from "node:child_process";
import {appendFile, mkdir, readFile, rename, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {getHostFsScopePolicy} from "./privilegedFsScopeRegistry";
import {getHostProcessScopePolicy} from "./privilegedProcessScopeRegistry";

export const HOSTS_FILE_PATH = "/etc/hosts";
export const HOST_PRIVILEGED_HANDLER = "__host.privilegedAction";
export const HOST_PRIVILEGED_ACTION_SYSTEM_HOSTS_WRITE = "system.hosts.write";
export const HOST_PRIVILEGED_ACTION_SYSTEM_FS_MUTATE = "system.fs.mutate";
export const HOST_PRIVILEGED_ACTION_SYSTEM_PROCESS_EXEC = "system.process.exec";
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

function errorEnvelope(code, message, correlationId) {
    return {
        ok: false,
        code,
        error: message,
        correlationId,
    };
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

    throw new Error(
        `Host privileged action "action" must be "${HOST_PRIVILEGED_ACTION_SYSTEM_HOSTS_WRITE}", "${HOST_PRIVILEGED_ACTION_SYSTEM_FS_MUTATE}", or "${HOST_PRIVILEGED_ACTION_SYSTEM_PROCESS_EXEC}".`
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
    };
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
    } = context;
    const {
        readText = async (filePath) => readFile(filePath, "utf8"),
        writeText = async (filePath, text) => writeFile(filePath, text, "utf8"),
    } = deps;

    const startedAt = Date.now();
    const confirmAction = typeof confirmPrivilegedAction === "function" ? confirmPrivilegedAction : confirmWrite;

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
        const policy = getHostProcessScopePolicy(scope);
        const plan = buildProcessExecutionPlan(validated.payload, policy || {});

        if (!broadGranted || !scopeGranted) {
            const denied = errorEnvelope("CAPABILITY_DENIED", `Capabilities "${broadCap}" and "${scopeCap}" are required.`, correlationId);
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
            const detail = [
                `Plugin "${pluginId}" requests scoped process execution:`,
                "",
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
                title: "Confirm Scoped Process Execution",
                message: `Plugin requests running "${path.basename(plan.command)}" in scope "${scope}"`,
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
                    command: plan.command,
                    args: plan.args,
                    cwd: plan.cwd,
                    error: cancelled,
                });
                return cancelled;
            }
        }

        try {
            const result = await runProcessExecution(plan, deps);
            if (result?.timedOut) {
                const timedOut = errorEnvelope("TIMEOUT", `Process execution exceeded timeout of ${plan.timeoutMs}ms.`, correlationId);
                audit({
                    action,
                    scope,
                    dryRun: false,
                    success: false,
                    command: plan.command,
                    args: plan.args,
                    cwd: plan.cwd,
                    timedOut: true,
                    error: timedOut,
                });
                return timedOut;
            }

            const response = successEnvelope(correlationId, {
                exitCode: result?.exitCode ?? null,
                stdout: encodeProcessOutput(result?.stdout, plan.encoding),
                stderr: encodeProcessOutput(result?.stderr, plan.encoding),
                timedOut: false,
                command: plan.command,
                args: plan.args,
            });
            audit({
                action,
                scope,
                dryRun: false,
                success: true,
                command: plan.command,
                args: plan.args,
                cwd: plan.cwd,
                result: response,
            });
            return response;
        } catch (error) {
            const failed = errorEnvelope("OS_ERROR", error?.message || String(error), correlationId);
            audit({
                action,
                scope,
                dryRun: false,
                success: false,
                command: plan.command,
                args: plan.args,
                cwd: plan.cwd,
                error: failed,
            });
            return failed;
        }
    }

    const unsupported = errorEnvelope("ACTION_NOT_SUPPORTED", `Action "${action}" is not supported by host.`, correlationId);
    audit({action, scope: "", dryRun, operationCount: 0, success: false, error: unsupported});
    return unsupported;
}
