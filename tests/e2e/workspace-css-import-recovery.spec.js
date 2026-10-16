const {test, expect, _electron: electron} = require('@playwright/test');
const {launchElectronApp, closeElectronApp} = require('./helpers/electronApp');
const workspace = require('../fixtures/ai/json-inspector-workspace.json');

for (const provider of ['openrouter', 'cloudflare']) {
    test(`${provider} corrects initial-plan CSS folder mistakes without repair requests`, async () => {
        const app = await launchElectronApp(electron, {reviewedWorkspaceFixture: true, isolatedUserDataDir: true,
            env: {FDO_E2E_LIVE_AI: '1', FDO_TEST_AI_MAX_REQUESTS: '8'}});
        try {
            const page = await app.firstWindow();
            await expect.poll(() => page.evaluate(async () => {
                try { return Array.isArray(await window.electron.settings.ai.getAssistants()); } catch { return false; }
            })).toBe(true);
            await app.evaluate(() => {
                globalThis.__cssImportRequests = [];
                const names = ['dashboard', 'workspace', 'library', 'space', 'category'];
                const paths = ['/styles/base.css', ...names.map(name => `/features/workbench/styles/${name}.css`), '/styles.css'];
                const responses = [{files: paths.map(path => ({path, contract: 'Workbench styles'}))},
                    ...paths.map((path, index) => ({path, lines: path === '/styles.css'
                        ? ['@import "./styles/base.css";', ...names.map(name => `@import "./styles/workbench/${name}.css";`), '.panel { color: red; }']
                        : [`.feature${index} { color: green; }`]}))];
                globalThis.fetch = async (url, init = {}) => {
                    const address = String(url);
                    const cloudflare = `https://api.cloudflare.com/client/v4/accounts/${'a'.repeat(32)}/ai/`;
                    if (address === 'https://openrouter.ai/api/v1/auth/key') return Response.json({data: {}});
                    if (address === 'https://openrouter.ai/api/v1/models') return Response.json({data: [{id: 'css-model',
                        supported_parameters: ['structured_outputs', 'response_format'],
                        architecture: {input_modalities: ['text'], output_modalities: ['text']}}]});
                    if (address.startsWith(`${cloudflare}models/search?`)) return Response.json({success: true,
                        result: [{name: '@cf/qwen/qwen3.8-27b', task: {name: 'Text Generation'}}]});
                    if (!['https://openrouter.ai/api/v1/chat/completions', `${cloudflare}run/@cf/qwen/qwen3.8-27b`].includes(address)) {
                        throw new Error('Unexpected endpoint');
                    }
                    const body = JSON.parse(init.body);
                    globalThis.__cssImportRequests.push(body);
                    const reply = responses[globalThis.__cssImportRequests.length - 1];
                    if (!reply) throw new Error('Unexpected repair request');
                    const content = JSON.stringify(reply);
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
                await window.electron.settings.ai.addAssistant({name: 'CSS import regression', provider, purpose: 'coding',
                    model: provider === 'openrouter' ? 'css-model' : '@cf/qwen/qwen3.8-27b',
                    ...(provider === 'cloudflare' ? {accountId: 'a'.repeat(32)} : {}),
                    apiKey: 'test-only-token', defaultThinkingMode: 'off'});
                const assistant = (await window.electron.settings.ai.getAssistants()).find(item => item.name === 'CSS import regression');
                return window.electron.aiCodingAgent.planCode(window.__withReviewedWorkspace({requestId: 'css-import-regression', assistantId: assistant.id,
                    prompt: 'Generate modular CSS files for the workbench.', workspaceFiles: []}));
            }, provider);
            expect(result.success, result.error).toBe(true);
            const generated = Object.fromEntries([...result.content.matchAll(/### File: ([^\n]+)\n```\w*\n([\s\S]*?)\n```/g)]
                .map(match => [match[1], match[2]]));
            expect(Object.keys(generated)).toHaveLength(7);
            for (const name of ['dashboard', 'workspace', 'library', 'space', 'category']) {
                expect(generated['/styles.css']).toContain(`@import "./features/workbench/styles/${name}.css";`);
            }
            expect(generated['/styles.css']).toContain('@import "./styles/base.css";');
            expect(generated['/styles.css']).toContain('.panel { color: red; }');
            expect(await app.evaluate(() => globalThis.__cssImportRequests.length)).toBe(8);
            expect(await app.evaluate(() => globalThis.__FDO_E2E_LIVE_AI_BUDGET__.used)).toBe(8);
            const compiled = await page.evaluate(latestContent => window.electron.plugin.build({latestContent}), {...workspace, ...generated});
            expect(compiled.success, compiled.error).toBe(true);
        } finally { await closeElectronApp(app); }
    });
}
