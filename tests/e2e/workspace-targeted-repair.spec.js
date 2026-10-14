const {test, expect, _electron: electron} = require('@playwright/test');
const {launchElectronApp, closeElectronApp} = require('./helpers/electronApp');
const fixture = require('../fixtures/ai/workspace-targeted-repair.cjs');

for (const provider of ['openai', 'anthropic', 'cloudflare', 'ollama', 'gemini', 'opencode', 'openrouter']) {
    test(`${provider} repairs only a diagnostic owner with one request through native IPC`, async () => {
        const model = provider === 'cloudflare' ? '@cf/qwen/qwen3.8-27b' : 'test-model';
        // These adapters charge connection verification during assistant setup.
        // Leave exactly one request for the repair after that existing charge.
        const setupRequests = ['openai', 'anthropic', 'gemini'].includes(provider) ? 1 : 0;
        const app = await launchElectronApp(electron, {isolatedUserDataDir: true,
            env: {FDO_E2E_LIVE_AI: '1', FDO_TEST_AI_MAX_REQUESTS: String(setupRequests + 1)}});
        try {
            const page = await app.firstWindow();
            await expect.poll(() => page.evaluate(async () => {
                try { return Array.isArray(await window.electron.settings.ai.getAssistants()); } catch { return false; }
            })).toBe(true);
            await app.evaluate((_electron, {provider, model, content}) => {
                globalThis.__nativeProviderRequests = [];
                globalThis.fetch = async (url, init = {}) => {
                    const address = String(url);
                    globalThis.__nativeProviderRequests.push(address);
                    const json = data => Response.json(data);
                    const sse = events => new Response(events.map(event => `${(event.event_type || event.type) ? `event: ${event.event_type || event.type}\n` : ""}data: ${JSON.stringify(event)}\n\n`).join(''), {headers: {'content-type': 'text/event-stream'}});
                    if (address === 'https://api.openai.com/v1/models/test-model' || address === 'https://api.anthropic.com/v1/models/test-model') return json({id: 'test-model'});
                    if (address === 'https://opencode.ai/zen/v1/models') return json({data: [{id: 'test-model'}, {id: 'mimo-v2.6-flash-free'}]});
                    if (address === 'https://openrouter.ai/api/v1/auth/key') return json({data: {label: 'test-only-token', usage: 0, limit: null, is_free_tier: true}});
                    if (address === 'https://openrouter.ai/api/v1/models') return json({data: [
                        {id: 'test-model', pricing: {prompt: '0', completion: '0'}, architecture: {input_modalities: ['text', 'image'], output_modalities: ['text']}},
                        {id: 'deepseek/deepseek-chat-v3:free', pricing: {prompt: '0', completion: '0'}, architecture: {input_modalities: ['text'], output_modalities: ['text']}},
                        {id: 'some/paid-model', pricing: {prompt: '0.001', completion: '0.002'}},
                        {id: 'free/audio-model', pricing: {prompt: '0', completion: '0'}, architecture: {output_modalities: ['audio']}}]});
                    if (address.startsWith(`https://api.cloudflare.com/client/v4/accounts/${'a'.repeat(32)}/ai/models/search?`)) return json({success: true, result: [{name: model, task: {name: 'Text Generation'}}]});
                    if (address === 'https://generativelanguage.googleapis.com/v1beta/models/test-model') return json({name: 'models/test-model', supportedGenerationMethods: ['generateContent']});
                    if (address === 'http://127.0.0.1:11434/api/show') return json({capabilities: ['completion', 'vision']});
                    if (address === 'http://127.0.0.1:11434/api/tags') return json({models: [{name: 'test-model'}]});
                    const endpoints = {gemini: 'https://generativelanguage.googleapis.com/v1beta/interactions', openai: 'https://api.openai.com/v1/responses', anthropic: 'https://api.anthropic.com/v1/messages',
                        cloudflare: `https://api.cloudflare.com/client/v4/accounts/${'a'.repeat(32)}/ai/run/${model}`, ollama: 'http://127.0.0.1:11434/api/chat',
                        opencode: 'https://opencode.ai/zen/v1/chat/completions', openrouter: 'https://openrouter.ai/api/v1/chat/completions'};
                    if (address !== endpoints[provider]) throw new Error('Unexpected HTTP request in native provider regression');
                    const body = JSON.parse(init.body);
                    if (body.model && body.model !== model) throw new Error('Incorrect inference parameters');

                    const chatText = content;
                    if (!body.stream && provider === 'openai') return json({id: 'response-1', status: 'completed',
                        output: [{type: 'message', role: 'assistant', content: [{type: 'output_text', text: chatText}]}],
                        usage: {input_tokens: 1000, output_tokens: 100, total_tokens: 1100}});
                    if (!body.stream && provider === 'anthropic') return json({id: 'message-1', type: 'message', role: 'assistant',
                        content: [{type: 'text', text: chatText}], stop_reason: 'end_turn', usage: {input_tokens: 1000, output_tokens: 100}});
                    if (!body.stream && provider === 'gemini') return json({id: 'interaction-1', status: 'completed',
                        steps: [{type: 'model_output', content: [{type: 'text', text: chatText}]}],
                        usage: {total_input_tokens: 1000, total_output_tokens: 100, total_thought_tokens: 50, total_tokens: 1150}});
                    if (!body.stream && provider === 'cloudflare') return json({success: true, result: {response: content, finish_reason: 'stop', usage: {prompt_tokens: 1000, completion_tokens: 100}}});
                    if (!body.stream && provider === 'ollama') return json({message: {role: 'assistant', content}, done: true, done_reason: 'stop', prompt_eval_count: 1000, eval_count: 100});
                    if (!body.stream) return json({choices: [{message: {role: 'assistant', content}, finish_reason: 'stop'}], usage: {prompt_tokens: 1000, completion_tokens: 100}});
                    if (provider === 'openai') return sse([{type: 'response.output_text.delta', delta: content}, {type: 'response.completed', response: {status: 'completed', usage: {input_tokens: 1000, output_tokens: 100}}}]);
                    if (provider === 'anthropic') return sse([{type: 'message_start', message: {usage: {input_tokens: 1000}}}, {type: 'content_block_delta', index: 0, delta: {type: 'text_delta', text: content}}, {type: 'message_delta', delta: {stop_reason: 'end_turn'}, usage: {output_tokens: 100}}, {type: 'message_stop'}]);
                    if (provider === 'gemini') return sse([{event_type: 'step.start', index: 0, step: {type: 'model_output', content: []}},
                        {event_type: 'step.delta', index: 0, delta: {type: 'text', text: content}}, {event_type: 'step.stop', index: 0},
                        {event_type: 'interaction.completed', interaction: {id: 'i1', status: 'completed', usage: {total_input_tokens: 1000, total_output_tokens: 100, total_thought_tokens: 50}}}]);
                    if (provider === 'cloudflare') {
                        if (body.chat_template_kwargs?.enable_thinking !== false) throw new Error('Saved thinking preference was not forwarded');
                        return sse([{result: {response: content}}, {result: {finish_reason: 'stop', usage: {prompt_tokens: 1000, completion_tokens: 100}}}]);
                    }
                    if (provider === 'opencode' || provider === 'openrouter') {
                        // OpenAI-compatible Chat Completions: content delta,
                        // finish reason, then the usage chunk requested via
                        // stream_options.
                        if (!body.stream_options?.include_usage) throw new Error(`Expected stream usage reporting for ${provider}`);
                        return new Response(
                            [{choices: [{index: 0, delta: {role: 'assistant', content}}]},
                                {choices: [{index: 0, delta: {}, finish_reason: 'stop'}]},
                                {choices: [], usage: {prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100}}]
                                .map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n',
                            {headers: {'content-type': 'text/event-stream'}});
                    }
                    return new Response(JSON.stringify({message: {role: 'assistant', content}, done: true, done_reason: 'stop', prompt_eval_count: 1000, eval_count: 100}) + '\n', {headers: {'content-type': 'application/x-ndjson'}});
                };
            }, {provider, model, content: fixture.replies[0].content});
            const result = await page.evaluate(async ({provider, model, fixture}) => {
                await window.electron.settings.ai.addAssistant({name: 'Targeted repair', provider, purpose: 'coding', model,
                    defaultThinkingMode: 'off', apiKey: provider === 'ollama' ? '' : 'test-only-token',
                    ...(provider === 'cloudflare' ? {accountId: 'a'.repeat(32)} : {}),
                    ...(provider === 'ollama' ? {baseUrl: 'http://127.0.0.1:11434', contextLength: 32768} : {})});
                const assistant = (await window.electron.settings.ai.getAssistants()).find(item => item.name === 'Targeted repair');
                return window.electron.aiCodingAgent.planCode({requestId: 'targeted-repair', assistantId: assistant.id,
                    prompt: fixture.prompt, workspaceFiles: fixture.workspaceFiles, repairPaths: ['/index.ts']});
            }, {provider, model, fixture});
            const validation = await app.evaluate(() => (globalThis.__FDO_E2E_CODING_LIFECYCLE__ || [])
                .filter(event => event.event === 'workspace-file-validation'));
            expect(result.success, `${result.error || ''} ${JSON.stringify(validation)}`).toBe(true);
            expect([...result.content.matchAll(/^### File: (.+)$/gm)].map(match => match[1])).toEqual(['/index.ts']);
            expect(result.content).toContain(fixture.corrected.trim());
            expect(await app.evaluate(() => globalThis.__FDO_E2E_LIVE_AI_BUDGET__.used)).toBe(setupRequests + 1);
        } finally { await closeElectronApp(app); }
    });
}
