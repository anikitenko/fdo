// OpenRouter is an OpenAI-compatible aggregator that explicitly supports
// external applications. Free access comes from zero-priced catalog entries
// (":free" variants and models whose prompt/completion prices are both zero).
// Endpoint and catalog metadata: https://openrouter.ai/docs/api-reference
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

function requireOpenRouterApiKey(apiKey) {
    const trimmed = String(apiKey || "").trim();
    if (!trimmed) throw new Error("An OpenRouter API key is required.");
    return trimmed;
}

function isOpenRouterFreeModel(model = {}) {
    const id = String(model?.id || "");
    if (id.endsWith(":free")) return true;
    const pricing = model?.pricing;
    return String(pricing?.prompt ?? "") === "0" && String(pricing?.completion ?? "") === "0";
}

function openRouterModelModalities(model = {}) {
    const inputs = [
        model?.architecture?.input_modalities,
        model?.modalities?.input,
        model?.input_modalities,
    ].find(Array.isArray);
    if (!inputs) return null;
    return inputs.map((value) => String(value).toLowerCase());
}

// Chat usability filter for the free catalog: coding assistants need text in
// and text out. Music/audio-output and embedding-style entries can be free
// without being usable as a coding model, so they stay out of Settings.
function isOpenRouterChatUsable(model = {}) {
    const id = String(model?.id || "");
    if (/embedding|rerank|moderation|content-safety|whisper|tts|stt|lyria|audio/i.test(id)) return false;
    const outputs = model?.architecture?.output_modalities;
    if (Array.isArray(outputs) && outputs.length && !outputs.map((v) => String(v).toLowerCase()).includes("text")) {
        return false;
    }
    return true;
}

// The model catalog is public metadata: no key, no tokens. Free-tier request
// budgets must never be spent on discovery or verification.
async function fetchOpenRouterCatalog({fetchImpl = globalThis.fetch, signal} = {}) {
    let response;
    try {
        response = await fetchImpl(`${OPENROUTER_BASE_URL}/models`, {signal, redirect: "error"});
    } catch (error) {
        if (error?.name === "AbortError") throw error;
        throw new Error(`Could not reach OpenRouter at ${OPENROUTER_BASE_URL}: ${String(error?.message || error)}`);
    }
    if (!response.ok) {
        throw new Error(`OpenRouter model discovery failed (HTTP ${response.status}).`);
    }
    const payload = await response.json();
    const raw = Array.isArray(payload?.data) ? payload.data : null;
    if (!raw) throw new Error("OpenRouter returned an unexpected model catalog shape.");
    return raw
        .map((item) => ({id: String(item?.id || "").trim(), item}))
        .filter((entry) => entry.id);
}

// Validates the key against OpenRouter's key endpoint. Metadata-only: the
// response carries limits and balance, never model output.
async function verifyOpenRouterApiKey(apiKey, {fetchImpl = globalThis.fetch, signal} = {}) {
    const key = requireOpenRouterApiKey(apiKey);
    let response;
    try {
        response = await fetchImpl(`${OPENROUTER_BASE_URL}/auth/key`, {
            headers: {authorization: `Bearer ${key}`},
            signal,
            redirect: "error",
        });
    } catch (error) {
        if (error?.name === "AbortError") throw error;
        throw new Error(`Could not reach OpenRouter at ${OPENROUTER_BASE_URL}: ${String(error?.message || error)}`);
    }
    if (response.status === 401 || response.status === 403) {
        throw new Error("OpenRouter rejected the API key. Create a key at https://openrouter.ai/keys and try again.");
    }
    if (!response.ok) {
        throw new Error(`OpenRouter key verification failed (HTTP ${response.status}).`);
    }
    return true;
}

// Settings dropdown: free, chat-usable models only. A provided key is checked
// first so a bad key surfaces where the user is still editing, not later.
async function listOpenRouterModels(apiKey, options = {}) {
    if (String(apiKey || "").trim()) {
        await verifyOpenRouterApiKey(apiKey, options);
    }
    const catalog = await fetchOpenRouterCatalog(options);
    const models = catalog
        .filter((entry) => isOpenRouterFreeModel(entry.item) && isOpenRouterChatUsable(entry.item))
        .map((entry) => ({label: entry.id, value: entry.id, provider: "openrouter", inputModalities: openRouterModelModalities(entry.item)}))
        .sort((a, b) => a.label.localeCompare(b.label));
    if (!models.length) {
        throw new Error("OpenRouter currently lists no free chat-capable models.");
    }
    return models;
}

// Validates the key and model against the live catalog without generating
// tokens. requireVision is a metadata check: entries that declare their input
// modalities are enforced, missing declarations are left to fail on the first
// image message rather than spending a free-tier request to probe.
async function inspectOpenRouterModel(config = {}, {requireVision = false, ...options} = {}) {
    const model = String(config.model || "").trim();
    if (!model) throw new Error("Select an OpenRouter model.");
    await verifyOpenRouterApiKey(config.apiKey, options);
    const catalog = await fetchOpenRouterCatalog(options);
    const entry = catalog.find((candidate) => candidate.id === model);
    if (!entry) {
        const alternatives = catalog.filter(candidate => isOpenRouterFreeModel(candidate.item)
            && isOpenRouterChatUsable(candidate.item)
            && (!requireVision || openRouterModelModalities(candidate.item)?.includes('image')))
            .map(candidate => candidate.id).sort().slice(0, 6);
        const hint = alternatives.length
            ? ` Current free ${requireVision ? 'image-capable ' : ''}chat models include: ${alternatives.join(', ')}.`
            : ` No free ${requireVision ? 'image-capable ' : ''}chat alternatives were confirmed by this catalog.`;
        throw Object.assign(new Error(`OpenRouter does not offer "${model}" in its current catalog (${catalog.length} available). Select a currently listed model.${hint}`),
            {code: 'AI_MODEL_UNAVAILABLE'});
    }
    const modalities = openRouterModelModalities(entry.item);
    if (requireVision && modalities && !modalities.includes("image")) {
        throw new Error(`OpenRouter model "${model}" accepts text only. Choose a vision-capable model for screenshot requests.`);
    }
    return {id: entry.id, free: isOpenRouterFreeModel(entry.item), modalities,
        supportedParameters: Array.isArray(entry.item.supported_parameters) ? entry.item.supported_parameters : []};
}

module.exports = {
    OPENROUTER_BASE_URL,
    isOpenRouterFreeModel,
    listOpenRouterModels,
    inspectOpenRouterModel,
};
