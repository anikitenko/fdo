const {test, expect, _electron: electron} = require('@playwright/test');
const {launchElectronApp, closeElectronApp} = require('./helpers/electronApp');
for (const [fixtureName, defect, hint] of [
    ['workspace-syntax-repair', 'TypeScript function types', 'Function-type syntax uses =>'],
    ['workspace-import-binding-repair', 'import/local binding collisions', 'Alias the import'],
    ['workspace-export-repair', 'wrong module responsibility and missing exports', 'Required exports: ["renderDashboard"]'],
    ['workspace-self-forwarder', 'redundant self-forwarding exports', null],
]) {
for (const raw of [false, true]) {
const fixture = require(`../fixtures/ai/${fixtureName}.cjs`).scenario(raw);
const {replies, workspaceFiles} = fixture;

for (const provider of ['openrouter', 'cloudflare']) {
    test(`${provider} repairs ${defect} with focused ${raw ? "source" : "JSON"} context`, async () => {
        const app = await launchElectronApp(electron, {isolatedUserDataDir: true,
            env: {FDO_E2E_LIVE_AI: '1', FDO_TEST_AI_MAX_REQUESTS: String(replies.length)}});
        try {
            const page = await app.firstWindow();
            await expect.poll(() => page.evaluate(async () => {
                try { return Array.isArray(await window.electron.settings.ai.getAssistants()); } catch { return false; }
            })).toBe(true);
            await app.evaluate((_, replies) => {
                globalThis.__syntaxRepairRequests = [];
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
                    globalThis.__syntaxRepairRequests.push(body);
                    const reply = replies[globalThis.__syntaxRepairRequests.length - 1];
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
            const result = await page.evaluate(async ({provider, workspaceFiles, prompt}) => {
                await window.electron.settings.ai.addAssistant({name: 'Focused syntax recovery', provider, purpose: 'coding',
                    model: provider === 'openrouter' ? 'split-model' : '@cf/qwen/qwen3.8-27b',
                    ...(provider === 'cloudflare' ? {accountId: 'a'.repeat(32)} : {}),
                    apiKey: 'test-only-token', defaultThinkingMode: 'off'});
                const assistant = (await window.electron.settings.ai.getAssistants()).find(item => item.name === 'Focused syntax recovery');
                return window.electron.aiCodingAgent.planCode({requestId: 'syntax-recovery', assistantId: assistant.id,
                    prompt, workspaceFiles});
            }, {provider, workspaceFiles, prompt: fixture.prompt});
            expect(result.success, result.error).toBe(true);
            expect(result.content).toContain(fixture.corrected.trim());
            expect(result.content).toContain(fixture.consumer);
            const requests = await app.evaluate(() => globalThis.__syntaxRepairRequests);
            expect(requests).toHaveLength(replies.length);
            if (!fixture.normalized) {
                const repair = requests.at(-1).messages.at(-1).content;
                expect(repair).toContain(fixture.repairHeading || 'FOCUSED WORKSPACE SYNTAX REPAIR');
                expect(repair).toContain(hint);
                expect(repair).toContain(fixture.source);
                expect(repair).not.toContain('UNRELATED_IMPLEMENTATION');
                expect(repair).not.toContain('ORIGINAL SCAFFOLD REQUEST');
            } else {
                // The exact budget leaves no room for another model repair.
                expect(result.content.match(/^### File:/gm)).toHaveLength(2);
                expect(await app.evaluate(() => globalThis.__FDO_E2E_LIVE_AI_BUDGET__.ceiling)).toBe(replies.length);
            }
            expect(await app.evaluate(() => globalThis.__FDO_E2E_LIVE_AI_BUDGET__.used)).toBe(replies.length);
        } finally { await closeElectronApp(app); }
    });
}

}

}
