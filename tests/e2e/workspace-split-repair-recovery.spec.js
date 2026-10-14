const {test, expect, _electron: electron} = require('@playwright/test');
const {launchElectronApp, closeElectronApp} = require('./helpers/electronApp');
const {replies, repaired} = require('../fixtures/ai/workspace-repair-after-split.cjs');

for (const provider of ['openrouter', 'cloudflare']) {
    test(`${provider} repairs a parent export mismatch after its helpers complete`, async () => {
        const app = await launchElectronApp(electron, {isolatedUserDataDir: true,
            env: {FDO_E2E_LIVE_AI: '1', FDO_TEST_AI_MAX_REQUESTS: '8'}});
        try {
            const page = await app.firstWindow();
            await expect.poll(() => page.evaluate(async () => {
                try { return Array.isArray(await window.electron.settings.ai.getAssistants()); } catch { return false; }
            })).toBe(true);
            await app.evaluate((_, replies) => {
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
                    const reply = replies[globalThis.__splitRepairRequests.length - 1];
                    if (!reply) throw new Error('Unexpected extra request');
                    const {content, finishReason = 'stop'} = reply;
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
            }, replies);
            const result = await page.evaluate(async provider => {
                await window.electron.settings.ai.addAssistant({name: 'Split recovery', provider, purpose: 'coding',
                    model: provider === 'openrouter' ? 'split-model' : '@cf/qwen/qwen3.8-27b',
                    ...(provider === 'cloudflare' ? {accountId: 'a'.repeat(32)} : {}),
                    apiKey: 'test-only-token', defaultThinkingMode: 'off'});
                const assistant = (await window.electron.settings.ai.getAssistants()).find(item => item.name === 'Split recovery');
                return window.electron.aiCodingAgent.planCode({requestId: 'split-recovery', assistantId: assistant.id,
                    prompt: 'Generate a dashboard with shared rendering modules.', workspaceFiles: []});
            }, provider);
            expect(result.success, result.error).toBe(true);
            expect(result.content.match(/### File:/g)).toHaveLength(3);
            expect(result.content.match(/### File: \/render.tsx/g)).toHaveLength(1);
            expect(result.content.match(/### File: \/ui\/dashboard-content.ts/g)).toHaveLength(1);
            expect(result.content).toContain(repaired);
            const requests = await app.evaluate(() => globalThis.__splitRepairRequests);
            expect(requests).toHaveLength(8);
            const recovery = requests[7].messages.at(-1).content;
            expect(recovery).toContain('PROGRESSED REJECTION');
            expect(recovery).toContain('does not export renderDashboard');
            expect(recovery).toContain('RE-VALIDATION CONTRACT');
            expect(await app.evaluate(() => globalThis.__FDO_E2E_LIVE_AI_BUDGET__.used)).toBe(8);
        } finally { await closeElectronApp(app); }
    });
}
