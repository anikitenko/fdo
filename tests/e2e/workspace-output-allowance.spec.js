const {test, expect, _electron: electron} = require('@playwright/test');
const {launchElectronApp, closeElectronApp} = require('./helpers/electronApp');

for (const provider of ['openrouter', 'cloudflare']) {
    test(`${provider} learns a validated CSS retry allowance within the request ceiling`, async () => {
        const app = await launchElectronApp(electron, {reviewedWorkspaceFixture: true, isolatedUserDataDir: true,
            env: {FDO_E2E_LIVE_AI: '1', FDO_TEST_AI_MAX_REQUESTS: '7'}});
        try {
            const page = await app.firstWindow();
            await expect.poll(() => page.evaluate(async () => {
                try { return Array.isArray(await window.electron.settings.ai.getAssistants()); } catch { return false; }
            })).toBe(true);
            await app.evaluate(() => {
                globalThis.__splitRepairRequests = [];
                globalThis.fetch = async (url, init = {}) => {
                    const address = String(url);
                    const cloudflare = `https://api.cloudflare.com/client/v4/accounts/${'a'.repeat(32)}/ai/`;
                    if (address === 'https://openrouter.ai/api/v1/auth/key') return Response.json({data: {}});
                    if (address === 'https://openrouter.ai/api/v1/models') return Response.json({data: [{id: 'split-model',
                        supported_parameters: ['structured_outputs', 'response_format'],
                        architecture: {input_modalities: ['text'], output_modalities: ['text']}}]});
                    if (address.startsWith(`${cloudflare}models/search?`)) return Response.json({success: true,
                        result: [{name: '@cf/qwen/qwen3.8-27b', task: {name: 'Text Generation'}}]});
                    if (!['https://openrouter.ai/api/v1/chat/completions', `${cloudflare}run/@cf/qwen/qwen3.8-27b`].includes(address)) {
                        throw new Error('Unexpected endpoint');
                    }
                    const body = JSON.parse(init.body);
                    globalThis.__splitRepairRequests.push(body);
                    const index = globalThis.__splitRepairRequests.length;
                    let finishReason = 'stop';
                    let content;
                    const plan = paths => JSON.stringify({files: paths.map(path => ({path, contract: 'Focused styles'}))});
                    if (index === 1) content = plan(['/styles.css']);
                    else if (index === 3) content = plan(['/a.css', '/b.css']);
                    else {
                        const schema = body.response_format?.json_schema?.schema || body.response_format?.json_schema;
                        const path = schema?.properties?.path?.enum?.[0]
                            || JSON.stringify(body.messages).match(/Generate ONLY (\/[^\s]+)\. Its contract:/)?.[1];
                        if (!path) throw new Error('File request did not identify its target');
                        if (index === 2 || path !== '/styles.css' && body.max_tokens < 3072) {
                            content = '';
                            finishReason = 'length';
                        } else {
                            const source = path === '/styles.css'
                                ? '@import "./a.css"; @import "./b.css";' : '.panel { color: teal; }';
                            content = schema ? JSON.stringify({path, lines: [source]}) : `\`\`\`css\n${source}\n\`\`\``;
                        }
                    }
                    const usage = {prompt_tokens: 100, completion_tokens: 30};
                    if (body.stream) return new Response([
                        {choices: [{delta: {content}}]},
                        {choices: [{delta: {}, finish_reason: finishReason}]},
                        {choices: [], usage},
                    ].map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n',
                    {headers: {'content-type': 'text/event-stream'}});
                    const result = {choices: [{message: {content}, finish_reason: finishReason}], usage};
                    return Response.json(address.startsWith(cloudflare) ? {success: true, result} : result);
                };
            });
            const result = await page.evaluate(async provider => {
                await window.electron.settings.ai.addAssistant({name: 'Adaptive output', provider, purpose: 'coding',
                    model: provider === 'openrouter' ? 'split-model' : '@cf/qwen/qwen3.8-27b',
                    ...(provider === 'cloudflare' ? {accountId: 'a'.repeat(32)} : {}),
                    apiKey: 'test-only-token', defaultThinkingMode: 'off'});
                const assistant = (await window.electron.settings.ai.getAssistants()).find(item => item.name === 'Adaptive output');
                return window.electron.aiCodingAgent.planCode(window.__withReviewedWorkspace({requestId: 'adaptive-output', assistantId: assistant.id,
                    prompt: 'Generate modular styles for a dashboard.', workspaceFiles: []}));
            }, provider);
            expect(result.success, result.error).toBe(true);
            expect(result.content.match(/### File:/g)).toHaveLength(3);
            const requests = await app.evaluate(() => globalThis.__splitRepairRequests);
            expect(requests).toHaveLength(7);
            expect(requests[3].max_tokens).toBe(1536);
            expect(requests[4].max_tokens).toBe(3072);
            expect(requests[5].max_tokens).toBe(3072);
            expect(requests[6].max_tokens).toBe(1536);
            expect(requests[5].messages.at(-1).content).toContain('must fit within 3072 output tokens');
            expect(await app.evaluate(() => globalThis.__FDO_E2E_LIVE_AI_BUDGET__.used)).toBe(7);
        } finally { await closeElectronApp(app); }
    });
}
