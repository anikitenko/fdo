import {cloudflareConnection} from './cloudflareProvider.cjs';
import {codingFirstResponseTimeoutMs} from './codingRequestPolicy.cjs';
import {conversation} from './aiProviders/messages';
import {openaiRequest, createOpenAIClient} from './aiProviders/openai';
import {anthropicRequest, createAnthropicClient} from './aiProviders/anthropic';
import {cloudflareRequest} from './aiProviders/cloudflare';
import {geminiRequest} from './aiProviders/gemini';
import {inspectGeminiModel} from './geminiProvider.cjs';
import {ollamaRequest} from './aiProviders/ollama';
import {usageLedger} from './aiBilling/ledger';

const providers = {openai: openaiRequest, anthropic: anthropicRequest, cloudflare: cloudflareRequest, gemini: geminiRequest, ollama: ollamaRequest};

// This is an application boundary, not a model framework. Each adapter uses
// its provider's official client. FDO retains tool authorization and retries.
export default class AiProviderClient {
    constructor(options = {}) {
        this.options = options;
        this.service = options.service;
        this.model = options.model;
        this.apiKey = String(options.apiKey || '').trim();
        if (!providers[this.service]) throw new Error(`Unsupported AI provider: ${this.service}`);
        if (['openai', 'anthropic', 'gemini'].includes(this.service) && !this.apiKey) throw new Error(`An API key is required for ${this.service}.`);
        if (this.service === 'cloudflare') cloudflareConnection(options);
        this.messages = [];
        this.controller = new AbortController();
        this.transport = {requestStarted: false, headersReceived: false, events: 0, answerCharacters: 0, reasoningCharacters: 0};
    }
    system(content) { this.addMessage('system', content); }
    user(content) { this.addMessage('user', content); }
    assistant(content) { this.addMessage('assistant', content); }
    addMessage(role, content, native) { this.messages.push({role, content, ...(native ? {native} : {})}); }
    abort() { this.controller.abort(); }
    describeTransport() {
        const name = {openai: 'OpenAI', anthropic: 'Anthropic', cloudflare: 'Cloudflare', gemini: 'Gemini', ollama: 'Ollama'}[this.service];
        if (!this.transport.requestStarted) return `Preparing the ${name} request.`;
        // Fetch resolves when response headers arrive, not when the connection
        // is established. Buffered generation may wait here for the whole file.
        if (this.transport.responseMode === 'buffered') {
            return `Waiting for the complete response from ${name}. This request returns its answer all at once.`;
        }
        return this.transport.headersReceived
            ? `Receiving the response from ${name}; ${this.transport.events} response events received.`
            : `Waiting for a response from ${name}.`;
    }
    clientConfig() {
        return {apiKey: this.apiKey, maxRetries: 0, timeout: 30 * 60 * 1000, fetch: async (url, init = {}) => {
            const headers = new Headers(init.headers);
            // Ollama's library can inherit OLLAMA_API_KEY. Local requests must
            // never send any inherited cloud credentials to a configured host.
            if (this.service === 'ollama') headers.delete('authorization');
            const signal = init.signal ? AbortSignal.any([init.signal, this.controller.signal]) : this.controller.signal;
            this.transport.requestStarted = true;
            const response = await (this.options.fetchImpl || globalThis.fetch)(url, {...init, headers, signal, redirect: 'error'});
            this.transport.headersReceived = true;
            this.transport.status = response.status;
            return response;
        }};
    }
    async chat(prompt, request = {}) {
        if (this.controller.signal.aborted) throw new DOMException('AI request was cancelled.', 'AbortError');
        const options = {...this.options, ...request, options: {...this.options.options, ...request.options}};
        this.transport = {requestStarted: false, headersReceived: false, events: 0, answerCharacters: 0,
            reasoningCharacters: 0, responseMode: options.stream ? 'streaming' : 'buffered'};
        const attachments = [...(request.attachments || [])];
        if (request.image) attachments.push(Attachment.fromDataUrl(request.image));
        const events = providers[this.service](this.clientConfig(), conversation(this.messages, prompt, attachments), options, this.controller.signal);
        let complete, finished = false;
        const self = this;
        const stream = (async function* () {
            const entry = usageLedger.begin(self.service, options.model);
            let observedUsage, reportedUsage = false, outcome = 'interrupted', serviceTier;
            try {
                for await (const event of events) {
                    if (event.type === 'response-mode') {
                        self.transport.responseMode = event.mode;
                        continue;
                    }
                    self.transport.events++;
                    if (event.type === 'usage') { observedUsage = event.usage; reportedUsage = !!event.complete; serviceTier = event.serviceTier; }
                    if (event.type === 'result') {
                        const result = event.result;
                        observedUsage = result.usage;
                        reportedUsage = true;
                        serviceTier = result.serviceTier ?? serviceTier;
                        if (['tool_calls', 'tool_use'].includes(event.reason) && !result.tool_calls.length) throw new Error('Assistant stream ended without successful completion: missing tool calls.');
                        if (!result.content?.trim() && !result.tool_calls?.length) throw new Error('The provider completed without answer text or tool calls.');
                        // Tool calls are proposals only. Reject undeclared tools;
                        // the app's existing policy owns their execution.
                        if (result.tool_calls.some(call => !(options.tools || []).some(tool => tool.name === call.name))) throw new Error('Provider returned an undeclared tool call.');
                        complete = result;
                    } else if (event.type === 'content' || event.type === 'thinking') {
                        self.transport[event.type === 'content' ? 'answerCharacters' : 'reasoningCharacters'] += event.content.length;
                        yield event;
                    }
                }
                if (self.controller.signal.aborted) throw new DOMException('AI request was cancelled.', 'AbortError');
                if (!complete) throw new Error('The AI response has not completed successfully.');
                finished = true;
                outcome = 'completed';
            } catch (error) {
                if (error.usage) { observedUsage = error.usage; reportedUsage = true; }
                outcome = self.controller.signal.aborted ? 'cancelled' : 'failed';
                throw self.normalizeError(error);
            } finally {
                const record = entry.finish(outcome, observedUsage, {completeUsage: reportedUsage, serviceTier});
                if (complete && ['estimated', 'local'].includes(record.cost.status)) {
                    complete.usage = {...complete.usage, input_cost: record.cost.inputCost, output_cost: record.cost.outputCost,
                        total_cost: record.cost.totalCost, local: record.cost.status === 'local'};
                }
                if (!finished) self.abort();
            }
        })();
        const response = {stream, complete: async () => {
            if (!finished) throw new Error('The AI response has not completed successfully.');
            return complete;
        }};
        if (options.stream) return response;
        const timer = setTimeout(() => this.abort(), codingFirstResponseTimeoutMs({provider: this.service, firstResponseTimeoutMs: options.firstResponseTimeoutMs}));
        try {
            for await (const _event of stream) { /* Non-streaming providers return the same completion boundary. */ }
            return options.extended ? complete : complete.content;
        } finally { clearTimeout(timer); }
    }
    normalizeError(error) {
        const safe = new Error(String(error?.message || error).split(this.apiKey || '[unused-secret]').join('[REDACTED]'));
        safe.name = this.controller.signal.aborted ? 'AbortError'
            : error?.constructor?.name === 'APIUserAbortError' ? 'APIUserAbortError' : error?.name || 'Error';
        safe.status = error?.status ?? error?.statusCode ?? error?.status_code;
        safe.code = error?.code ?? error?.error?.code ?? error?.error?.type;
        // Preserve control metadata while discarding raw provider bodies and
        // headers, which can contain credentials. Cloudflare distinguishes an
        // abort from a timeout using errors[].code under the same HTTP 408.
        const details = Array.isArray(error?.errors) ? error.errors : error?.error?.errors;
        if (Array.isArray(details)) safe.errors = details.slice(0, 20)
            .filter(item => typeof item?.code === 'number' || typeof item?.code === 'string')
            .map(item => ({code: String(item.code).split(this.apiKey || '[unused-secret]').join('[REDACTED]')}));
        if (error?.retryable === false || error?.headers?.get?.('x-should-retry') === 'false') safe.retryable = false;
        return safe;
    }
    async verifyConnection() {
        if (this.service === 'gemini') {
            await inspectGeminiModel(this.options, {fetchImpl: this.options.fetchImpl, signal: this.controller.signal});
            return true;
        }
        const create = {openai: createOpenAIClient, anthropic: createAnthropicClient}[this.service];
        if (!create) throw new Error('Use provider-specific model discovery to verify this connection.');
        const timer = setTimeout(() => this.abort(), 15000);
        try {
            const client = await create(this.clientConfig());
            const model = this.service === 'anthropic'
                ? await client.models.retrieve(this.model, {}, {signal: this.controller.signal})
                : await client.models.retrieve(this.model, {signal: this.controller.signal});
            return typeof model.id === 'string' && model.id.length > 0;
        } catch (error) { throw this.normalizeError(error); } finally { clearTimeout(timer); }
    }
}

class Attachment {
    constructor(data) { Object.assign(this, data); }
    static fromBase64(data, type, mediaType) { return new Attachment({data, mediaType}); }
    static fromDataUrl(value) {
        const match = /^data:(image\/[\w.+-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(value);
        if (!match) throw new Error('Expected a base64 image attachment.');
        return Attachment.fromBase64(match[2], 'image', match[1]);
    }
    static fromImageURL(url) { return new Attachment({url: new URL(url).href, mediaType: 'image/*'}); }
    static fromDocumentURL(url) { return new Attachment({url: new URL(url).href, mediaType: 'application/pdf'}); }
}
for (const [name, mediaType] of Object.entries({PNG: 'image/png', JPEG: 'image/jpeg', GIF: 'image/gif', SVG: 'image/svg+xml', TIFF: 'image/tiff', WEBP: 'image/webp', PDF: 'application/pdf'})) {
    Attachment[`from${name}`] = data => Attachment.fromBase64(data, name === 'PDF' ? 'document' : 'image', mediaType);
}
AiProviderClient.Attachment = Attachment;
