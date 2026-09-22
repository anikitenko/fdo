import LLM from "./aiProviderClient";
import {settings} from "./store";
import {
    hasCapability,
    SYSTEM_AI_ASSISTANTS_LIST_CAPABILITY,
    SYSTEM_AI_CAPABILITY,
    SYSTEM_AI_REQUEST_CAPABILITY,
} from "./pluginCapabilities";

export const HOST_AI_PRESET_ID = "host.ai";
export const FDO_AI_LIST_ASSISTANTS_HANDLER_ID = "fdo.ai.assistants.list.v1";
export const FDO_AI_REQUEST_HANDLER_ID = "fdo.ai.request.v1";
export const HOST_AI_MAX_ASSISTANTS = 100;

const AI_LIST_REQUIRED_CAPABILITIES = Object.freeze([
    SYSTEM_AI_CAPABILITY,
    SYSTEM_AI_ASSISTANTS_LIST_CAPABILITY,
]);
const AI_REQUEST_REQUIRED_CAPABILITIES = Object.freeze([
    SYSTEM_AI_CAPABILITY,
    SYSTEM_AI_REQUEST_CAPABILITY,
]);

function success(payload = {}) {
    return {
        ok: true,
        ...payload,
    };
}

function failure(code, message, details = {}, options = {}) {
    return {
        ok: false,
        code: String(code || "AI_REQUEST_FAILED"),
        error: String(message || "AI request failed."),
        degraded: options?.degraded === true,
        details: details && typeof details === "object" ? details : {},
    };
}

function toNormalizedText(value = "") {
    return String(value ?? "").trim().toLowerCase();
}

function toIsoTimestamp(value) {
    const timestamp = new Date(value || 0).getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
}

function normalizePurpose(value = "") {
    const normalized = toNormalizedText(value);
    if (normalized === "chat" || normalized === "coding") {
        return normalized;
    }
    return "";
}

function normalizeAssistant(raw = {}, purpose = "") {
    const id = String(raw?.id || "").trim();
    if (!id) return null;
    return {
        id,
        name: String(raw?.name || id).trim() || id,
        purpose: normalizePurpose(raw?.purpose) || purpose || undefined,
        provider: String(raw?.provider || "").trim() || undefined,
        model: String(raw?.model || "").trim() || undefined,
        default: raw?.default === true,
        createdAt: String(raw?.createdAt || "").trim(),
        updatedAt: String(raw?.updatedAt || "").trim(),
        apiKey: String(raw?.apiKey || "").trim(),
    };
}

function assistantComparator(left, right) {
    if (left.default !== right.default) {
        return left.default ? -1 : 1;
    }
    const byName = left.name.localeCompare(right.name, undefined, {sensitivity: "base"});
    if (byName !== 0) return byName;
    return left.id.localeCompare(right.id, undefined, {sensitivity: "base"});
}

export function listHostAiAssistants(options = {}) {
    const chatAssistants = (settings.get("ai.chat", []) || [])
        .map((item) => normalizeAssistant(item, "chat"))
        .filter(Boolean);
    const codingAssistants = (settings.get("ai.coding", []) || [])
        .map((item) => normalizeAssistant(item, "coding"))
        .filter(Boolean);
    const all = [...chatAssistants, ...codingAssistants];

    // Deterministic dedupe by assistant id using the most recently updated record.
    const byId = new Map();
    for (const assistant of all) {
        const existing = byId.get(assistant.id);
        if (!existing) {
            byId.set(assistant.id, assistant);
            continue;
        }
        const nextTimestamp = Math.max(toIsoTimestamp(assistant.updatedAt), toIsoTimestamp(assistant.createdAt));
        const existingTimestamp = Math.max(toIsoTimestamp(existing.updatedAt), toIsoTimestamp(existing.createdAt));
        if (nextTimestamp > existingTimestamp) {
            byId.set(assistant.id, assistant);
        }
    }

    const requestedPurpose = normalizePurpose(options?.purpose);
    const requestedProvider = toNormalizedText(options?.provider);
    const requestedModel = toNormalizedText(options?.model);

    return [...byId.values()]
        .filter((assistant) => !requestedPurpose || toNormalizedText(assistant.purpose) === requestedPurpose)
        .filter((assistant) => !requestedProvider || toNormalizedText(assistant.provider) === requestedProvider)
        .filter((assistant) => !requestedModel || toNormalizedText(assistant.model) === requestedModel)
        .sort(assistantComparator)
        .slice(0, HOST_AI_MAX_ASSISTANTS)
        .map((assistant) => ({
            id: assistant.id,
            name: assistant.name,
            purpose: assistant.purpose,
            provider: assistant.provider,
            model: assistant.model,
            default: assistant.default === true,
        }));
}

