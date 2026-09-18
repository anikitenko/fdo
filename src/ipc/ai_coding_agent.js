import {reserveLiveAiTestRequest} from "../utils/liveAiTestBudget";
import {createPluginAssistantIsolation} from "../utils/pluginAssistantIsolation";
import {extractCodexFailure} from "../utils/codexCliJson";
import {app, ipcMain} from "electron";
import {AiCodingAgentChannels} from "./channels.js";
import LLM from "@themaximalist/llm.js";
import {sendCodingLlmRequest} from "../utils/codingLlmRequest";
import {buildPluginAuthoringGuide, buildPluginCodingPrompt} from "../utils/pluginAuthoringGuide";
import {settings} from "../utils/store.js";
import {spawn} from "node:child_process";
import { resolveCodexCliInvocation } from "../utils/codexCli.js";
import {resolveGeminiCliInvocation} from "../utils/geminiCli.js";
import { extractCodexJsonEventText, extractCodexJsonProgress, isLikelyCodexJsonEventStream } from "../utils/codexCliJson.js";
import { CODEX_JSON_EARLY_RETRY_MS, shouldRetryCodexWithoutJsonEarly } from "../utils/codexCliRetryPolicy.js";
import {
    clearCodexJsonModeCooldown,
    getCodexJsonModeCooldownState,
    markCodexJsonModeCooldown,
    shouldUseCodexJsonMode,
} from "../utils/codexCliJsonModePreference.js";
import {
    buildAiCodingDoneStatus,
    buildAiCodingFirstResponseStatus,
    buildAiCodingLaunchStatus,
    buildAiCodingTransportStatus,
    buildAiCodingWaitingStatus,
} from "../utils/aiCodingAgentProgress.js";

const activeCodingRequests = new Map();
// Plugin workspaces commonly need several complete files in one response.
// Keep this high enough for a compact implementation, its stylesheet, and tests.
const CODING_MAX_OUTPUT_TOKENS = 8192;
// A streaming provider should acknowledge a request promptly. This protects
// the Editor from an indefinitely pending fetch while still allowing a long
// generation once the provider has started sending content.
const CODING_FIRST_CONTENT_TIMEOUT_MS = 90_000;
const PLUGIN_WORKSPACE_ONLY_PROMPT = `
PLUGIN WORKSPACE BOUNDARY:
- AI Coding Assistant is restricted to the current plugin workspace only.
- Product-host source, settings, credentials, internal logs, and application architecture are outside your scope. Never inspect or request them.
- Never suggest editing or auditing product-host files from AI Coding Assistant.
- If the likely root cause is outside the plugin workspace, say it appears outside this workspace and is outside AI Coding Assistant scope.
- Only reference plugin workspace paths that are present in the provided context or selected code.
- Never invent host-side file paths as a proposed fix for a plugin-scoped request.
`.trim();

function recordE2ECodingLifecycle(event, requestId, details = {}) {
    if (process.env.FDO_E2E !== "1") return;
    const records = globalThis.__FDO_E2E_CODING_LIFECYCLE__ || [];
    records.push({
        event,
        requestId,
        at: new Date().toISOString(),
        ...details,
    });
    globalThis.__FDO_E2E_CODING_LIFECYCLE__ = records.slice(-80);
}

function registerActiveCodingRequest(requestId, controls = {}) {
    if (!requestId) return;
    activeCodingRequests.set(requestId, {
        cancelled: false,
        cancel: typeof controls.cancel === "function" ? controls.cancel : null,
    });
}

function updateActiveCodingRequest(requestId, controls = {}) {
    if (!requestId) return;
    const existing = activeCodingRequests.get(requestId);
    if (!existing) {
        registerActiveCodingRequest(requestId, controls);
        return;
    }
    activeCodingRequests.set(requestId, {
        ...existing,
        ...controls,
        cancel: typeof controls.cancel === "function" ? controls.cancel : existing.cancel,
    });
}

function getActiveCodingRequestState(requestId) {
    return activeCodingRequests.get(requestId) || null;
}

function isActiveCodingRequestCancelled(requestId) {
    return !!activeCodingRequests.get(requestId)?.cancelled;
}

function unregisterActiveCodingRequest(requestId) {
    if (!requestId) return;
    activeCodingRequests.delete(requestId);
}

class AiCodingRequestCancelledError extends Error {
    constructor(message = "AI request stopped by user.") {
        super(message);
        this.name = "AiCodingRequestCancelledError";
    }
}

function sendBackendStatus(event, requestId, message, metadata = {}) {
    event.sender.send(AiCodingAgentChannels.on_off.STREAM_DELTA, {
        requestId,
        type: "status",
        message,
        metadata,
    });
}

function formatAssistantLabel(assistantInfo = {}) {
    const provider = assistantInfo?.provider || "unknown provider";
    const model = assistantInfo?.model ? ` / ${assistantInfo.model}` : "";
    return `${provider}${model}`;
}

function extractJsonObject(text = "") {
    const value = String(text || "").trim();
    if (!value) return null;
    const direct = value.match(/\{[\s\S]*\}/);
    return direct ? direct[0] : null;
}

function normalizeRouteJudgePayload(parsed = {}) {
    const route = ["smart", "generate", "edit", "explain", "fix", "plan"].includes(parsed?.route)
        ? parsed.route
        : null;
    const confidence = Number(parsed?.confidence);
    if (!route || !Number.isFinite(confidence)) {
        return null;
    }
    return {
        available: true,
        route,
        confidence: Math.max(0, Math.min(1, confidence)),
        intent: {
            isQuestion: !!parsed?.intent?.isQuestion,
            asksForCodeChange: !!parsed?.intent?.asksForCodeChange,
            asksForFileCreation: !!parsed?.intent?.asksForFileCreation,
            asksForPlanExecution: !!parsed?.intent?.asksForPlanExecution,
            isFollowupConfirmation: !!parsed?.intent?.isFollowupConfirmation,
        },
        reasons: Array.isArray(parsed?.reasons)
            ? parsed.reasons.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 6)
            : [],
    };
}

