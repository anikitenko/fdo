// Standard direct-API USD rates per million tokens, verified 2026-09-20.
// Exact IDs only: never assign a future model the price of a similar name.
export const PRICING_SOURCES = {
    openai: 'https://developers.openai.com/api/docs/pricing',
    anthropic: 'https://platform.claude.com/docs/en/about-claude/pricing',
    gemini: 'https://ai.google.dev/gemini-api/docs/pricing',
    cloudflare: 'https://developers.cloudflare.com/workers-ai/platform/pricing/',
};
const card = (provider, input, output, cached, extra = {}) => ({input, output, ...(cached != null ? {cached} : {}),
    source: PRICING_SOURCES[provider], verifiedAt: '2026-09-20', validUntil: '2026-12-19', ...extra});
// maxInputTokens is the verified coverage of this catalog, not a model limit.
const openai = (input, output, cached, extra) => card('openai', input, output, cached, {maxInputTokens: 128000, ...extra});
const claude = (input, output, cached = input * 0.1) => card('anthropic', input, output, cached,
    {cacheWrite: input * 1.25, cacheWriteHour: input * 2, maxInputTokens: 200000});
export const PRICING_CATALOG = {
    openai: {
        'gpt-6-astra': openai(10, 50, 1, {cacheWrite: 12.5}),
        'gpt-5.6-sol': openai(4, 20, .4, {cacheWrite: 5, validUntil: '2026-11-21'}),
        'gpt-5.6-terra': openai(2, 12, .2, {cacheWrite: 2.5}),
        'gpt-5.6-luna': openai(.2, 1.2, .02, {cacheWrite: .25}),
        'gpt-5.4': openai(2.5, 15, .25, {source: 'https://developers.openai.com/api/docs/models/gpt-5.4'}),
    },
    anthropic: {
        'claude-opus-5': claude(5, 25), 'claude-opus-4-8': claude(5, 25),
        'claude-opus-4-7': claude(5, 25), 'claude-opus-4-6': claude(5, 25),
        'claude-opus-4-5-20251101': claude(5, 25),
        'claude-sonnet-5': claude(2, 10), 'claude-sonnet-4-6': claude(3, 15),
        'claude-sonnet-4-5-20250929': claude(3, 15), 'claude-haiku-4-5-20251001': claude(1, 5),
        'claude-fable-5-1': claude(10, 50, .25), 'claude-mythos-5-1': claude(10, 50, .25),
    },
    gemini: {
        'gemini-3.8-flash': card('gemini', .75, 3.75, .075),
        'gemini-3.7-flash': card('gemini', .75, 3.75, .075),
        'gemini-3.1-flash-lite': card('gemini', .25, 1.5, .025),
    },
    cloudflare: {
        '@cf/qwen/qwen3.8-27b': card('cloudflare', .45, 3.2),
        '@cf/qwen/qwen3-30b-a3b-fp8': card('cloudflare', .051, .335),
        '@cf/qwen/qwen2.5-coder-32b-instruct': card('cloudflare', .66, 1),
        '@cf/meta/llama-4-scout-17b-16e-instruct': card('cloudflare', .27, .85),
        '@cf/openai/gpt-oss-120b': card('cloudflare', .35, .75),
        '@cf/openai/gpt-oss-20b': card('cloudflare', .2, .3),
        '@cf/zai-org/glm-5.3': card('cloudflare', 1.4, 4.4, .26),
    },
};
