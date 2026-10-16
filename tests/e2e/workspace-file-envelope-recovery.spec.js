const {test, expect, _electron: electron} = require('@playwright/test');
const {launchElectronApp, closeElectronApp} = require('./helpers/electronApp');

for (const provider of ['openrouter', 'cloudflare']) {
    test(`${provider} switches a wrong JSON envelope to source after a syntax rejection`, async () => {
        const app = await launchElectronApp(electron, {reviewedWorkspaceFixture: true, isolatedUserDataDir: true,
            env: {FDO_E2E_LIVE_AI: '1', FDO_TEST_AI_MAX_REQUESTS: '6'}});
        try {
            const page = await app.firstWindow();
            await expect.poll(() => page.evaluate(async () => {
                try { return Array.isArray(await window.electron.settings.ai.getAssistants()); } catch { return false; }
            })).toBe(true);
            await app.evaluate(() => {
                globalThis.__envelopeRequests = [];
                const path = '/features/tools/types.ts';
                const source = 'export const tools = [{key: "text", label: "Text & Content"}];';
                const replies = [
                    JSON.stringify({files: [{path: '/constants.ts', contract: 'Shared constants'},
                        {path, contract: 'Tool definitions'}, {path: '/styles.css', contract: 'Tool styles'}]}),
                    JSON.stringify({path: '/constants.ts', lines: ['export const title = "Workbench";']}),
                    JSON.stringify({path, lines: ['export const tools = [{key: "text", "    label: "Text & Content"}];']}),
                    JSON.stringify({path, lines: [source], explanation: 'Corrected source'}),
                    `\`\`\`ts\n${source}\n\`\`\``,
                    '```css\n.tools { color: red; }\n```',
                ];
                globalThis.fetch = async (url, init = {}) => {
                    const address = String(url);
                    const cloudflare = `https://api.cloudflare.com/client/v4/accounts/${'a'.repeat(32)}/ai/`;
                    if (address === 'https://openrouter.ai/api/v1/auth/key') return Response.json({data: {}});
                    if (address === 'https://openrouter.ai/api/v1/models') return Response.json({data: [{id: 'envelope-model',
                        supported_parameters: ['structured_outputs', 'response_format'],
                        architecture: {input_modalities: ['text'], output_modalities: ['text']}}]});
                    if (address.startsWith(`${cloudflare}models/search?`)) return Response.json({success: true,
                        result: [{name: '@cf/qwen/qwen3.8-27b', task: {name: 'Text Generation'}}]});
                    if (!['https://openrouter.ai/api/v1/chat/completions', `${cloudflare}run/@cf/qwen/qwen3.8-27b`].includes(address)) {
                        throw new Error('Unexpected endpoint');
                    }
                    const body = JSON.parse(init.body);
                    globalThis.__envelopeRequests.push(body);
                    const content = replies[globalThis.__envelopeRequests.length - 1];
                    if (!content) throw new Error('Unexpected extra request');
                    const usage = {prompt_tokens: 100, completion_tokens: 30};
                    if (body.stream) return new Response([
                        {choices: [{delta: {content}}]},
                        {choices: [{delta: {}, finish_reason: 'stop'}]},
                        {choices: [], usage},
                    ].map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n',
                    {headers: {'content-type': 'text/event-stream'}});
                    const result = {choices: [{message: {content}, finish_reason: 'stop'}], usage};
                    return Response.json(address.startsWith(cloudflare) ? {success: true, result} : result);
                };
            });
            const result = await page.evaluate(async provider => {
                await window.electron.settings.ai.addAssistant({name: 'Envelope recovery', provider, purpose: 'coding',
                    model: provider === 'openrouter' ? 'envelope-model' : '@cf/qwen/qwen3.8-27b',
                    ...(provider === 'cloudflare' ? {accountId: 'a'.repeat(32)} : {}),
                    apiKey: 'test-only-token', defaultThinkingMode: 'off'});
                const assistant = (await window.electron.settings.ai.getAssistants()).find(item => item.name === 'Envelope recovery');
                return window.electron.aiCodingAgent.planCode(window.__withReviewedWorkspace({requestId: 'envelope-recovery', assistantId: assistant.id,
                    prompt: 'Generate shared tool types, constants and CSS.', workspaceFiles: []}));
            }, provider);
            expect(result.success, result.error).toBe(true);
            expect(result.content.match(/### File:/g)).toHaveLength(3);
            expect(result.content.match(/### File: \/constants.ts/g)).toHaveLength(1);
            expect(result.content).toContain('export const tools = [{key: "text", label: "Text & Content"}];');
            expect(result.content).not.toContain('explanation');
            const requests = await app.evaluate(() => globalThis.__envelopeRequests);
            expect(requests).toHaveLength(6);
            expect(requests[3].response_format).toBeUndefined();
            expect(requests[4].response_format).toBeUndefined();
            expect(requests[5].response_format).toBeUndefined();
            const recovery = requests[4].messages.at(-1).content;
            expect(recovery).toContain('SOURCE FORMAT RECOVERY');
            expect(recovery).toContain('invalid source syntax');
            expect(recovery).toContain('Received fields:');
            expect(recovery).toContain('still unresolved');
            expect(await app.evaluate(() => globalThis.__FDO_E2E_LIVE_AI_BUDGET__.used)).toBe(6);
        } finally { await closeElectronApp(app); }
    });
}