export function checkHostAiCapabilities(grantedCapabilities = [], requiredCapabilities = []) {
    const missing = (Array.isArray(requiredCapabilities) ? requiredCapabilities : [])
        .filter((capability) => !hasCapability(grantedCapabilities, capability));
    if (missing.length === 0) {
        return null;
    }
    return failure(
        "AI_CAPABILITY_DENIED",
        `Missing required capabilities: ${missing.join(", ")}.`,
        {
            requiredCapabilities: requiredCapabilities,
            missingCapabilities: missing,
            remediation: "Grant the listed AI capabilities in Manage Plugins -> Capabilities.",
            presetId: HOST_AI_PRESET_ID,
        }
    );
}

function resolveAssistantFromList(assistants = [], request = {}) {
    const requestedAssistantId = String(request?.assistantId || "").trim();
    const requestedPurpose = normalizePurpose(request?.assistantPurpose);
    const requestedProvider = toNormalizedText(request?.assistantProvider);
    const requestedModel = toNormalizedText(request?.assistantModel);

    const byId = requestedAssistantId
        ? assistants.find((assistant) => assistant.id === requestedAssistantId) || null
        : null;
    if (byId) {
        return {
            assistant: byId,
            resolution: "assistantId",
            staleAssistantId: false,
        };
    }

    const byPurpose = requestedPurpose
        ? assistants.find((assistant) => normalizePurpose(assistant.purpose) === requestedPurpose) || null
        : null;
    if (byPurpose) {
        return {
            assistant: byPurpose,
            resolution: "assistantPurpose",
            staleAssistantId: Boolean(requestedAssistantId),
        };
    }

    const byProviderModel = (requestedProvider || requestedModel)
        ? assistants.find((assistant) => {
            if (requestedProvider && toNormalizedText(assistant.provider) !== requestedProvider) return false;
            return !(requestedModel && toNormalizedText(assistant.model) !== requestedModel);

        }) || null
        : null;
    if (byProviderModel) {
        return {
            assistant: byProviderModel,
            resolution: "assistantProviderModel",
            staleAssistantId: Boolean(requestedAssistantId),
        };
    }

    const fallback = assistants[0] || null;
    return {
        assistant: fallback,
        resolution: "default",
        staleAssistantId: Boolean(requestedAssistantId && !byId),
    };
}

function extractLlmContent(response) {
    if (typeof response === "string") {
        return response.trim();
    }
    if (response && typeof response === "object") {
        if (typeof response.content === "string") {
            return response.content.trim();
        }
        if (Array.isArray(response.choices)) {
            return response.choices
                .map((choice) => String(choice?.message?.content || choice?.text || "").trim())
                .filter(Boolean)
                .join("\n")
                .trim();
        }
    }
    return String(response || "").trim();
}

function buildTaskPrompt(payload = {}, assistant = {}) {
    const task = String(payload?.task || "").trim().toLowerCase();
    const prompt = String(payload?.prompt || "").trim();
    const summary = String(payload?.summary || "").trim();
    const commandOutput = String(payload?.commandOutput || "").trim();
    const repoPath = String(payload?.repoPath || "").trim();
    const recentRuns = Array.isArray(payload?.recentRuns) ? payload.recentRuns.slice(0, 20) : [];

    const serializedRecentRuns = recentRuns.length > 0
        ? JSON.stringify(recentRuns, null, 2)
        : "";

    const sections = [
        `Task: ${task || "general"}`,
        assistant?.purpose ? `Assistant purpose: ${assistant.purpose}` : "",
        repoPath ? `Repository path: ${repoPath}` : "",
        summary ? `Summary:\n${summary}` : "",
        prompt ? `Prompt:\n${prompt}` : "",
        commandOutput ? `Command output:\n${commandOutput}` : "",
        serializedRecentRuns ? `Recent runs:\n${serializedRecentRuns}` : "",
    ].filter(Boolean);

    if (task === "commit-message") {
        return [
            "Generate a concise conventional commit message.",
            "Return only the commit message text without markdown fences.",
            ...sections,
        ].join("\n\n");
    }

    if (task === "summarize-command-output") {
        return [
            "Summarize the command output with key findings and next steps.",
            "Keep the response short and actionable.",
            ...sections,
        ].join("\n\n");
    }

    return sections.join("\n\n");
}

