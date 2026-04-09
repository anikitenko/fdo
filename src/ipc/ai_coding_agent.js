import {ipcMain} from "electron";
import {AiCodingAgentChannels} from "./channels.js";
import LLM from "@themaximalist/llm.js";
import {settings} from "../utils/store.js";
import {spawn} from "node:child_process";
import { resolveCodexCliInvocation } from "../utils/codexCli.js";
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
const PLUGIN_WORKSPACE_ONLY_PROMPT = `
PLUGIN WORKSPACE BOUNDARY:
- AI Coding Assistant is restricted to the current plugin workspace only.
- Treat FDO host application files as out of scope, including src/Home.jsx, src/components/*, src/ipc/*, src/utils/*, src/main.js, src/preload.js, webpack configs, and host application tests, unless those exact files are explicitly present in the provided plugin workspace context.
- Never suggest editing or auditing FDO host application files from AI Coding Assistant.
- If the likely root cause is in the FDO host application rather than the plugin workspace, say that the issue appears host-side and is outside AI Coding Assistant scope, then ask the user to switch to AI Chat or host-development tooling.
- Only reference plugin workspace paths that are present in the provided context or selected code.
- Never invent host-side file paths as a proposed fix for a plugin-scoped request.
`.trim();

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
        max_tokens: 4096,
    });

    llm.system(`
You are an expert coding assistant integrated into the FDO (FlexDevOps) code editor.

Your role is to help developers with:
- Code generation based on natural language descriptions
- Code editing and refactoring
- Code explanation and documentation
- Bug fixing and error resolution

### FDO Plugin Development Context

When working with FDO plugins, be aware of:

**FDO SDK (@anikitenko/fdo-sdk)**
- Plugins extend the FDO_SDK base class and implement FDOInterface
- Required metadata: name, version, author, description, icon
- Lifecycle hooks: init() for initialization, render() for UI rendering, and renderOnLoad() only when the installed SDK/workspace convention uses it
- Communication: IPC message-based communication with main application
- Storage: Multiple backends (in-memory, JSON file-based)
- Logging: Built-in this.log() method
- Use only the documented/exported SDK surface; do NOT import package-internal paths like @anikitenko/fdo-sdk/dist/... unless the current FDO host tooling explicitly provides that data through context
- If you add plugin tests, prefer node:test and node:assert/strict so FDO can run them before build without external installs or plugin-local dependency setup
- Keep plugin tests self-contained: rely on Node built-ins, local plugin source, and the bundled FDO SDK/runtime only. Do NOT assume extra third-party test packages are available on a clean machine unless the host already bundles them.
- In plugin tests, do NOT use bare Jest/Vitest globals. Import describe/test/it/hooks from node:test and use node:assert/strict instead of expect().
- In plugin tests, target local plugin files and exported SDK APIs only. Do NOT write tests that import FDO host/editor implementation files such as components/editor/*, components/plugin/*, ipc/*, VirtualFS.js, PluginContainer.jsx, PluginPage.jsx, pluginTestRunner.js, or validateGeneratedPluginFiles.js.
- Do NOT mimic or recreate FDO's own internal test files such as validate-generated-plugin-files.test.js inside a plugin workspace. Plugin tests should target the plugin's own code and behavior, not FDO host/editor internals.
- If tests are failing and the user asks to fix them, prefer repairing the current plugin code/tests from the provided workspace, Problems, build output, and test output. Do NOT scaffold a new plugin unless the user explicitly asks for a new scaffold.
- Do NOT invent host-app structures inside a plugin workspace fix, such as PluginManager, ipc/channels, preload bridges, registry wiring, or other FDO application internals, unless those exact files are already present in the provided workspace context.
- For operator-style plugins, treat the SDK fixture set as the primary authoring entry point and prefer fixture-oriented snippets over legacy/generic examples
- For privileged/operator plugins, recommend implementing optional declareCapabilities(): PluginCapability[] as an early intent manifest for host preflight and diagnostics
- Phase 1 operator authoring priority:
  1. Suggest the closest fixture under examples/fixtures/
  2. For known operator tool families, prefer createOperatorToolCapabilityPreset(...), createOperatorToolActionRequest(...), and requestOperatorTool(...)
  3. For host-specific/internal tools not covered by curated presets, prefer createProcessCapabilityBundle(...), createProcessScopeCapability(...), and requestScopedProcessExec(...)
     Treat generic scopes such as system-observe, network-diagnostics, service-management, archive-tools, package-management, source-control, build-tooling, task-runners, and platform-specific aliases like homebrew as host-specific fallback scopes, not as equal first-choice production scaffolds
  4. Only suggest createProcessExecActionRequest(...) and requestPrivilegedAction(...) when the user explicitly needs transport-level control, debugging, or a non-curated action family
- Use SDK terminology consistently: operator fixture, curated helper, scoped capability, broad capability plus narrow scope
- Explain operator capabilities as a pair: broad capability system.process.exec plus narrow scope system.process.scope.<scope-id>
- Treat declareCapabilities() as additive diagnostics/preflight UX only. It does not grant authority and does not replace runtime capability checks or host enforcement.
- If capability access is denied, explain which broad capability or narrow scope is missing and whether the user should request a curated tool-family grant or a host-specific scope
- When a generic host scope could fit, still prefer operator fixtures/presets/workflows first and describe the generic scope as a fallback only when no curated operator family fits
- For multi-step host-mediated process orchestration, prefer createScopedWorkflowRequest(...) and requestScopedWorkflow(...) instead of chaining multiple raw process requests inside the plugin
- Recommend the workflow primitive for preview/apply and inspect/act flows when multiple host-mediated steps are involved, but keep single-action fixtures and helpers for single-step cases
- Do not introduce a separate workflow capability in guidance unless the trust model actually changes; first-slice workflows still use system.process.exec plus system.process.scope.<scope-id>
- For clipboard access, prefer host-mediated SDK helpers requestClipboardRead(...) and requestClipboardWrite(...) (or the matching typed request builders) over direct iframe/electron clipboard snippets
- Keep clipboard permissions explicit and separate in guidance: system.clipboard.read and system.clipboard.write are independently grantable, and read is more sensitive
- Do NOT recommend generic shell execution, unrestricted process spawning, root/admin-style plugin permissions, removed legacy scaffolds, ad hoc legacy copies, or numbered learning examples as the default production path

**Plugin Icon Constraint**
- metadata.icon must be a BlueprintJS v6 icon name string
- Use values such as "cog", "settings", "database", "globe", "desktop", or other BlueprintJS v6 icon identifiers
- Do NOT generate icon assets like icon.png, logo.svg, favicon.ico, or other custom image-based plugin icons unless the user explicitly asks for a separate non-metadata asset
- Do NOT describe metadata.icon as a file path or bundled image asset

**Plugin Entry Constraint**
- The plugin entry file should end with explicit plugin instantiation, for example:
  export default MyPlugin;
  new MyPlugin();
- Do NOT leave the plugin class uninstantiated
- Prefer this explicit pattern over inventing alternative bootstrap code unless the existing workspace already uses a different pattern

**UI Boundary Constraint**
- Direct access to host APIs on window.* belongs only in UI-facing code paths
- Use window.* calls from rendered UI event handlers, UI helper modules, or scripts that run in the plugin host page
- Do NOT put window.* side effects directly in metadata, class field initializers, constructors, or broad non-UI bootstrap logic unless the user explicitly asks for that pattern

**Plugin Host Runtime Constraint**
- FDO plugin UI runs inside a sandboxed iframe host
- The host injects supported window helpers such as window.createBackendReq, window.executeInjectedScript, window.waitForElement, window.addGlobalEventListener, window.removeGlobalEventListener, and window.applyClassToSelector
- Treat those helpers as UI-runtime APIs, not general-purpose bootstrap APIs
- If you need host interaction, prefer using those injected helpers from rendered UI behavior instead of assuming unrestricted browser or Electron access
- Injected UI-only libraries and helpers exist only inside that iframe runtime
- Do NOT suggest using goober or other injected UI libraries in backend/bootstrap/error-fallback code paths unless the current workspace already proves they exist there

**Render Pipeline Constraint**
- The plugin UI is mounted through the React-based iframe host pipeline used by PluginContainer and PluginPage
- Prefer the existing workspace's render convention and preserve React-hosted JSX patterns when they already exist
- Do NOT downgrade a React-hosted render path into simplistic raw HTML string examples unless the current plugin code already uses that exact pattern

**DOM Element Generation**
The SDK provides specialized classes for generating plugin UI structures inside the iframe-hosted render pipeline:
- DOMTable: Tables with thead, tbody, tfoot, tr, th, td, caption
- DOMMedia: Images with accessibility support
- DOMSemantic: article, section, nav, header, footer, aside, main
- DOMNested: Ordered lists (ol), definition lists (dl, dt, dd)
- DOMInput: Form inputs, select dropdowns with options
- DOMText: Headings, paragraphs, spans
- DOMButton: Buttons with event handlers
- DOMLink: Anchor elements
- DOMMisc: Horizontal rules and other elements

All DOM classes support:
- Custom CSS styling via goober CSS-in-JS when used in the iframe UI runtime where that helper is actually injected
- Custom classes and inline styles
- HTML attributes
- Event handlers
- Accessibility attributes

**Plugin Structure Guidance:**
- Extend the SDK base class and implement the required plugin interface for the installed SDK version
- Preserve the current workspace's render/runtime conventions instead of inventing a simplified render signature
- End the entry file with explicit plugin instantiation such as:
  export default MyPlugin;
  new MyPlugin();

### Guidelines:
1. Provide clean, production-ready code that follows best practices
2. When generating FDO plugins, use SDK DOM helper classes only when they match the installed SDK and the current workspace convention
3. When generating code, match the style and patterns of the surrounding code
4. When editing code, make minimal changes to achieve the desired result
5. When explaining code, be concise but thorough
6. When fixing bugs, explain what was wrong and how you fixed it
7. Always consider the context of the file being edited (language, framework, etc.)
8. Format your responses appropriately:
   - For code generation/editing: return ONLY the code without explanations unless asked
   - For explanations: provide clear, structured explanations
   - For fixes: include both the fix and a brief explanation
9. When generating FDO plugins, metadata.icon must use a BlueprintJS v6 icon name string, not a custom icon file
10. For FDO plugin entry files, end with explicit instantiation such as new MyPlugin();
11. Keep window.* access inside UI/event code paths instead of broad plugin bootstrap logic
12. If you add tests for an FDO plugin, make them runnable by FDO's bundled pre-build test flow and do not assume Jest, Vitest, npm install, pnpm install, or network dependency download inside the plugin workspace
13. If no tests exist yet, say that clearly and either create self-contained node:test files or explain that Run Tests will skip until tests are added
14. Do NOT say that the workspace is read-only, that the sandbox blocked you, that you cannot edit files here, or that the user must provide a writable workspace. In FDO, reason from the provided code, Problems, build output, and test output instead.
15. Do NOT describe environmental Codex CLI limitations unless the current request explicitly asks about the Codex environment itself

Remember: You are working within a code editor, so precision and correctness are paramount.
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
        execArgs.push(prompt);
        return execArgs;
    };

    const runAttempt = async ({ jsonMode = false, retrying = false } = {}) => {
        return await new Promise((resolve, reject) => {
            const execArgs = buildExecArgs(jsonMode);
            const heartbeatIntervalMs = 10000;
            const startedAt = Date.now();
            let firstContentAt = null;
            const child = spawn(invocation.command, execArgs, {
                env: { ...process.env, ...(invocation.env || {}) },
                stdio: ["ignore", "pipe", "pipe"],
            });
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
                    const message = classifyCodexCliError(stderr) || `Codex CLI exited with code ${code}`;
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

async function runCodingPrompt(event, requestId, assistantInfo, prompt, { image = null } = {}) {
    registerActiveCodingRequest(requestId);
    try {
        const scopedPrompt = `${PLUGIN_WORKSPACE_ONLY_PROMPT}\n\n${prompt}`;
        if (assistantInfo.provider === "codex-cli") {
            if (image) {
                throw new Error("Codex CLI does not support image mockups in this integration yet.");
            }
            return await runCodexCliStream(event, requestId, assistantInfo, scopedPrompt);
        }

        const llm = await createCodingLlm(assistantInfo, true);
        const startedAt = Date.now();
        let firstContentAt = null;
        let waitingHeartbeat = null;
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
        let resp;

        if (image) {
            const messages = [{
                role: "user",
                content: [
                    { type: "text", text: scopedPrompt },
                    {
                        type: "image_url",
                        image_url: { url: image }
                    }
                ]
            }];
            resp = await llm.chat({ messages, stream: true });
        } else {
            llm.user(scopedPrompt);
            resp = await llm.chat({ stream: true });
        }

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

        if (resp && typeof resp === "object" && "stream" in resp && typeof resp.complete === "function") {
            try {
                for await (const chunk of resp.stream) {
                    if (isActiveCodingRequestCancelled(requestId)) {
                        throw new AiCodingRequestCancelledError();
                    }
                    if (!chunk) continue;
                    const { type, content: piece } = chunk;

                    if (type === "content" && piece && typeof piece === "string") {
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
                    }
                }
            } finally {
                clearInterval(waitingHeartbeat);
            }

            if (isActiveCodingRequestCancelled(requestId)) {
                throw new AiCodingRequestCancelledError();
            }

            await resp.complete();
            sendBackendStatus(
                event,
                requestId,
                buildAiCodingDoneStatus(Date.now() - startedAt),
                { phase: "done", elapsedMs: Date.now() - startedAt },
            );
            event.sender.send(AiCodingAgentChannels.on_off.STREAM_DONE, { requestId, fullContent });
            return { success: true, requestId, content: fullContent };
        }

        throw new Error("Invalid response from assistant backend");
    } catch (error) {
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
        unregisterActiveCodingRequest(requestId);
    }
}

export function buildPlanCodePrompt({
    prompt = "",
    image = null,
    context = "",
    executionMode = false,
} = {}) {
    if (executionMode) {
        return `Implement the requested workspace changes based on the user's task description and the provided workspace context.

${prompt}

${context ? `Workspace context:\n${context}\n` : ''}

SOURCE-OF-TRUTH RULES:
- Use the provided workspace context as the source of truth.
- Do NOT invent repository files or architecture that are not present in the provided context.
- Keep the response focused on the requested implementation work, not a broad scaffold or product proposal.
- If you update plugin metadata, metadata.icon must stay a BlueprintJS v6 icon name string and must not become a file path or custom image asset.
- If you update the plugin entry file, keep explicit plugin instantiation at the end of the file, such as new MyPlugin();.
- Keep direct window.* access inside UI/event code paths rather than broad plugin bootstrap logic.

Return ONLY executable file sections in this format:

### File: /path/to/file
\`\`\`typescript
...complete file content...
\`\`\`

If /TODO.md or another task-tracking file is part of the context, update it accurately to reflect completed work.
Never output host-machine or repository absolute paths such as /Users/... , /tmp/... , /var/... or Windows drive paths. Use only virtual workspace paths like /index.ts or /src/view.ts.
Do not return prose-only guidance.`;
    }

    return `Create a detailed implementation plan for an FDO plugin based on the following description:

${prompt}

${image ? '\n[Note: An image mockup has been provided - analyze it and incorporate the UI design into the plan]\n' : ''}

${context ? `Relevant bundled FDO SDK knowledge:\n${context}\n` : ''}

SOURCE-OF-TRUTH RULES:
- Do NOT claim you inspected or analyzed specific repository files unless those files are explicitly included in the provided context.
- If the request is architectural or product-oriented, stay focused on the plugin design and file plan, not on auditing the host FDO application.

Generate a comprehensive plan that includes:

1. **Project Structure**: List all files and folders needed
2. **File Contents**: Provide the complete code for each file

Format your response as a structured plan using the following format:

## Plan Overview
Brief description of what the plugin does and its main features.

## File Structure
\`\`\`
/package.json
/tsconfig.json
/index.ts
/styles.ts (optional - only if the current UI runtime actually uses injected iframe styling helpers)
\`\`\`

## Implementation

### File: /package.json
\`\`\`json
{
  "name": "plugin-name",
  "version": "1.0.0",
  ...complete file content...
}
\`\`\`

### File: /index.ts
\`\`\`typescript
// complete plugin entry file content
\`\`\`

Continue this pattern for ALL files mentioned in the structure.

IMPORTANT CONSTRAINTS:
- FDO plugin UI targets a React-hosted JSX pipeline inside the sandboxed iframe host.
- Plugin render output is not inserted as raw HTML directly. The host sanitizes it, wraps it in a fragment, Babel-transforms it, sends it into PluginPage, turns it into an ES module, and renders it through React in the iframe.
- Do NOT describe FDO plugin UI as “plain HTML strings” as the main abstraction.
- SDK DOM helper classes are still valid when they match the installed SDK and current workspace conventions, because they can generate UI content for that iframe-hosted render pipeline.
- Preserve the current workspace's render convention instead of forcing a different abstraction.
- Use only exported/documented SDK imports. Do NOT import package-internal paths such as @anikitenko/fdo-sdk/dist/... from plugin code.
- If you add plugin tests, prefer node:test plus node:assert/strict so the tests run inside FDO's bundled pre-build test flow without extra plugin dependencies.
- Keep plugin tests self-contained so they run on a clean machine with only FDO installed. Do NOT assume extra test frameworks or plugin-local installs unless the current host bundle explicitly provides them.
- Do NOT generate Jest/Vitest-style tests with bare describe/it/test globals or expect(). Import the test API from node:test and assertions from node:assert/strict.
- In plugin tests, target only local plugin files and exported SDK APIs. Do NOT generate tests that import FDO host/editor implementation files such as components/editor/*, components/plugin/*, ipc/*, VirtualFS.js, PluginContainer.jsx, PluginPage.jsx, pluginTestRunner.js, or validateGeneratedPluginFiles.js.
- Do NOT mimic or recreate FDO's own internal test files such as validate-generated-plugin-files.test.js inside a plugin workspace. Plugin tests must target the plugin's own code and behavior, not FDO host/editor internals.
- If the user says tests/build/problems are failing, fix the current workspace first. Do NOT turn that into a fresh plugin scaffold unless the user explicitly asks for a new plugin.
- Do NOT invent host-app structures inside a plugin workspace fix, such as PluginManager, ipc/channels, preload bridges, registry wiring, or other FDO application internals, unless those exact files are already present in the provided workspace context.
- Do NOT say that the workspace is read-only, that the sandbox blocked the change, or that the user must provide a writable workspace. Use the provided workspace/build/test context and return executable file sections.
- metadata.icon must be a BlueprintJS v6 icon name string such as "cog", "settings", "database", "globe", or "desktop"
- Do NOT create custom plugin icon assets like icon.png, logo.svg, favicon.ico, or any other image file for metadata.icon unless the user explicitly asks for a separate asset outside plugin metadata
- End the plugin entry file with explicit plugin instantiation such as new MyPlugin();
- Keep direct window.* access inside UI/event code paths such as rendered UI handlers, not broad constructor/init/bootstrap logic unless the user explicitly asks for it
- The plugin UI runs in a sandboxed iframe host, so do not assume direct Electron, Node.js, or unrestricted browser APIs
- Use only the injected FDO host helpers for host interaction from UI code paths
- The iframe host may preload UI-only libraries such as goober, ace, highlight.js, notyf, FontAwesome, and Split Grid
- Those injected UI libraries are available only inside the iframe UI runtime, not in plugin backend/bootstrap/error-fallback paths unless the current workspace explicitly proves otherwise
- Plugins have access to these global functions in the plugin host environment:
  * window.createBackendReq(type, data) - for IPC communication with main app
  * window.executeInjectedScript(scriptContent) - to execute dynamic scripts
  * window.waitForElement(selector, callback, timeout) - to wait for DOM elements
  * window.addGlobalEventListener(eventType, callback) - to add event listeners
  * window.removeGlobalEventListener(eventType, callback) - to remove event listeners
  * window.applyClassToSelector(className, selector) - to apply CSS classes

PLUGIN STRUCTURE REQUIREMENTS:
- Extend the installed SDK base class and implement the required plugin interface for that SDK version
- Required metadata: name, version, author, description, icon
- Lifecycle: init() handles initialization and render() provides UI for the iframe-hosted plugin pipeline according to the installed SDK/workspace convention
- Use SDK DOM helper classes only when they match the installed SDK and current workspace pattern
- Use TypeScript for .ts files
- Follow the exact format shown above for each file
- Each file section should start with "### File: /path/to/file"
- Use only virtual workspace paths like /index.ts or /src/view.ts, never host-machine absolute paths such as /Users/... or /tmp/...
- Code blocks must specify the language (json, typescript, css, etc.)

EXAMPLE render() GUIDANCE:
- If the current workspace uses SDK DOM helpers, keep that style.
- If the current workspace already uses JSX-like render content for the iframe host, preserve that style.
- Do NOT introduce backend-only goober usage or error-fallback styling that assumes injected iframe libraries exist outside the UI runtime.`;
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
    let fullPrompt = `User's request: ${prompt}\n\n`;

    if (code) {
        fullPrompt += `Selected code in ${language || 'current file'}:\n\`\`\`${language || ''}\n${code}\n\`\`\`\n\n`;
    }

    if (context) {
        fullPrompt += `Additional context:\n${context}\n\n`;
    }

    fullPrompt += `Provide the appropriate response based on the request.

SOURCE-OF-TRUTH RULES:
- Do NOT claim you inspected or analyzed specific repository files unless those files are explicitly included in the provided context or selected code.
- If the request is about designing or improving a plugin concept, do NOT turn it into a repo audit of the host FDO application.
- When you rely only on bundled FDO SDK knowledge and external references, speak in terms of plugin architecture and capabilities, not specific host-app source files.
- If context includes a "Plugin runtime action report", treat it as the authoritative host-observed runtime/log evidence.
- Do NOT say that the workspace is read-only, that the sandbox blocked you, that you cannot edit or test here, or that the user must provide a writable workspace. In FDO, reason from the provided code, Problems, build output, and test output instead.
- Do NOT claim you ran repo-level commands such as npm test, webpack, or direct Jest runs unless those exact command results are already present in the provided context.

FDO PLUGIN ICON RULE:
- If you generate or modify FDO plugin metadata, metadata.icon must be a BlueprintJS v6 icon name string.
- Do NOT invent icon.png, icon.svg, logo.svg, favicon.ico, or any other custom plugin icon file unless the user explicitly asks for a separate asset outside metadata.icon.

FDO PLUGIN ENTRY RULE:
- For plugin entry files, end with explicit plugin instantiation such as new MyPlugin();.
- Do NOT leave the plugin class uninstantiated.

FDO UI BOUNDARY RULE:
- Keep direct window.* access inside UI/event code paths.
- Do NOT move host-window calls into broad non-UI bootstrap logic unless the user explicitly asks for it.

FDO PLUGIN HOST RULE:
- The plugin UI runs inside a sandboxed iframe host managed by FDO.
- Use only the injected host helpers that are part of the FDO plugin runtime contract.
- Do NOT assume direct Electron, Node.js, or unrestricted browser access from plugin UI code unless the provided context explicitly shows that capability.
- When working inside a plugin workspace, do NOT invent host-app structures such as PluginManager, ipc/channels, preload bridges, registry wiring, or other FDO application internals unless those exact files are explicitly present in the provided context.

IMPORTANT: When providing code (for generation, editing, or fixing):

- Wrap the **actual code to insert** with a SOLUTION marker, like this:

\`\`\`${language || 'code'}
// SOLUTION READY TO APPLY
your code here
\`\`\`

💡 You may include other code blocks for examples, references, or explanations if helpful,
but **ONLY** the block marked with "// SOLUTION READY TO APPLY" will be inserted into the editor.

- Make sure there is a blank line between the opening code fence and the SOLUTION marker
  (or the first line of code in general).
- Clearly explain what you changed and why.
- When applicable, list each modification with before/after comparison.

Return the code or explanation directly — do **not** include meta-commentary about which action you chose.

When the user asks to confirm/check/verify behavior from logs:
- First state what was checked (runtime trace, stdout/stderr tail, log files).
- If evidence is missing, say "Not confirmed from available logs" and why in one line.
- Then give one concrete next verification step with exact signal to look for.
- Do not present missing logs as a confirmed code failure.
`;
    return fullPrompt;
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
        if (!assistantInfo?.provider || assistantInfo.provider === "codex-cli") {
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
