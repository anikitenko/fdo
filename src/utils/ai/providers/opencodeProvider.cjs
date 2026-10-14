// OpenCode Zen is an OpenAI-compatible gateway for curated coding models,
// including the free MiMo, DeepSeek, Qwen and MiniMax variants. Endpoint and
// catalog metadata: https://opencode.ai/docs/zen
const OPENCODE_ZEN_BASE_URL = "https://opencode.ai/zen/v1";

function requireOpenCodeApiKey(apiKey) {
    const trimmed = String(apiKey || "").trim();
    if (!trimmed) throw new Error("An OpenCode Zen API key is required.");
    return trimmed;
}

// OpenCode configuration files reference models as opencode/<id>; the gateway
// itself serves the bare id.
function normalizeOpenCodeModelId(model) {
    return String(model || "").trim().replace(/^opencode\//, "");
}

function isOpenCodeFreeModel(modelId) {
    return /-free$/.test(modelId) || modelId === "big-pickle";
}

// Metadata-only modalities check. Fields vary between gateway versions, so a
// missing declaration is treated as unknown rather than as a rejection.
function openCodeModelModalities(model = {}) {
    const inputs = [
        model.modalities?.input,
        model.architecture?.input_modalities,
        model.input_modalities,
        model.capabilities?.input,
    ].find(Array.isArray);
    if (!inputs) return null;
    return inputs.map((value) => String(value).toLowerCase());
}

async function fetchOpenCodeModelCatalog(apiKey, {fetchImpl = globalThis.fetch, signal} = {}) {
    const key = requireOpenCodeApiKey(apiKey);
    let response;
    try {
        response = await fetchImpl(`${OPENCODE_ZEN_BASE_URL}/models`, {
            headers: {authorization: `Bearer ${key}`},
            signal,
            redirect: "error",
        });
    } catch (error) {
        if (error?.name === "AbortError") throw error;
        throw new Error(`Could not reach OpenCode Zen at ${OPENCODE_ZEN_BASE_URL}: ${String(error?.message || error)}`);
    }
    if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
            throw new Error("OpenCode Zen rejected the API key. Create a key at https://opencode.ai/auth and try again.");
        }
        throw new Error(`OpenCode Zen model discovery failed (HTTP ${response.status}).`);
    }
    const payload = await response.json();
    const raw = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : null;
    if (!raw) throw new Error("OpenCode Zen returned an unexpected model catalog shape.");
    return raw
        .map((item) => ({id: String(item?.id || item?.name || "").trim(), item}))
        .filter((entry) => entry.id);
}

async function listOpenCodeModels(apiKey, options = {}) {
    const catalog = await fetchOpenCodeModelCatalog(apiKey, options);
    return catalog
        .map((entry) => ({
            label: isOpenCodeFreeModel(entry.id) ? `${entry.id} (free)` : entry.id,
            value: entry.id,
            provider: "opencode",
            inputModalities: openCodeModelModalities(entry.item),
            free: isOpenCodeFreeModel(entry.id),
        }))
        .sort((a, b) => (Number(b.free) - Number(a.free)) || a.label.localeCompare(b.label))
        .map(({free, ...model}) => model);
}

// Validates the key and model against the live catalog without generating
// tokens. requireVision is a best-effort metadata check: gateways that do not
// publish input modalities cannot be proven vision-capable without spending a
// request, so unknown metadata is left to fail on the first image message.
async function inspectOpenCodeModel(config = {}, {requireVision = false, ...options} = {}) {
    const model = normalizeOpenCodeModelId(config.model);
    if (!model) throw new Error("Select an OpenCode Zen model.");
    const catalog = await fetchOpenCodeModelCatalog(config.apiKey, options);
    const entry = catalog.find((candidate) => normalizeOpenCodeModelId(candidate.id) === model);
    if (!entry) {
        throw new Error(`OpenCode Zen does not offer "${model}". Pick a model from the live catalog in Settings (${catalog.length} available).`);
    }
    const modalities = openCodeModelModalities(entry.item);
    if (requireVision && modalities && !modalities.includes("image") && !modalities.includes("image_url")) {
        throw new Error(`OpenCode Zen model "${model}" accepts text only. Choose a vision-capable model for screenshot requests.`);
    }
    return {id: entry.id, free: isOpenCodeFreeModel(entry.id), modalities};
}

module.exports = {OPENCODE_ZEN_BASE_URL, listOpenCodeModels, inspectOpenCodeModel};