// Select a coding assistant from settings
function selectCodingAssistant(assistantId) {
    const list = settings.get("ai.coding", []) || [];
    
    // If assistantId is provided, find that specific assistant
    if (assistantId) {
        const assistant = list.find(a => a.id === assistantId);
        if (assistant) return assistant;
    }
    
    // Otherwise, fall back to default or first
    const assistantInfo = list.find(a => a.default) || list[0];
    if (!assistantInfo) {
        throw new Error("No AI Coding assistant found. Please add one in Settings → AI Assistants.");
    }
    return assistantInfo;
}

function updateCodexAssistantState(assistantInfo, patch = {}) {
    if (!assistantInfo?.id) return;
    const list = settings.get("ai.coding", []) || [];
    const index = list.findIndex((item) => item.id === assistantInfo.id);
    if (index === -1) return;
    list[index] = {
        ...list[index],
        ...patch,
        updatedAt: new Date().toISOString(),
    };
    settings.set("ai.coding", list);
}

// Create LLM instance for coding tasks
async function createCodingLlm(assistantInfo, stream = false) {
    const llm = new LLM({
        service: assistantInfo.provider,
        apiKey: assistantInfo.apiKey,
        model: assistantInfo.model,
        stream: stream,
        extended: true,
        max_tokens: CODING_MAX_OUTPUT_TOKENS,
    });

    // This is deliberately limited to the public plugin contract. The coding
    // assistant must never receive product-host implementation details.
    llm.system(`
You are a coding assistant for a plugin workspace. Work only with the supplied
plugin files, diagnostics, and public plugin SDK declarations. Do not request,
infer, or describe product-host source, settings, credentials, internal logs,
or application architecture.

${buildPluginAuthoringGuide()}
`);
    return llm;


}

async function resolveCodexExecutable(assistantInfo) {
    return await resolveCodexCliInvocation({
        configuredPath: assistantInfo?.executablePath,
        preferBundled: true,
    });
}

