const {test, expect, _electron: electron} = require('@playwright/test');
const {launchElectronApp, closeElectronApp} = require('./helpers/electronApp');
const {readLiveAiConfig} = require('../../scripts/lib/live-ai-config.cjs');

for (const provider of ['openai', 'anthropic', 'cloudflare', 'ollama', 'gemini']) {
    test(`${provider} native client completes coding through the built app and real IPC`, async ({}, testInfo) => {
        const model = provider === 'cloudflare' ? '@cf/qwen/qwen3.8-27b' : 'test-model';
        const defaultThinkingMode = provider === 'cloudflare' ? readLiveAiConfig({FDO_TEST_AI_PROVIDER: provider,
            FDO_TEST_AI_MODEL: model, FDO_TEST_AI_API_KEY: 'test-only-token', FDO_TEST_AI_ACCOUNT_ID: 'a'.repeat(32)}).defaultThinkingMode : 'off';
        const app = await launchElectronApp(electron, {isolatedUserDataDir: true, env: {FDO_E2E_LIVE_AI: '0'}});
        try {
            const page = await app.firstWindow();
            await expect.poll(() => page.evaluate(async () => {
                try { return Array.isArray(await window.electron.settings.ai.getAssistants()); } catch { return false; }
            })).toBe(true);
            // Replace only HTTP. Settings, SDKs, stream decoding, request policy
            // and renderer IPC all run from the actual production bundle.
            await app.evaluate((_electron, {provider, model}) => {
                globalThis.__nativeProviderRequests = [];
                globalThis.fetch = async (url, init = {}) => {
                    const address = String(url);
                    globalThis.__nativeProviderRequests.push(address);
                    const json = data => Response.json(data);
                    const sse = events => new Response(events.map(event => `${(event.event_type || event.type) ? `event: ${event.event_type || event.type}\n` : ""}data: ${JSON.stringify(event)}\n\n`).join(''), {headers: {'content-type': 'text/event-stream'}});
                    if (address === 'https://api.openai.com/v1/models/test-model' || address === 'https://api.anthropic.com/v1/models/test-model') return json({id: 'test-model'});
                    if (address.startsWith(`https://api.cloudflare.com/client/v4/accounts/${'a'.repeat(32)}/ai/models/search?`)) return json({success: true, result: [{name: model, task: {name: 'Text Generation'}}]});
                    if (address === 'https://generativelanguage.googleapis.com/v1beta/models/test-model') return json({name: 'models/test-model', supportedGenerationMethods: ['generateContent']});
                    if (address === 'http://127.0.0.1:11434/api/show') return json({capabilities: ['completion', 'vision']});
                    if (address === 'http://127.0.0.1:11434/api/tags') return json({models: [{name: 'test-model'}]});
                    const endpoints = {gemini: 'https://generativelanguage.googleapis.com/v1beta/interactions', openai: 'https://api.openai.com/v1/responses', anthropic: 'https://api.anthropic.com/v1/messages',
                        cloudflare: `https://api.cloudflare.com/client/v4/accounts/${'a'.repeat(32)}/ai/run/${model}`, ollama: 'http://127.0.0.1:11434/api/chat'};
                    if (address !== endpoints[provider]) throw new Error('Unexpected HTTP request in native provider regression');
                    const body = JSON.parse(init.body);
                    if (body.model && body.model !== model) throw new Error('Incorrect inference parameters');
                    const content = 'export const answer = 42;';
                    const chatText = 'A red-black tree maintains balance with rotations and color rules.';
                    if (!body.stream && provider === 'openai') return json({id: 'response-1', status: 'completed',
                        output: [{type: 'message', role: 'assistant', content: [{type: 'output_text', text: chatText}]}],
                        usage: {input_tokens: 1000, output_tokens: 100, total_tokens: 1100}});
                    if (!body.stream && provider === 'anthropic') return json({id: 'message-1', type: 'message', role: 'assistant',
                        content: [{type: 'text', text: chatText}], stop_reason: 'end_turn', usage: {input_tokens: 1000, output_tokens: 100}});
                    if (!body.stream && provider === 'gemini') return json({id: 'interaction-1', status: 'completed',
                        steps: [{type: 'model_output', content: [{type: 'text', text: chatText}]}],
                        usage: {total_input_tokens: 1000, total_output_tokens: 100, total_thought_tokens: 50, total_tokens: 1150}});
                    if (!body.stream) throw new Error('Expected a streamed coding request');
                    if (provider === 'openai') return sse([{type: 'response.output_text.delta', delta: content}, {type: 'response.completed', response: {status: 'completed', usage: {input_tokens: 1000, output_tokens: 100}}}]);
                    if (provider === 'anthropic') return sse([{type: 'message_start', message: {usage: {input_tokens: 1000}}}, {type: 'content_block_delta', index: 0, delta: {type: 'text_delta', text: content}}, {type: 'message_delta', delta: {stop_reason: 'end_turn'}, usage: {output_tokens: 100}}, {type: 'message_stop'}]);
                    if (provider === 'gemini') return sse([{event_type: 'step.start', index: 0, step: {type: 'model_output', content: []}},
                        {event_type: 'step.delta', index: 0, delta: {type: 'text', text: content}}, {event_type: 'step.stop', index: 0},
                        {event_type: 'interaction.completed', interaction: {id: 'i1', status: 'completed', usage: {total_input_tokens: 1000, total_output_tokens: 100, total_thought_tokens: 50}}}]);
                    if (provider === 'cloudflare') {
                        if (body.chat_template_kwargs?.enable_thinking !== false) throw new Error('Saved thinking preference was not forwarded');
                        return sse([{result: {response: content}}, {result: {finish_reason: 'stop', usage: {prompt_tokens: 1000, completion_tokens: 100}}}]);
                    }
                    return new Response(JSON.stringify({message: {role: 'assistant', content}, done: true, done_reason: 'stop', prompt_eval_count: 1000, eval_count: 100}) + '\n', {headers: {'content-type': 'application/x-ndjson'}});
                };
            }, {provider, model});
            const result = await page.evaluate(async ({provider, model, defaultThinkingMode}) => {
                if (provider !== 'ollama') await window.electron.aiUsage.saveRate({provider, model, rate: {input: 2, output: 10}});
                await window.electron.settings.ai.addAssistant({name: `Native ${provider}`, provider, purpose: 'coding', model, defaultThinkingMode,
                    apiKey: provider === 'ollama' ? '' : 'test-only-token', ...(provider === 'cloudflare' ? {accountId: 'a'.repeat(32)} : {}),
                    ...(provider === 'ollama' ? {baseUrl: 'http://127.0.0.1:11434', contextLength: 8192} : {})});
                const assistant = (await window.electron.settings.ai.getAssistants()).find(item => item.name === `Native ${provider}`);
                const deltas = [], done = [], errors = [];
                let resolveDone;
                const completionObserved = new Promise(resolve => { resolveDone = resolve; });
                window.electron.aiCodingAgent.on.streamDelta(event => { if (event.requestId === 'native-test' && event.type === 'content') deltas.push(event.content); });
                window.electron.aiCodingAgent.on.streamDone(event => {
                    if (event.requestId === 'native-test') { done.push(event); resolveDone(); }
                });
                window.electron.aiCodingAgent.on.streamError(event => errors.push(event));
                const response = await window.electron.aiCodingAgent.generateCode({assistantId: assistant.id, requestId: 'native-test', prompt: 'Export answer equal to 42.', language: 'typescript'});
                // invoke() and the completion event use separate IPC deliveries.
                // Observe both rather than assuming the event arrives first.
                if (response.success) {
                    let timer;
                    try { await Promise.race([completionObserved, new Promise((_, reject) => {
                        timer = setTimeout(() => reject(new Error('Missing coding completion event')), 5000);
                    })]); } finally { clearTimeout(timer); }
                }
                return {response, deltas, done, errors};
            }, {provider, model, defaultThinkingMode});
            const usage = await page.evaluate(() => window.electron.aiUsage.get({surface: 'coding'}));
            expect(usage.entries).toHaveLength(1);
            expect(usage.entries[0]).toMatchObject({provider, model, requestId: 'native-test', status: 'completed',
                usage: {input_tokens: 1000, output_tokens: 100}, cost: {status: provider === 'ollama' ? 'local' : 'estimated'}});
            expect(usage.groups[0].knownCost).toBe(provider === 'ollama' ? 0 : provider === 'gemini' ? .0035 : .003);
            expect(usage.persistenceError).toBe(false);
            expect(JSON.stringify(usage)).not.toContain('test-only-token');
            expect(result.errors).toEqual([]);
            expect(result.response).toMatchObject({success: true, content: 'export const answer = 42;'});
            expect(result.deltas.join('')).toBe('export const answer = 42;');
            expect(result.done).toEqual([expect.objectContaining({requestId: 'native-test'})]);
            expect(await app.evaluate(() => globalThis.__nativeProviderRequests.filter(url => /\/(responses|messages|chat|interactions)$|\/ai\/run\//.test(url)).length)).toBe(1);
            if (['openai', 'anthropic', 'gemini'].includes(provider)) {
                const chat = await page.evaluate(async provider => {
                    await window.electron.settings.ai.addAssistant({name: 'Chat billing regression', provider, purpose: 'chat', model: 'test-model', apiKey: 'test-only-token'});
                    const assistant = (await window.electron.settings.ai.getAssistants()).find(item => item.name === 'Chat billing regression');
                    const session = await window.electron.aiChat.createSession('Billing regression');
                    const result = await window.electron.aiChat.sendMessage({sessionId: session.id, assistantId: assistant.id,
                        content: 'Explain how a red-black tree maintains balance.', stream: false, think: false});
                    return {result, usage: await window.electron.aiUsage.get({surface: 'chat', sessionId: session.id})};
                }, provider);
                expect(chat.usage.requests).toBeGreaterThan(0);
                expect(chat.usage.persistenceError).toBe(false);
                expect(chat.usage.groups[0].unknown).toBe(0);
                const message = chat.result.messages.at(-1);
                expect(message.content).not.toMatch(/^Error:/);
                expect(message).toMatchObject({usageScope: 'turn', usageRequests: chat.usage.requests, costStatus: 'estimated',
                    inputTokens: chat.usage.requests * 1000, outputTokens: chat.usage.requests * 100});
                expect(message.totalCost).toBeCloseTo(chat.usage.groups[0].knownCost, 10);
                expect((await page.evaluate(() => window.electron.aiUsage.get({surface: 'coding'}))).requests).toBe(1);
                await page.evaluate(() => localStorage.setItem('showRightSideBar', 'true'));
                await page.reload();
                await page.locator('[data-plugin-sidebar-item="system-ai-chat"] button').click();
                await page.getByRole('button', {name: 'Usage and cost', exact: true}).click();
                const popover = page.getByRole('region', {name: 'AI usage and cost'});
                await expect(popover).toBeVisible();
                await expect(popover).toContainText('This chat');
                await expect(popover).toContainText(`Estimated total: $${message.totalCost.toFixed(5)}`);
                await expect(popover).toContainText(provider);
                expect(await popover.evaluate(element => {
                    const content = element.closest('.bp6-popover-content');
                    return element.getBoundingClientRect().width <= content.getBoundingClientRect().width + 1;
                })).toBe(true);
                const screenshotPath = testInfo.outputPath(`${provider}-chat-usage.png`);
                await popover.screenshot({path: screenshotPath});
                await testInfo.attach(`${provider}-chat-usage.png`, {path: screenshotPath, contentType: 'image/png'});
                await page.locator('.bp6-dialog-header').click({position: {x: 10, y: 10}});
                await expect(popover).not.toBeVisible();
            }
        } finally { await closeElectronApp(app); }
    });
}