export async function handleHostAiAssistantsListRequest(payload = {}, options = {}) {
    const capabilityError = checkHostAiCapabilities(
        options?.grantedCapabilities || [],
        AI_LIST_REQUIRED_CAPABILITIES
    );
    if (capabilityError) {
        return capabilityError;
    }

    const assistants = listHostAiAssistants(payload || {});
    if (assistants.length === 0) {
        return success({
            assistants: [],
            degraded: true,
            code: "AI_NO_ASSISTANTS",
            message: "No assistants are configured in host settings.",
        });
    }
    return success({
        assistants,
    });
}

export async function handleHostAiRequest(payload = {}, options = {}) {
    const capabilityError = checkHostAiCapabilities(
        options?.grantedCapabilities || [],
        AI_REQUEST_REQUIRED_CAPABILITIES
    );
    if (capabilityError) {
        return capabilityError;
    }

    const task = String(payload?.task || "").trim();
    if (!task) {
        return failure("AI_REQUEST_INVALID", "Field \"task\" is required.");
    }

    const assistants = listHostAiAssistants({
        purpose: payload?.assistantPurpose,
        provider: payload?.assistantProvider,
        model: payload?.assistantModel,
    });
    if (assistants.length === 0) {
        return failure(
            "AI_NO_ASSISTANTS",
            "No assistants are configured in host settings.",
            {
                remediation: "Add at least one assistant in Settings -> AI Assistants, then retry.",
            },
            {degraded: true}
        );
    }

    const selected = resolveAssistantFromList(assistants, payload);
    const assistant = selected?.assistant;
    if (!assistant) {
        return failure("AI_ASSISTANT_RESOLUTION_FAILED", "Failed to resolve an assistant for the request.", {}, {degraded: true});
    }

    const fullRecord = (settings.get(`ai.${assistant.purpose || "coding"}`, []) || [])
        .find((item) => String(item?.id || "").trim() === assistant.id) || null;
    if (!fullRecord) {
        return failure(
            "AI_ASSISTANT_STALE",
            "Selected assistant is no longer available.",
            {
                requestedAssistantId: String(payload?.assistantId || "").trim() || null,
                resolvedAssistantId: assistant.id,
                staleAssistantId: selected?.staleAssistantId === true,
            },
            {degraded: true}
        );
    }

    const normalizedProvider = toNormalizedText(fullRecord.provider);
    if (normalizedProvider === "codex-cli" || normalizedProvider === "gemini-cli") {
        return failure(
            "AI_PROVIDER_UNAVAILABLE",
            "The selected assistant provider is unavailable for plugin host AI requests.",
            {
                provider: fullRecord.provider,
                remediation: "Select an assistant backed by a direct API provider for host AI request routing.",
            },
            {degraded: true}
        );
    }

    try {
        const llm = new LLM({
            service: fullRecord.provider,
            accountId: fullRecord.accountId,
            baseUrl: fullRecord.baseUrl,
            options: fullRecord.contextLength ? {num_ctx: fullRecord.contextLength} : undefined,
            apiKey: fullRecord.apiKey,
            model: fullRecord.model,
            stream: false,
            extended: true,
            max_tokens: 2048,
        });

        const response = await llm.chat(buildTaskPrompt(payload, assistant));
        const text = extractLlmContent(response);
        if (!text) {
            return failure("AI_EMPTY_RESPONSE", "Assistant returned an empty response.", {}, {degraded: true});
        }

        const lowerTask = task.toLowerCase();
        const responsePayload = lowerTask === "commit-message"
            ? {commitMessage: text}
            : lowerTask === "summarize-command-output"
                ? {text}
                : {message: text};

        return success({
            ...responsePayload,
            assistantId: assistant.id,
            resolution: selected?.resolution || "default",
            staleAssistantId: selected?.staleAssistantId === true,
        });
    } catch (error) {
        return failure(
            "AI_REQUEST_FAILED",
            error?.message || String(error),
            {
                assistantId: assistant.id,
                provider: assistant.provider || "",
                model: assistant.model || "",
            },
            {degraded: true}
        );
    }
}