function stripAnsi(text = "") {
    return String(text || "").replace(/\x1B\[[0-9;]*[A-Za-z]/g, "");
}

function sanitizeCodexStdout(text = "") {
    const value = stripAnsi(text);
    if (!value) return "";
    const cleaned = value
        .split("\n")
        .filter((line) => {
            const trimmed = line.trim();
            if (!trimmed) return true;
            if (/^\[\d{4}-\d{2}-\d{2}T/.test(trimmed) && /OpenAI Codex|workdir:|model:|provider:|approval:|sandbox:|reasoning effort:|reasoning summaries:/i.test(trimmed)) {
                return false;
            }
            return true;
        })
        .join("\n");
    return cleaned;
}

function classifyCodexCliError(stderr = "") {
    const normalized = stripAnsi(stderr);
    if (/401 Unauthorized/i.test(normalized)) {
        return "Codex CLI authentication failed. Your ChatGPT/Codex login is missing, expired, or not authorized. Please sign in again in Codex CLI and retry.";
    }
    return normalized.trim();
}

async function runCodexCliStream(event, requestId, assistantInfo, prompt) {
    const invocation = await resolveCodexExecutable(assistantInfo);
    const jsonPreference = {
        assistantId: assistantInfo?.id || "",
        model: assistantInfo?.model || "",
        command: invocation.command || "",
    };
    const buildExecArgs = (jsonMode) => {
        const execArgs = [
            ...(invocation.args || []),
            "exec",
        ];

        if (invocation.execCapabilities?.supportsAskForApproval) {
            execArgs.push("--ask-for-approval", "never");
        }
        if (invocation.execCapabilities?.supportsSandbox) {
            execArgs.push("--sandbox", "read-only");
        }
        if (invocation.execCapabilities?.supportsSkipGitRepoCheck) {
            execArgs.push("--skip-git-repo-check");
        }
        if (invocation.execCapabilities?.supportsModel && assistantInfo?.model) {
            execArgs.push("--model", assistantInfo.model);
        }
        if (jsonMode && invocation.execCapabilities?.supportsJson) {
            execArgs.push("--json");
        }
        // This integration generates proposals from supplied context; it does not need local tools.
        for (const feature of ["shell_tool", "unified_exec", "apps", "multi_agent"]) {
            execArgs.push("-c", `features.${feature}=false`);
        }
        execArgs.push("-c", 'web_search="disabled"');
        execArgs.push("-");
        return execArgs;
    };

    const runAttempt = async ({ jsonMode = false, retrying = false } = {}) => {
        const isolation = await createPluginAssistantIsolation(invocation, "codex-cli", [app.getAppPath(), app.getPath("userData"), process.resourcesPath, process.execPath]);
        try {
        return await new Promise((resolve, reject) => {
            const execArgs = buildExecArgs(jsonMode);
            const heartbeatIntervalMs = 10000;
            const startedAt = Date.now();
            let firstContentAt = null;
            const child = spawn(isolation.command, [...isolation.args, ...execArgs], isolation.options);
            updateActiveCodingRequest(requestId, {
                cancel: () => {
                    if (!child.killed) {
                        child.kill();
                    }
                },
            });

            sendBackendStatus(
                event,
                requestId,
                retrying
                    ? buildAiCodingTransportStatus("retry-launch")
                    : buildAiCodingLaunchStatus({ assistantName: assistantInfo?.name || "coding assistant" }),
                { phase: retrying ? "retry-launch" : "launch", provider: assistantInfo?.provider || "" },
            );
            sendBackendStatus(
                event,
                requestId,
                buildAiCodingWaitingStatus({ elapsedMs: 0, retrying }),
                { phase: "waiting-for-first-content", provider: assistantInfo?.provider || "" },
            );

            let fullContent = "";
            let stderr = "";
            let stdoutBuffer = "";
            let rawStdout = "";
            let progressEventCount = 0;
            let hasJsonEventStream = false;
            let earlyRetryWithoutJson = false;
            const heartbeat = setInterval(() => {
                event.sender.send(AiCodingAgentChannels.on_off.STREAM_DELTA, {
                    requestId,
                    type: "heartbeat",
                    content: " ",
                });
                if (!firstContentAt) {
                    const elapsedMs = Date.now() - startedAt;
                    sendBackendStatus(
                        event,
                        requestId,
                        buildAiCodingWaitingStatus({ elapsedMs, retrying }),
                        { phase: "waiting-for-first-content", elapsedMs },
                    );
                    if (shouldRetryCodexWithoutJsonEarly({
                        jsonMode,
                        retrying,
                        elapsedMs,
                        hasFirstContent: !!firstContentAt,
                        progressEventCount,
                        hasJsonEventStream,
                    })) {
                        earlyRetryWithoutJson = true;
                        sendBackendStatus(
                            event,
                            requestId,
                            buildAiCodingTransportStatus("early-retry-without-json"),
                            { phase: "early-retry-without-json", elapsedMs },
                        );
                        clearInterval(heartbeat);
                        child.kill();
                    }
                }
            }, heartbeatIntervalMs);

            const emitContentPiece = (piece) => {
                if (!piece) return;
                if (!firstContentAt) {
                    firstContentAt = Date.now();
                    sendBackendStatus(
                        event,
                        requestId,
                        buildAiCodingFirstResponseStatus(firstContentAt - startedAt),
                        { phase: "first-content", elapsedMs: firstContentAt - startedAt },
                    );
                }
                fullContent += piece;
                event.sender.send(AiCodingAgentChannels.on_off.STREAM_DELTA, {
                    requestId,
                    type: "content",
                    content: piece,
                });
            };

            child.stdout.on("data", (chunk) => {
                const text = chunk.toString("utf8");
                rawStdout += text;
                if (!jsonMode) {
                    const piece = sanitizeCodexStdout(text);
                    emitContentPiece(piece);
                    return;
                }

                stdoutBuffer += text;
                const lines = stdoutBuffer.split(/\r?\n/);
                stdoutBuffer = lines.pop() || "";
                for (const line of lines) {
                    if (!hasJsonEventStream && line.trim().startsWith("{")) {
                        hasJsonEventStream = true;
                    }
                    const progress = extractCodexJsonProgress(line);
                    if (progress) {
                        progressEventCount += 1;
                        sendBackendStatus(event, requestId, progress, { phase: "codex-progress" });
                    }
                    const piece = extractCodexJsonEventText(line);
                    if (piece) {
                        emitContentPiece(piece);
                    }
                }
            });

            child.stderr.on("data", (chunk) => {
                stderr += stripAnsi(chunk.toString("utf8"));
            });

            child.on("error", (error) => {
                clearInterval(heartbeat);
                reject(error);
            });

            child.stdin.on("error", (error) => {
                // An early CLI exit can close stdin; use its exit diagnostics in that case.
                if (error.code !== "EPIPE") {
                    clearInterval(heartbeat);
                    child.kill();
                    reject(error);
                }
            });
            child.stdin.end(prompt);

            child.on("close", (code) => {
                clearInterval(heartbeat);
                if (isActiveCodingRequestCancelled(requestId)) {
                    resolve({
                        content: "",
                        cancelled: true,
                        retryWithoutJson: false,
                        earlyRetryTriggered: false,
                        elapsedMs: Date.now() - startedAt,
                    });
                    return;
                }
                if (jsonMode && stdoutBuffer.trim()) {
                    if (!hasJsonEventStream && stdoutBuffer.trim().startsWith("{")) {
                        hasJsonEventStream = true;
                    }
                    const trailingPiece = extractCodexJsonEventText(stdoutBuffer);
                    if (trailingPiece) {
                        emitContentPiece(trailingPiece);
                    }
                }

                let retryWithoutJson = false;
                if (earlyRetryWithoutJson) {
                    retryWithoutJson = true;
                }
                if (jsonMode && !fullContent.trim()) {
                    if (!isLikelyCodexJsonEventStream(rawStdout)) {
                        const fallbackContent = sanitizeCodexStdout(rawStdout);
                        if (fallbackContent.trim()) {
                            sendBackendStatus(
                                event,
                                requestId,
                                buildAiCodingTransportStatus("raw-stdout-fallback"),
                                { phase: "raw-stdout-fallback" },
                            );
                            emitContentPiece(fallbackContent);
                        }
                    } else if (!earlyRetryWithoutJson) {
                        retryWithoutJson = true;
                    }
                }

                if (earlyRetryWithoutJson) {
                    resolve({
                        content: fullContent,
                        retryWithoutJson: true,
                        earlyRetryTriggered: true,
                        elapsedMs: Date.now() - startedAt,
                    });
                    return;
                }

                if (code !== 0) {
                    const message = classifyCodexCliError(extractCodexFailure(rawStdout, stderr)) || `Codex CLI exited with code ${code} without reporting a reason. Check the configured runtime and authentication, then retry.`;
                    reject(new Error(message));
                    return;
                }

                resolve({
                    content: fullContent,
                    cancelled: false,
                    retryWithoutJson,
                    earlyRetryTriggered: false,
                    elapsedMs: Date.now() - startedAt,
                });
            });
        });
        } finally { await isolation.cleanup(); }
    };

    try {
        const initialJsonMode = !!invocation.execCapabilities?.supportsJson && shouldUseCodexJsonMode(jsonPreference);
        if (!initialJsonMode && invocation.execCapabilities?.supportsJson) {
            const cooldownState = getCodexJsonModeCooldownState(jsonPreference);
            sendBackendStatus(
                event,
                requestId,
                buildAiCodingTransportStatus("json-cooldown"),
                { phase: "json-cooldown", failures: cooldownState?.failures || 0 },
            );
        }

        let result = await runAttempt({ jsonMode: initialJsonMode, retrying: false });
        if (result.cancelled || isActiveCodingRequestCancelled(requestId)) {
            throw new AiCodingRequestCancelledError();
        }
        let usedJsonFallback = false;
        if (result.retryWithoutJson) {
            usedJsonFallback = true;
            markCodexJsonModeCooldown(jsonPreference, undefined, result.earlyRetryTriggered ? "progress-only-json-early-retry" : "progress-only-json");
            if (!result.earlyRetryTriggered) {
                sendBackendStatus(
                    event,
                    requestId,
                    buildAiCodingTransportStatus("retry-without-json"),
                    { phase: "retry-without-json" },
                );
            }
            result = await runAttempt({ jsonMode: false, retrying: true });
            if (result.cancelled || isActiveCodingRequestCancelled(requestId)) {
                throw new AiCodingRequestCancelledError();
            }
        }

        if (!result.content.trim()) {
            throw new Error("Codex did not produce any assistant text for this request. Try a narrower prompt or another assistant.");
        }

        if (initialJsonMode && !usedJsonFallback) {
            clearCodexJsonModeCooldown(jsonPreference);
        }

        updateCodexAssistantState(assistantInfo, {
            codexAuth: {
                status: "authorized",
                message: invocation.source === "bundled"
                    ? `Bundled Codex ${invocation.version || ""} executed successfully.`
                    : `Codex CLI ${invocation.version || ""} executed successfully.`,
                checkedAt: new Date().toISOString(),
            },
            codexRuntime: {
                source: invocation.source,
                version: invocation.version || "",
                bundled: !!invocation.bundled,
            },
        });
        sendBackendStatus(
            event,
            requestId,
            buildAiCodingDoneStatus(result.elapsedMs),
            { phase: "done", elapsedMs: result.elapsedMs },
        );
        event.sender.send(AiCodingAgentChannels.on_off.STREAM_DONE, { requestId, fullContent: result.content });
        return { success: true, requestId, content: result.content };
    } catch (error) {
        if (error instanceof AiCodingRequestCancelledError || isActiveCodingRequestCancelled(requestId)) {
            event.sender.send(AiCodingAgentChannels.on_off.STREAM_CANCELLED, {
                requestId,
                message: "AI request stopped by user.",
            });
            return { success: false, requestId, cancelled: true, error: "AI request stopped by user." };
        }
        const message = error?.message || "Codex request failed.";
        updateCodexAssistantState(assistantInfo, {
            codexAuth: {
                status: /authentication failed|401 unauthorized/i.test(message) ? "unauthorized" : "error",
                message,
                checkedAt: new Date().toISOString(),
            },
        });
        event.sender.send(AiCodingAgentChannels.on_off.STREAM_ERROR, {
            requestId,
            error: message,
        });
        throw error;
    }
}

async function runGeminiCliStream(event, requestId, assistantInfo, prompt) {
    const invocation = await resolveGeminiCliInvocation({
        configuredPath: assistantInfo?.executablePath,
    });

    const isolation = await createPluginAssistantIsolation(invocation, "gemini-cli", [app.getAppPath(), app.getPath("userData"), process.resourcesPath, process.execPath]);
    try {
    return await new Promise((resolve, reject) => {
        const baseArgs = [...(invocation.args || [])];
        if (assistantInfo?.model) {
            baseArgs.push("--model", String(assistantInfo.model));
        }
        const promptArgVariants = [
            ["--prompt", prompt],
            ["-p", prompt],
        ];
        const triedVariants = [];
        let attemptIndex = 0;
        const startedAt = Date.now();
        let settled = false;

        const finish = (err, payload) => {
            if (settled) return;
            settled = true;
            if (err) {
                reject(err);
                return;
            }
            resolve(payload);
        };

        const runAttempt = (useStdin = false) => {
            if (attemptIndex >= promptArgVariants.length && !useStdin) {
                runAttempt(true);
                return;
            }

            const attemptArgs = [...baseArgs];
            if (!useStdin) {
                const variant = promptArgVariants[attemptIndex];
                triedVariants.push(variant[0]);
                attemptArgs.push(...variant);
                attemptIndex += 1;
            }

            sendBackendStatus(
                event,
                requestId,
                buildAiCodingLaunchStatus({ assistantName: assistantInfo?.name || "Gemini CLI assistant" }),
                { phase: "launch", provider: assistantInfo?.provider || "", cliAttempt: useStdin ? "stdin" : `arg:${triedVariants[triedVariants.length - 1] || ""}` },
            );
            sendBackendStatus(
                event,
                requestId,
                buildAiCodingWaitingStatus({ elapsedMs: 0, retrying: false }),
                { phase: "waiting-for-first-content", provider: assistantInfo?.provider || "" },
            );

            const child = spawn(isolation.command, [...isolation.args, ...attemptArgs], isolation.options);
            updateActiveCodingRequest(requestId, {
                cancel: () => {
                    if (!child.killed) {
                        child.kill();
                    }
                },
            });

            let fullContent = "";
            let stderr = "";
            let firstContentAt = null;
            const heartbeat = setInterval(() => {
                event.sender.send(AiCodingAgentChannels.on_off.STREAM_DELTA, {
                    requestId,
                    type: "heartbeat",
                    content: " ",
                });
                if (!firstContentAt) {
                    sendBackendStatus(
                        event,
                        requestId,
                        buildAiCodingWaitingStatus({ elapsedMs: Date.now() - startedAt, retrying: false }),
                        { phase: "waiting-for-first-content", elapsedMs: Date.now() - startedAt },
                    );
                }
            }, 10000);

            child.stdout.on("data", (chunk) => {
                const text = String(chunk || "");
                if (!text) return;
                if (!firstContentAt) {
                    firstContentAt = Date.now();
                    sendBackendStatus(
                        event,
                        requestId,
                        buildAiCodingFirstResponseStatus(firstContentAt - startedAt),
                        { phase: "first-content", elapsedMs: firstContentAt - startedAt },
                    );
                }
                fullContent += text;
                event.sender.send(AiCodingAgentChannels.on_off.STREAM_DELTA, {
                    requestId,
                    type: "content",
                    content: text,
                });
            });

            child.stderr.on("data", (chunk) => {
                stderr += String(chunk || "");
            });

            child.on("error", (error) => {
                clearInterval(heartbeat);
                if (!useStdin && /unknown option|unrecognized option|unknown flag/i.test(String(error?.message || ""))) {
                    runAttempt(false);
                    return;
                }
                finish(error);
            });

            child.on("close", (code) => {
                clearInterval(heartbeat);
                if (isActiveCodingRequestCancelled(requestId)) {
                    finish(new AiCodingRequestCancelledError());
                    return;
                }

                if (Number(code) === 0 && fullContent.trim()) {
                    sendBackendStatus(
                        event,
                        requestId,
                        buildAiCodingDoneStatus(Date.now() - startedAt),
                        { phase: "done", elapsedMs: Date.now() - startedAt },
                    );
                    event.sender.send(AiCodingAgentChannels.on_off.STREAM_DONE, {requestId, fullContent});
                    finish(null, {success: true, requestId, content: fullContent});
                    return;
                }

                const normalizedError = String(stderr || "").trim();
                if (!useStdin && (/unknown option|unrecognized option|unknown flag/i.test(normalizedError) || Number(code) === 2)) {
                    runAttempt(false);
                    return;
                }
                if (!useStdin && attemptIndex >= promptArgVariants.length) {
                    runAttempt(true);
                    return;
                }

                const message = normalizedError || `Gemini CLI exited with code ${code}`;
                finish(new Error(message));
            });

            if (useStdin) {
                child.stdin.write(prompt);
                child.stdin.end("\n");
            } else {
                child.stdin.end();
            }
        };

        runAttempt(false);
    }).catch((error) => {
        if (error instanceof AiCodingRequestCancelledError || isActiveCodingRequestCancelled(requestId)) {
            event.sender.send(AiCodingAgentChannels.on_off.STREAM_CANCELLED, {
                requestId,
                message: "AI request stopped by user.",
            });
            return { success: false, requestId, cancelled: true, error: "AI request stopped by user." };
        }
        event.sender.send(AiCodingAgentChannels.on_off.STREAM_ERROR, {
            requestId,
            error: error?.message || "Gemini CLI request failed.",
        });
        throw error;
    });
    } finally { await isolation.cleanup(); }
}

async function runCodingPrompt(event, requestId, assistantInfo, prompt, { image = null } = {}) {
    registerActiveCodingRequest(requestId);
    recordE2ECodingLifecycle("request-started", requestId, {provider: assistantInfo?.provider || ""});
    let waitingHeartbeat = null;
    let clearFirstContentDeadline = () => {};
    try {
        // CLI providers do not receive the API assistant's system prompt. API
        // providers receive the guide from createCodingLlm(), while CLI
        // providers receive the exact same public guide in their prompt.
        const isCliProvider = assistantInfo.provider === "codex-cli" || assistantInfo.provider === "gemini-cli";
        const providerPrompt = isCliProvider ? buildPluginCodingPrompt(prompt) : prompt;
        const scopedPrompt = `${PLUGIN_WORKSPACE_ONLY_PROMPT}\n\n${providerPrompt}`;
        if (assistantInfo.provider === "codex-cli") {
            if (image) {
                throw new Error("Codex CLI does not support image mockups in this integration yet.");
            }
            return await runCodexCliStream(event, requestId, assistantInfo, scopedPrompt);
        }
        if (assistantInfo.provider === "gemini-cli") {
            if (image) {
                throw new Error("Gemini CLI does not support image mockups in this integration yet.");
            }
            return await runGeminiCliStream(event, requestId, assistantInfo, scopedPrompt);
        }

        reserveLiveAiTestRequest();
        const llm = await createCodingLlm(assistantInfo, true);
        recordE2ECodingLifecycle("provider-created", requestId, {provider: assistantInfo?.provider || ""});
        // API-backed assistants expose AbortController cancellation through
        // the LLM instance. Without this, the Editor's Stop action could only
        // update UI state while the underlying fetch continued indefinitely.
        updateActiveCodingRequest(requestId, {
            cancel: () => llm.abort?.(),
        });
        // A Stop click can race provider initialization. Do not begin a
        // network request after the user has already cancelled it.
        if (isActiveCodingRequestCancelled(requestId)) {
            throw new AiCodingRequestCancelledError();
        }
        const startedAt = Date.now();
        let firstContentAt = null;
        let firstContentTimeout = null;
        const firstContentDeadline = new Promise((_, reject) => {
            firstContentTimeout = setTimeout(() => {
                llm.abort?.();
                reject(new Error(`The assistant did not start responding within ${Math.round(CODING_FIRST_CONTENT_TIMEOUT_MS / 1000)} seconds. Check the selected model and provider connection, then retry.`));
            }, CODING_FIRST_CONTENT_TIMEOUT_MS);
        });
        clearFirstContentDeadline = () => {
            if (firstContentTimeout) {
                clearTimeout(firstContentTimeout);
                firstContentTimeout = null;
            }
        };
        sendBackendStatus(
            event,
            requestId,
            buildAiCodingLaunchStatus({ assistantName: assistantInfo?.name || "coding assistant" }),
            { phase: "launch", provider: assistantInfo?.provider || "" },
        );
        sendBackendStatus(
            event,
            requestId,
            buildAiCodingWaitingStatus({ elapsedMs: 0, retrying: false }),
            { phase: "waiting-for-first-content", provider: assistantInfo?.provider || "" },
        );
        let fullContent = "";
        waitingHeartbeat = setInterval(() => {
            if (firstContentAt || isActiveCodingRequestCancelled(requestId)) {
                return;
            }
            sendBackendStatus(
                event,
                requestId,
                buildAiCodingWaitingStatus({ elapsedMs: Date.now() - startedAt, retrying: false }),
                { phase: "waiting-for-first-content", elapsedMs: Date.now() - startedAt },
            );
        }, 10000);

        // Establishing a streaming connection may itself take a while. Start
        // the heartbeat before awaiting it so the Editor keeps the request
        // alive and gives the author honest waiting feedback during that gap.
        recordE2ECodingLifecycle("provider-request-dispatched", requestId);
        const resp = await Promise.race([
            sendCodingLlmRequest(llm, scopedPrompt, image),
            firstContentDeadline,
        ]);

        if (resp && typeof resp === "object" && "stream" in resp && typeof resp.complete === "function") {
            recordE2ECodingLifecycle("provider-stream-opened", requestId);
            try {
                const consumeStream = async () => {
                    for await (const chunk of resp.stream) {
                        if (isActiveCodingRequestCancelled(requestId)) {
                            throw new AiCodingRequestCancelledError();
                        }
                        if (!chunk) continue;
                        const { type, content: piece } = chunk;

                        if (type === "content" && piece && typeof piece === "string") {
                            if (!firstContentAt) {
                                firstContentAt = Date.now();
                                recordE2ECodingLifecycle("first-content", requestId, {elapsedMs: firstContentAt - startedAt});
                                clearFirstContentDeadline();
                                sendBackendStatus(
                                    event,
                                    requestId,
                                    buildAiCodingFirstResponseStatus(firstContentAt - startedAt),
                                    { phase: "first-content", elapsedMs: firstContentAt - startedAt },
                                );
                            }
                            fullContent += piece;
                            event.sender.send(AiCodingAgentChannels.on_off.STREAM_DELTA, {
                                requestId,
                                type: "content",
                                content: piece,
                            });
                        }
                    }
                };
                await Promise.race([consumeStream(), firstContentDeadline]);
            } finally {
                clearInterval(waitingHeartbeat);
                clearFirstContentDeadline();
            }

            if (isActiveCodingRequestCancelled(requestId)) {
                throw new AiCodingRequestCancelledError();
            }

            await resp.complete();
            if (!fullContent.trim()) {
                throw new Error("The assistant returned no text. Check the selected model, provider access and output-token limit.");
            }
            sendBackendStatus(
                event,
                requestId,
                buildAiCodingDoneStatus(Date.now() - startedAt),
                { phase: "done", elapsedMs: Date.now() - startedAt },
            );
            recordE2ECodingLifecycle("request-completed", requestId, {elapsedMs: Date.now() - startedAt, contentLength: fullContent.length});
            event.sender.send(AiCodingAgentChannels.on_off.STREAM_DONE, { requestId, fullContent });
            return { success: true, requestId, content: fullContent };
        }

        throw new Error("Invalid response from assistant backend");
    } catch (error) {
        recordE2ECodingLifecycle("request-failed", requestId, {
            name: error?.name || "Error",
            cancelled: error instanceof AiCodingRequestCancelledError || isActiveCodingRequestCancelled(requestId),
        });
        clearFirstContentDeadline();
        if (waitingHeartbeat) {
            clearInterval(waitingHeartbeat);
        }
        if (error instanceof AiCodingRequestCancelledError || isActiveCodingRequestCancelled(requestId)) {
            event.sender.send(AiCodingAgentChannels.on_off.STREAM_CANCELLED, {
                requestId,
                message: "AI request stopped by user.",
            });
            return { success: false, requestId, cancelled: true, error: "AI request stopped by user." };
        }
        event.sender.send(AiCodingAgentChannels.on_off.STREAM_ERROR, {
            requestId,
            error: error.message,
        });
        throw error;
    } finally {
        recordE2ECodingLifecycle("request-finished", requestId);
        unregisterActiveCodingRequest(requestId);
    }
}

export function buildPlanCodePrompt({
    prompt = "",
    image = null,
    context = "",
    executionMode = false,
} = {}) {
    const workspaceContext = context ? `Workspace context:\n${context}\n` : "";
    if (executionMode) {
        return `Implement the requested plugin workspace changes using the task and supplied workspace context.

USER REQUEST
${prompt}

${workspaceContext}
SOURCE-OF-TRUTH RULES:
- The supplied plugin workspace context is authoritative. Do not invent files, APIs, or architecture outside it.
- Preserve existing plugin conventions unless the request explicitly changes them.
- Return only complete executable workspace file sections in this format:

### File: /path/to/file
\`\`\`typescript
...complete file content...
\`\`\`

Use virtual workspace paths only. Do not output machine paths or prose-only guidance.`;
    }

    return `Create a detailed implementation plan for the requested plugin using only the supplied plugin workspace context and public plugin contract.

USER REQUEST
${prompt}

${image ? "An image mockup is supplied; use it as a visual reference.\n" : ""}
${workspaceContext}
State the plugin's purpose, user flow, files to change, and complete file sections needed for the work. Preserve the current workspace convention. Use only virtual plugin workspace paths. Do not invent product-host files or APIs.`;

}

// Handle code generation
async function handleGenerateCode(event, data) {
    const { requestId, prompt, language, context, assistantId } = data;

    console.log('[AI Coding Agent Backend] Generate code request', { requestId, language, promptLength: prompt?.length, assistantId });

    try {
        const assistantInfo = selectCodingAssistant(assistantId);
        console.log('[AI Coding Agent Backend] Assistant selected', { name: assistantInfo.name, provider: assistantInfo.provider, model: assistantInfo.model });

        let fullPrompt = `Generate ${language || "code"} for the following request:\n\n${prompt}`;
        
        if (context) {
            fullPrompt += `\n\nContext:\n${context}`;
        }

        fullPrompt += `
\n\nIMPORTANT: When providing the code to insert, wrap it with a SOLUTION marker like this:

\`\`\`${language || 'code'}
<-- leave one empty line here -->
// SOLUTION READY TO APPLY
your actual code here
\`\`\`

💡 You may include additional code blocks for examples, references, or explanations if helpful,
but **ONLY the block marked with "// SOLUTION READY TO APPLY"** will be inserted into the editor.

Make sure there is a blank line between the opening code fence and the SOLUTION marker.
Do NOT literally include the text "<-- leave one empty line here -->" inside the code block.
Do NOT say that the workspace is read-only, that the sandbox blocked you, or that the user must provide a writable workspace.
\n`;

        console.log('[AI Coding Agent Backend] Sending to coding backend');
        return await runCodingPrompt(event, requestId, assistantInfo, fullPrompt);
    } catch (error) {
        console.error('[AI Coding Agent Backend] Error in handleGenerateCode', error);
        event.sender.send(AiCodingAgentChannels.on_off.STREAM_ERROR, {
            requestId,
            error: error.message,
        });
        return { success: false, error: error.message };
    }
}

export function buildEditCodePrompt({ instruction, language, code, context, targetFilePath } = {}) {
    return `Edit the following ${language || ""} code according to this instruction: ${instruction}

Original code:
\`\`\`${language || ""}
${code}
\`\`\`

${context ? `Relevant bundled FDO SDK knowledge:\n${context}\n` : ''}
${targetFilePath ? `Target workspace file: ${targetFilePath}\n\nUse exactly this virtual workspace path in every File: header. Do not invent or substitute any other path.\n` : ""}

Return the edit as one or more exact SEARCH/REPLACE patch blocks against the ORIGINAL CODE above.
Do NOT say that the workspace or sandbox is read-only.
Do NOT talk about applying patches yourself.
This editor will apply the patch.

Use this exact format:

\`\`\`patch
File: /path/to/target-file
<<<<<<< SEARCH
exact original text to replace
=======
new replacement text
>>>>>>> REPLACE
\`\`\`

Rules:
- Every SEARCH/REPLACE block must include a File: /path/to/file line immediately before the block
- Use only virtual workspace paths like /index.ts or /src/view.ts, never host-machine absolute paths such as /Users/... or /tmp/...
- ${targetFilePath ? `Every File: header must be exactly ${targetFilePath}` : "If a target file path is known from context, use that exact virtual workspace path."}
- SEARCH text must match the original code exactly
- Use one block for each distinct change
- If the whole selected code should change, use the full original code in SEARCH and the new code in REPLACE
- After the patch blocks, you may add a brief explanation if useful
- Do NOT return a full-file rewrite unless the instruction explicitly asks for it

`;
}

export function buildFixCodePrompt({ error, language, code, context, targetFilePath } = {}) {
    return `Fix the following ${language || ""} code that has this error: ${error}

Code with error:
\`\`\`${language || ""}
${code}
\`\`\`

${context ? `Relevant bundled FDO SDK knowledge:\n${context}\n` : ''}
${targetFilePath ? `Target workspace file: ${targetFilePath}\n\nUse exactly this virtual workspace path in every File: header. Do not invent or substitute any other path.\n` : ""}

Return the fix as one or more exact SEARCH/REPLACE patch blocks against the CODE WITH ERROR above.
Do NOT say that the workspace or sandbox is read-only.
Do NOT talk about applying patches yourself.
This editor will apply the patch.
Fix the real errors first. Preserve unrelated existing logic, structure, comments, and business behavior unless the reported problem truly requires changing them.
Do NOT replace the code with generic recommendations, scaffolds, summaries, or simplified examples.
Prefer the smallest surgical patch that resolves the concrete diagnostics shown in the context.

Use this exact format:

\`\`\`patch
File: /path/to/target-file
<<<<<<< SEARCH
exact original text to replace
=======
new replacement text
>>>>>>> REPLACE
\`\`\`

Rules:
- Every SEARCH/REPLACE block must include a File: /path/to/file line immediately before the block
- Use only virtual workspace paths like /index.ts or /src/view.ts, never host-machine absolute paths such as /Users/... or /tmp/...
- ${targetFilePath ? `Every File: header must be exactly ${targetFilePath}` : "If a target file path is known from context, use that exact virtual workspace path."}
- SEARCH text must match the original code exactly
- Use one block for each distinct fix
- If the whole selected code should change, use the full original code in SEARCH and the new code in REPLACE
- After the patch blocks, you may add at most 3 short bullets explaining what changed
- Do NOT return a full-file rewrite unless the fix truly requires rewriting the selected code

`;
}

// Handle code editing
async function handleEditCode(event, data) {
    const { requestId, code, instruction, language, context, assistantId, targetFilePath } = data;

    console.log('[AI Coding Agent Backend] Edit code request', { requestId, language, instructionLength: instruction?.length, assistantId });

    try {
        const assistantInfo = selectCodingAssistant(assistantId);

        const prompt = buildEditCodePrompt({ instruction, language, code, context, targetFilePath });
        return await runCodingPrompt(event, requestId, assistantInfo, prompt);
    } catch (error) {
        event.sender.send(AiCodingAgentChannels.on_off.STREAM_ERROR, {
            requestId,
            error: error.message,
        });
        return { success: false, error: error.message };
    }
}

// Handle code explanation
async function handleExplainCode(event, data) {
    const { requestId, code, language, context, assistantId } = data;

    console.log('[AI Coding Agent Backend] Explain code request', { requestId, language, codeLength: code?.length, assistantId });

    try {
        const assistantInfo = selectCodingAssistant(assistantId);

        const prompt = `Explain the following ${language || ""} code:

\`\`\`${language || ""}
${code}
\`\`\`

${context ? `Relevant bundled FDO SDK knowledge:\n${context}\n` : ''}

Provide a clear, concise explanation of what this code does, how it works, and any notable patterns or practices used.`;
        return await runCodingPrompt(event, requestId, assistantInfo, prompt);
    } catch (error) {
        event.sender.send(AiCodingAgentChannels.on_off.STREAM_ERROR, {
            requestId,
            error: error.message,
        });
        return { success: false, error: error.message };
    }
}

// Handle code fixing
async function handleFixCode(event, data) {
    const { requestId, code, error, language, context, assistantId, targetFilePath } = data;

    console.log('[AI Coding Agent Backend] Fix code request', { requestId, language, codeLength: code?.length, assistantId });

    try {
        const assistantInfo = selectCodingAssistant(assistantId);

        const prompt = buildFixCodePrompt({ error, language, code, context, targetFilePath });
        return await runCodingPrompt(event, requestId, assistantInfo, prompt);
    } catch (error) {
        event.sender.send(AiCodingAgentChannels.on_off.STREAM_ERROR, {
            requestId,
            error: error.message,
        });
        return { success: false, error: error.message };
    }
}

export function buildSmartModePrompt({ prompt, code, language, context } = {}) {
    const selectedCode = code
        ? `Selected code in ${language || "current file"}:\n\`\`\`${language || ""}\n${code}\n\`\`\`\n\n`
        : "";
    const additionalContext = context ? `Additional plugin context:\n${context}\n\n` : "";
    return `USER REQUEST\n${prompt}\n\n${selectedCode}${additionalContext}
Respond using only the supplied plugin workspace context and public plugin contract. Do not claim you inspected files, ran commands, or received diagnostics that are absent from the context. Do not request or describe product-host source, settings, credentials, internal logs, or application architecture.

For implementation requests, return complete workspace file sections that use virtual paths only. For review requests, explain concrete plugin issues and keep the workspace unchanged. Do not include meta-commentary about action selection.`;
}

// Handle smart mode - AI determines the action
async function handleSmartMode(event, data) {
    const { requestId, prompt, code, language, context, assistantId } = data;

    console.log('[AI Coding Agent Backend] Smart mode request', { requestId, language, promptLength: prompt?.length, hasCode: !!code, hasContext: !!context });

    try {
        const assistantInfo = selectCodingAssistant(assistantId);
        const fullPrompt = buildSmartModePrompt({ prompt, code, language, context });
        console.log('[AI Coding Agent Backend] Sending to coding backend');
        return await runCodingPrompt(event, requestId, assistantInfo, fullPrompt);
    } catch (error) {
        console.error('[AI Coding Agent Backend] Error in handleSmartMode', error);
        event.sender.send(AiCodingAgentChannels.on_off.STREAM_ERROR, {
            requestId,
            error: error.message,
        });
        return { success: false, error: error.message };
    }
}

async function handleRouteJudge(_event, data = {}) {
    const {
        assistantId,
        prompt = "",
        previousResponse = "",
        selectedCode = "",
        requestedAction = "smart",
        deterministicAction = "smart",
        createProjectFiles = false,
        executeWorkspacePlan = false,
    } = data || {};

    try {
        const assistantInfo = selectCodingAssistant(assistantId);
        if (!assistantInfo?.provider || assistantInfo.provider === "codex-cli" || assistantInfo.provider === "gemini-cli") {
            return {
                success: true,
                judge: {
                    available: false,
                    route: deterministicAction,
                    confidence: 0,
                    reasons: ["route-judge-unavailable-for-provider"],
                },
            };
        }

        const routerPrompt = [
            "Classify this AI coding assistant turn for safe routing.",
            "Return strict JSON only.",
            "",
            "Allowed routes: smart, generate, edit, explain, fix, plan",
            "Interpretation rules:",
            "- smart = advisory / analysis / verification / diagnostics-only / safest fallback",
            "- generate = create new code when explicit code creation is requested",
            "- edit = modify existing code when explicit editing/refactoring is requested",
            "- explain = explain selected code",
            "- fix = repair bugs or failing code/tests",
            "- plan = multi-file or executable workspace plan request",
            "- If the user is asking a question, verification request, or log check, prefer smart unless explicit code changes are requested.",
            "- If the turn is a short follow-up like 'yes, please make those changes', only choose a mutating route when the turn itself clearly confirms code changes.",
            "- When uncertain, choose smart.",
            "- Confidence must be a number from 0 to 1.",
            "",
            `Requested action: ${JSON.stringify(requestedAction)}`,
            `Deterministic action: ${JSON.stringify(deterministicAction)}`,
            `Candidate project-file creation: ${JSON.stringify(!!createProjectFiles)}`,
            `Candidate workspace-plan execution: ${JSON.stringify(!!executeWorkspacePlan)}`,
            `Has selected code: ${JSON.stringify(!!String(selectedCode || "").trim())}`,
            `Previous AI response summary: ${JSON.stringify(String(previousResponse || "").slice(0, 1200))}`,
            `Latest user turn: ${JSON.stringify(String(prompt || ""))}`,
            "",
            'Return exactly: {"route":"smart","confidence":0.0,"intent":{"isQuestion":false,"asksForCodeChange":false,"asksForFileCreation":false,"asksForPlanExecution":false,"isFollowupConfirmation":false},"reasons":["..."]}',
        ].join("\n");

        const routerLlm = new LLM({
            service: assistantInfo.provider,
            apiKey: assistantInfo.apiKey,
            model: assistantInfo.model,
            stream: false,
            extended: false,
            max_tokens: 260,
            temperature: 0,
        });

        reserveLiveAiTestRequest();
        const resp = await routerLlm.chat(routerPrompt);
        const raw = typeof resp === "string" ? resp : (resp?.content || "");
        const jsonText = extractJsonObject(raw);
        if (!jsonText) {
            return {
                success: true,
                judge: {
                    available: false,
                    route: deterministicAction,
                    confidence: 0,
                    reasons: ["route-judge-no-json"],
                },
            };
        }

        const parsed = JSON.parse(jsonText);
        const judge = normalizeRouteJudgePayload(parsed);
        if (!judge) {
            return {
                success: true,
                judge: {
                    available: false,
                    route: deterministicAction,
                    confidence: 0,
                    reasons: ["route-judge-invalid-payload"],
                },
            };
        }

        return { success: true, judge };
    } catch (error) {
        return {
            success: true,
            judge: {
                available: false,
                route: deterministicAction,
                confidence: 0,
                reasons: [error?.message || "route-judge-error"],
            },
        };
    }
}

// Handle code planning - Generate plugin scaffold
async function handlePlanCode(event, data) {
    const { requestId, prompt, image, context, assistantId } = data;

    console.log('[AI Coding Agent Backend] Plan code request', { requestId, promptLength: prompt?.length, hasImage: !!image, assistantId });

    try {
        const assistantInfo = selectCodingAssistant(assistantId);
        const executionMode = /EXECUTION MODE:\s*WORKSPACE TASK IMPLEMENTATION/i.test(prompt || "");
        console.log("[AI Coding Agent Backend] Plan request context", {
            requestId,
            executionMode,
            contextLength: context?.length || 0,
            provider: assistantInfo.provider,
            model: assistantInfo.model,
        });

        const fullPrompt = buildPlanCodePrompt({
            prompt,
            image,
            context,
            executionMode,
        });

        console.log('[AI Coding Agent Backend] Sending plan request to LLM', {
            requestId,
            executionMode,
            finalPromptLength: fullPrompt.length,
        });
        sendBackendStatus(
            event,
            requestId,
            executionMode
                ? "Preparing focused implementation request from workspace task files."
                : "Preparing full plugin scaffold request.",
            { phase: "prepare", executionMode, promptLength: fullPrompt.length, contextLength: context?.length || 0 },
        );
        return await runCodingPrompt(event, requestId, assistantInfo, fullPrompt, { image });
    } catch (error) {
        console.error('[AI Coding Agent Backend] Error in handlePlanCode', error);
        event.sender.send(AiCodingAgentChannels.on_off.STREAM_ERROR, {
            requestId,
            error: error.message,
        });
        return { success: false, error: error.message };
    }
}

async function handleCancelRequest(_event, data) {
    const requestId = data?.requestId;
    if (!requestId) {
        return { success: false, error: "Missing requestId." };
    }

    const activeRequest = getActiveCodingRequestState(requestId);
    if (!activeRequest) {
        return { success: false, requestId, error: "No active AI request found." };
    }

    activeRequest.cancelled = true;
    if (typeof activeRequest.cancel === "function") {
        activeRequest.cancel();
    }

    return { success: true, requestId, cancelled: true };
}

export function registerAiCodingAgentHandlers() {
    ipcMain.handle(AiCodingAgentChannels.ROUTE_JUDGE, handleRouteJudge);
    ipcMain.handle(AiCodingAgentChannels.GENERATE_CODE, handleGenerateCode);
    ipcMain.handle(AiCodingAgentChannels.EDIT_CODE, handleEditCode);
    ipcMain.handle(AiCodingAgentChannels.EXPLAIN_CODE, handleExplainCode);
    ipcMain.handle(AiCodingAgentChannels.FIX_CODE, handleFixCode);
    ipcMain.handle(AiCodingAgentChannels.SMART_MODE, handleSmartMode);
    ipcMain.handle(AiCodingAgentChannels.PLAN_CODE, handlePlanCode);
    ipcMain.handle(AiCodingAgentChannels.CANCEL_REQUEST, handleCancelRequest);
}
