const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";

function normalizeOllamaBaseUrl(value = DEFAULT_OLLAMA_URL) {
    let url;
    try { url = new URL(value || DEFAULT_OLLAMA_URL); } catch { throw new Error("Enter a valid Ollama server URL."); }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
        throw new Error("Ollama URL must use HTTP or HTTPS without credentials, query parameters, or a fragment.");
    }
    return url.href.replace(/\/+$/, "");
}

async function ollamaJson(baseUrl, path, {body, signal, fetchImpl = globalThis.fetch} = {}) {
    const controller = new AbortController();
    const cancel = () => controller.abort(signal?.reason);
    if (signal?.aborted) cancel();
    else signal?.addEventListener("abort", cancel, {once: true});
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
        const response = await fetchImpl(`${normalizeOllamaBaseUrl(baseUrl)}/${path}`, {
            method: body ? "POST" : "GET", signal: controller.signal,
            headers: {"Content-Type": "application/json"},
            ...(body ? {body: JSON.stringify(body)} : {}),
        });
        const data = await response.json();
        if (!response.ok || data.error) throw new Error(data.error || `Ollama returned HTTP ${response.status}.`);
        return data;
    } catch (error) {
        if (signal?.aborted) throw error;
        throw new Error(`Ollama connection failed: ${error.message}. Check that Ollama is running and the model is downloaded.`);
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", cancel);
    }
}

async function listOllamaModels(baseUrl, options) {
    const data = await ollamaJson(baseUrl, "api/tags", options);
    return (data.models || []).map(model => ({label: model.name, value: model.name, provider: "ollama"}));
}

async function inspectOllamaModel(baseUrl, model, {requireVision = false, ...options} = {}) {
    if (!String(model || "").trim()) throw new Error("Choose a downloaded Ollama model.");
    const data = await ollamaJson(baseUrl, "api/show", {...options, body: {model}});
    if (data.remote_model || data.remote_host || /(?:^|[-:])cloud(?:$|[-:])/i.test(model)) {
        throw new Error("Choose a locally downloaded model. Ollama cloud models are not supported by the local coding provider.");
    }
    if (!Array.isArray(data.capabilities) || !data.capabilities.includes("completion")) {
        throw new Error("This Ollama model does not report text-generation support. Choose a completion model and update Ollama if needed.");
    }
    if (requireVision && !data.capabilities.includes("vision")) {
        throw new Error(`Ollama model "${model}" does not support images. Choose a vision-capable model for screenshot-based generation.`);
    }
    return data;
}

function ollamaLlmOptions(assistant = {}) {
    if (assistant.provider !== "ollama") return {};
    const contextLength = Number(assistant.contextLength ?? 32768);
    if (!Number.isInteger(contextLength) || contextLength < 4096 || contextLength > 262144) {
        throw new Error("Ollama context length must be an integer from 4096 to 262144.");
    }
    return {baseUrl: normalizeOllamaBaseUrl(assistant.baseUrl), apiKey: "", options: {num_ctx: contextLength}};
}

module.exports = {DEFAULT_OLLAMA_URL, normalizeOllamaBaseUrl, listOllamaModels, inspectOllamaModel, ollamaLlmOptions};
