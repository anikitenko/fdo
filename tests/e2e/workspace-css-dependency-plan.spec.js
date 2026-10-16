const {test, expect, _electron: electron} = require('@playwright/test');
const {launchElectronApp, closeElectronApp} = require('./helpers/electronApp');
const fixture = require('../fixtures/ai/workspace-css-dependency-plan.cjs');
const replies = fixture.replies.map(content => ({content}));
const workspaceFiles = [];
const expectedPaths = [fixture.entry.path, ...fixture.dependencies, fixture.root.path, fixture.tail.path];

for (const provider of ['openrouter', 'cloudflare']) {
    test(`${provider} plans missing stylesheets before generating the recorded CSS dependencies`, async () => {
        const app = await launchElectronApp(electron, {reviewedWorkspaceFixture: true, isolatedUserDataDir: true,
            env: {FDO_E2E_LIVE_AI: '1', FDO_TEST_AI_MAX_REQUESTS: String(replies.length)}});
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
            const result = await page.evaluate(async ({provider, workspaceFiles}) => {
                await window.electron.settings.ai.addAssistant({name: 'CSS dependency recovery', provider, purpose: 'coding',
                    model: provider === 'openrouter' ? 'split-model' : '@cf/qwen/qwen3.8-27b',
                    ...(provider === 'cloudflare' ? {accountId: 'a'.repeat(32)} : {}),
                    apiKey: 'test-only-token', defaultThinkingMode: 'off'});
                const assistant = (await window.electron.settings.ai.getAssistants()).find(item => item.name === 'CSS dependency recovery');
                return window.electron.aiCodingAgent.planCode(window.__withReviewedWorkspace({requestId: 'css-dependency-recovery', assistantId: assistant.id,
                    prompt: 'Generate a dashboard with shared rendering modules.', workspaceFiles}));
            }, {provider, workspaceFiles});
            expect(result.success, result.error).toBe(true);
            expect([...result.content.matchAll(/^### File: (.+)$/gm)].map(match => match[1])).toEqual(expectedPaths);
            const requests = await app.evaluate(() => globalThis.__splitRepairRequests);
            expect(requests).toHaveLength(replies.length);
            expect(requests[3].messages.at(-1).content).toContain('Missing references (diagnostic data, not approved files)');
            expect(requests[3].messages.at(-1).content).not.toContain('exceeded its file response budget');
            expect(result.content).toContain(fixture.composition);
            expect(await app.evaluate(() => globalThis.__FDO_E2E_LIVE_AI_BUDGET__.used)).toBe(replies.length);
        } finally { await closeElectronApp(app); }
    });
}
