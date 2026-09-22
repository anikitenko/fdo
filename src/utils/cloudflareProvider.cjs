// Fixed Cloudflare origin: credentials must never follow a configurable host or redirect.
function cloudflareAccountId(value) {
    const id = String(value || '').trim();
    if (!/^[a-f0-9]{32}$/i.test(id)) throw new Error('Cloudflare account ID must contain 32 hexadecimal characters.');
    return id;
}

function cloudflareConnection(config) {
    const accountId = cloudflareAccountId(config.accountId);
    const apiKey = String(config.apiKey || '').trim();
    if (!apiKey) throw new Error('Cloudflare Workers AI requires an API token.');
    return {baseUrl: `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai`, apiKey};
}

function cloudflareRunPath({accountId, model}) {
    // Workers AI model IDs are path hierarchies (e.g. @cf/qwen/model),
    // not a single URL segment. Reject URL syntax and traversal before joining.
    if (typeof model !== 'string' || !model.split('/').every(segment =>
        segment.length > 0 && !/[^A-Za-z0-9@._-]/.test(segment) && segment !== '.' && segment !== '..')) {
        throw new Error('Cloudflare model ID must contain safe, non-empty path segments.');
    }
    return `/accounts/${cloudflareAccountId(accountId)}/ai/run/${model}`;
}

function cloudflareError(payload, status, apiKey) {
    const detail = payload?.error || payload?.errors?.[0];
    const message = typeof detail === 'string' ? detail : detail?.message;
    const error = new Error(`Cloudflare Workers AI: ${String(message || `HTTP ${status || 'invalid response'}`).split(apiKey || '[unused-secret]').join('[REDACTED]')}`);
    error.status = status;
    error.code = detail?.code || detail?.type;
    return error;
}

async function cloudflareJson(config, resource, {fetchImpl = fetch, signal, timeoutMs = 15000} = {}) {
    const {baseUrl, apiKey} = cloudflareConnection(config);
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) abort();
    signal?.addEventListener('abort', abort, {once: true});
    const timer = setTimeout(abort, timeoutMs);
    try {
        const response = await fetchImpl(`${baseUrl}/${resource}`, {
            headers: {Authorization: `Bearer ${apiKey}`}, signal: controller.signal, redirect: 'error',
        });
        const payload = await response.json();
        if (!response.ok || payload.success === false || payload.error) throw cloudflareError(payload, response.status, apiKey);
        return payload;
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
    }
}

async function listCloudflareModels(config, options = {}) {
    const models = [];
    for (let page = 1; page <= 100; page++) {
        const payload = await cloudflareJson(config, `models/search?task=Text%20Generation&per_page=100&page=${page}`, options);
        if (!Array.isArray(payload.result)) throw new Error('Cloudflare returned an invalid model catalog.');
        for (const model of payload.result) {
            if (typeof model.name === 'string' && (!model.task?.name || model.task.name === 'Text Generation')) {
                models.push({label: model.name, value: model.name, provider: 'cloudflare'});
            }
        }
        if (payload.result_info?.total_pages ? page >= payload.result_info.total_pages : payload.result.length < 100) {
            return [...new Map(models.map(model => [model.value, model])).values()].sort((a, b) => a.label.localeCompare(b.label));
        }
    }
    throw new Error('Cloudflare model catalog pagination exceeded its limit.');
}

function schemaSupportsImageUrl(schema) {
    if (!schema || typeof schema !== 'object') return false;
    if (schema.properties?.image_url) return true;
    return Object.values(schema).some(value => typeof value === 'object' && schemaSupportsImageUrl(value));
}

async function inspectCloudflareModel(config, {requireVision = false, ...options} = {}) {
    const models = await listCloudflareModels(config, options);
    if (!models.some(model => model.value === config.model)) throw new Error('Selected Cloudflare text-generation model is unavailable. Refresh the model list in Settings.');
    if (requireVision) {
        const payload = await cloudflareJson(config, `models/schema?model=${encodeURIComponent(config.model)}`, options);
        // Inspect the input only; output image fields do not establish vision support.
        if (!schemaSupportsImageUrl(payload.result?.input)) {
            throw new Error('This Cloudflare model does not advertise image_url input support. Choose a vision model for screenshot requests.');
        }
    }
}

module.exports = {cloudflareAccountId, cloudflareConnection, cloudflareRunPath, cloudflareError, listCloudflareModels, inspectCloudflareModel};
