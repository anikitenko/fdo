import {openaiRequest} from './openai';
import {OPENROUTER_BASE_URL} from './openRouterProvider.cjs';
import {outputLimit} from './messages';

export function openRouterReasoning(options) {
    if (options.think === false) return {enabled: false};
    if (options.think !== true) return undefined;
    // The gateway accepts either a token budget or effort, never both.
    // An explicit token budget takes precedence; leave room for answer text.
    if (options.reasoningMaxTokens != null) {
        const budget = options.reasoningMaxTokens;
        if (!Number.isInteger(budget) || budget <= 0 || budget >= outputLimit(options)) {
            throw new Error('OpenRouter reasoningMaxTokens must be a positive integer smaller than the output token limit.');
        }
        return {enabled: true, max_tokens: budget};
    }
    return {enabled: true, ...(options.reasoningEffort ? {effort: options.reasoningEffort} : {})};
}

// This adapter uses OpenRouter's Chat Completions route with the official
// OpenAI client. Keep the route explicit rather than inferring it from a
// gateway model name.
export async function* openrouterRequest(config, conversation, options, signal) {
    const structured = !!options.responseSchema && options.modelMetadata?.supportedParameters?.includes('structured_outputs');
    let reasoning = openRouterReasoning(options);
    let nativeSchemaFallback = false;
    let jsonObjectFallback = false;
    const attempt = (nativeSchema, input) => openaiRequest(
        {...config, baseURL: OPENROUTER_BASE_URL},
        !nativeSchema && options.responseSchema ? {...input, system: `${input.system || ''}
Return only JSON matching this response schema:
${JSON.stringify(options.responseSchema)}`} : input,
        // Use native schemas when the catalog advertises support. Require
        // matching upstream parameters so a gateway fallback cannot silently
        // discard the schema. Unknown/unsupported models retain local checks.
        // Optional reasoning defaults to on for several free models and is
        // counted against max_tokens, so an unanswered reasoning stream can
        // exhaust the budget before any answer text arrives. The assistant's
        // saved thinking preference is forwarded explicitly; 'auto' sends
        // nothing and keeps the model default. Gateway reasoning controls
        // depend on upstream support; do not promise a hard token cap.
        {...options, api: 'chat.completions', responseSchema: nativeSchema ? options.responseSchema : undefined,
            chatProvider: nativeSchema ? {require_parameters: true} : undefined,
            chatJsonObject: jsonObjectFallback,
            chatReasoning: reasoning},
        signal,
    );
    let observed = false;
    try {
        for await (const event of attempt(structured, conversation)) {
            observed = true;
            yield event;
        }
        return;
    } catch (error) {
        // Only retry a recognized parameter rejection before any output or usage. Never
        // replay partial generations, auth failures or account-policy errors.
        if (signal?.aborted || observed || error.retryable === false) throw error;
        // SSE errors arrive under HTTP 200; the OpenAI client keeps the
        // upstream status in error.code inside its error payload. Client-level
        // normalization happens only after this adapter has returned.
        const embeddedCode = error.error?.code;
        const status = error.status ?? ((typeof embeddedCode === 'number' || /^\d{3}$/.test(embeddedCode || '')) ? Number(embeddedCode) : undefined);
        const routing = Number(status) === 404
            && /No endpoints found that can handle the requested parameters/i.test(error.message || '');
        const mandatoryReasoning = Number(status) === 400 && reasoning?.enabled === false
            && /^(?:400\s+)?Reasoning is mandatory for this endpoint and cannot be disabled\.?$/i.test(String(error.message || '').trim());
        // Some routed endpoints advertise structured output but explicitly
        // reject JSON Schema while supporting plain JSON. Downgrade only on
        // that capability error, never on malformed schemas or generic 400s.
        const schemaUnsupported = Number(status) === 400 && structured
            && /does not support ['"]json_schema['"] response format\./i.test(error.message || '')
            && /Supported formats:\s*json_object\.?\s*$/i.test(error.message || '');
        if (!routing && !mandatoryReasoning && !schemaUnsupported) throw error;
        nativeSchemaFallback = (routing || schemaUnsupported) && structured;
        jsonObjectFallback = schemaUnsupported;
        await options.onProviderRetry?.({reason: mandatoryReasoning ? 'mandatory-reasoning' : schemaUnsupported ? 'unsupported-json-schema' : 'routing-parameters', nativeSchemaFallback});
        // Endpoint requirement overrides Off only for this attempt. Omitting
        // reasoning delegates to the endpoint default without inventing effort
        // support or changing the assistant's saved preference.
        if (mandatoryReasoning) reasoning = undefined;
        if (signal?.aborted) throw new DOMException('AI request was cancelled.', 'AbortError');
    }
    // Catalog support is not a guarantee that an eligible endpoint is currently
    // available. Retain the schema as instructions; downstream validators remain
    // authoritative. Images, tools, model and token limit are unchanged.
    // Only an explicit mandatory-reasoning rejection relaxes the Off override.
    yield* attempt(nativeSchemaFallback ? false : structured, conversation);
}
