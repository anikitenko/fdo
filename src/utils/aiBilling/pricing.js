import {PRICING_CATALOG} from './catalog';
export const validCount = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const unknown = reason => ({status: 'unknown', currency: 'USD', reason});
const dollars = value => Math.round(value * 1e12) / 1e12;
export const rateKey = (provider, model) => JSON.stringify([provider, model]);

export function validateRate(rate) {
    if (!rate || typeof rate !== 'object' || !validCount(rate.input) || !validCount(rate.output)) throw new Error('Input and output rates must be non-negative numbers.');
    const result = {input: rate.input, output: rate.output};
    for (const field of ['cached', 'cacheWrite', 'cacheWriteHour', 'maxInputTokens']) {
        if (rate[field] == null || rate[field] === '') continue;
        if (!validCount(rate[field]) || (field === 'maxInputTokens' && !Number.isSafeInteger(rate[field]))) throw new Error(`Invalid ${field} rate or limit.`);
        result[field] = rate[field];
    }
    return result;
}

function calculate(usage, rate, {separateThoughts = false, cacheHour = false} = {}) {
    if (!validCount(usage?.input_tokens) || !validCount(usage?.output_tokens)) return unknown('Provider did not report complete token usage.');
    for (const key of ['cached_input_tokens', 'cache_write_tokens', 'cache_write_1h_tokens', 'reasoning_tokens']) {
        if (usage[key] != null && !validCount(usage[key])) return unknown('Provider reported invalid token usage.');
    }
    const cached = usage.cached_input_tokens || 0;
    const writes = usage.cache_write_tokens || 0;
    const hour = cacheHour ? (usage.cache_write_1h_tokens || 0) : 0;
    if (hour > writes || cached + writes > usage.input_tokens) return unknown('Provider usage categories do not reconcile.');
    const parts = [[usage.input_tokens - cached - writes, rate.input], [cached, rate.cached], [writes - hour, rate.cacheWrite], [hour, rate.cacheWriteHour]];
    if (parts.some(([count, price]) => count && !validCount(price))) return unknown('Pricing for a reported cache category is unavailable.');
    const outputTokens = usage.output_tokens + (separateThoughts ? (usage.reasoning_tokens || 0) : 0);
    const inputCost = dollars(parts.reduce((sum, [count, price]) => sum + count * (price || 0), 0) / 1e6);
    const outputCost = dollars(outputTokens * rate.output / 1e6);
    return {status: 'estimated', currency: 'USD', inputCost, outputCost, totalCost: dollars(inputCost + outputCost), billableOutputTokens: outputTokens};
}
// Provider rules are deliberately separate. OpenAI/Claude output already
// contains reasoning; Gemini Interactions reports thoughts separately.
export const providerBilling = {
    openai: (usage, rate) => calculate(usage, rate),
    anthropic: (usage, rate) => calculate(usage, rate, {cacheHour: true}),
    gemini: (usage, rate) => calculate(usage, rate, {separateThoughts: true}),
    cloudflare: (usage, rate) => calculate(usage, rate),
};
export function estimateCost({provider, model, usage, rate, at = new Date().toISOString(), serviceTier, completeUsage = true}) {
    if (provider === 'ollama') return {status: 'local', currency: 'USD', inputCost: 0, outputCost: 0, totalCost: 0, reason: 'Local inference; hardware and electricity excluded.'};
    if (provider.endsWith('-cli')) return {status: 'external', currency: 'USD', reason: 'CLI billing depends on its account or subscription; no API price inferred.'};
    if (!completeUsage) return unknown('Request ended before complete usage was reported.');
    if (serviceTier && !['default', 'standard', 'auto'].includes(serviceTier)) return unknown(`Pricing for service tier ${serviceTier} is not configured.`);
    const pricing = rate || PRICING_CATALOG[provider]?.[model];
    if (!pricing) return unknown('No verified rate for this exact provider and model.');
    if (pricing.validUntil && at.slice(0, 10) > pricing.validUntil) return unknown('The saved pricing needs to be refreshed.');
    if (pricing.maxInputTokens != null && usage?.input_tokens > pricing.maxInputTokens) return unknown('Input exceeds the verified pricing range; configure a matching rate.');
    if (!providerBilling[provider]) return unknown('This provider has no billing calculator.');
    const result = providerBilling[provider](usage, pricing);
    return {...result, pricing: {...pricing}, basis: 'Standard token estimate before credits, free allowances, tax and account discounts.'};
}
