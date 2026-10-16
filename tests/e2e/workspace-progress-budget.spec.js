const {test, expect, _electron: electron} = require('@playwright/test');
const {launchElectronApp, closeElectronApp} = require('./helpers/electronApp');


for (const provider of ['openrouter', 'cloudflare']) {
  for (const mode of ['auto', '50']) {
    test(`${provider} uses ${mode} budgeting across validated and repeated files`, async () => {
        const app = await launchElectronApp(electron, {reviewedWorkspaceFixture: true, isolatedUserDataDir: true,
            env: {FDO_E2E_LIVE_AI: '1', FDO_TEST_AI_MAX_REQUESTS: mode}});
        try {
            const page = await app.firstWindow();
            await expect.poll(() => page.evaluate(async () => {
                try { return Array.isArray(await window.electron.settings.ai.getAssistants()); } catch { return false; }
            })).toBe(true);
            await app.evaluate(() => {
                let plans = 0;
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
                    const schema = body.response_format?.json_schema?.schema || body.response_format?.json_schema;
                    const path = schema?.properties.path?.enum?.[0] || body.messages.at(-1).content.match(/Generate ONLY (\/[^\s]+)\. Its contract:/)?.[1];
                    const content = schema?.properties.files
                        ? JSON.stringify({files: Array.from({length: ++plans === 1 ? 24 : 12}, (_, i) => ({path: `/feature-${i}.ts`, contract: 'Export a feature value'}))})
                        : JSON.stringify({path, lines: ['export const value = 1;']});
                    const finishReason = 'stop';
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
            const results = await page.evaluate(async ({provider}) => {
                await window.electron.settings.ai.addAssistant({name: 'Progress budget', provider, purpose: 'coding',
                    model: provider === 'openrouter' ? 'split-model' : '@cf/qwen/qwen3.8-27b',
                    ...(provider === 'cloudflare' ? {accountId: 'a'.repeat(32)} : {}),
                    apiKey: 'test-only-token', defaultThinkingMode: 'off'});
                const assistant = (await window.electron.settings.ai.getAssistants()).find(item => item.name === 'Progress budget');
                const results = [];
                for (let i = 0; i < 3; i++) {
                    results.push(await window.electron.aiCodingAgent.planCode(window.__withReviewedWorkspace({requestId: `progress-budget-${i}`, assistantId: assistant.id,
                        prompt: 'Generate a dashboard workspace with feature modules.', workspaceFiles: []})));
                }
                return results;
            }, {provider});
            expect(results[0].success, results[0].error).toBe(true);
            expect(results[1].success, results[1].error).toBe(true);
            const budget = await app.evaluate(() => globalThis.__FDO_E2E_LIVE_AI_BUDGET__);
            const count = await app.evaluate(() => globalThis.__splitRepairRequests.length);
            if (mode === 'auto') {
                expect(results[2].success, results[2].error).toBe(true);
                expect(budget).toMatchObject({used: 51, ceiling: 74, validatedFiles: 24, maximumCeiling: 86});
                expect(count).toBe(51);
            } else {
                expect(results[2].success).toBe(false);
                expect(results[2].error).toContain('12 requests needed, 11 remaining (39/50 used)');
                expect(budget).toMatchObject({used: 39, ceiling: 50, progressAllowance: 0});
                expect(count).toBe(39);
            }
        } finally { await closeElectronApp(app); }
    });
}
}
