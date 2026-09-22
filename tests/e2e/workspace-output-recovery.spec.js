const {test, expect, _electron: electron} = require('@playwright/test');
const {launchElectronApp, closeElectronApp} = require('./helpers/electronApp');

for (const repeated of [false, true]) {
    test(`native Cloudflare enlarges a reduced CSS allowance once: ${repeated ? 'still truncated' : 'complete'}`, async () => {
        const app = await launchElectronApp(electron, {isolatedUserDataDir: true, env: {
            FDO_E2E_LIVE_AI: '1', FDO_TEST_AI_MAX_REQUESTS: 'auto',
        }});
        try {
            const page = await app.firstWindow();
            await expect.poll(() => page.evaluate(async () => {
                try { return Array.isArray(await window.electron.settings.ai.getAssistants()); } catch { return false; }
            })).toBe(true);
            await app.evaluate((_electron, repeated) => {
                globalThis.__outputRequests = [];
                globalThis.fetch = async (url, init = {}) => {
                    const base = `https://api.cloudflare.com/client/v4/accounts/${'a'.repeat(32)}/ai/`;
                    if (String(url).startsWith(`${base}models/search?`)) return Response.json({success: true,
                        result: [{name: '@cf/qwen/qwen3.8-27b', task: {name: 'Text Generation'}}]});
                    if (String(url) !== `${base}run/@cf/qwen/qwen3.8-27b`) throw new Error('Unexpected endpoint');
                    const body = JSON.parse(init.body);
                    globalThis.__outputRequests.push(body);
                    const attempt = globalThis.__outputRequests.length;
                    const path = body.response_format.json_schema.properties.path?.enum[0];
                    const truncated = [2, 4, 5, 7].includes(attempt) || (repeated && attempt === 8);
                    const content = !path ? {files: attempt === 1 ? [
                        {path: '/styles.css', contract: 'Styles'}, {path: '/index.ts', contract: 'Entry'},
                    ] : [{path: attempt === 3 ? '/styles/components.css' : '/styles/surfaces.css', contract: 'Focused styles'}]}
                        : {path, lines: truncated ? ['DISCARDED_TRUNCATED_SOURCE']
                            : path === '/styles/surfaces.css' ? ['.surface { color: red; }']
                                : path === '/styles/components.css' ? ['@import "./surfaces.css";']
                                    : path === '/styles.css' ? ['@import "./styles/components.css";'] : ['export {};']};
                    return Response.json({result: {choices: [{message: {content: JSON.stringify(content)}, finish_reason: truncated ? 'length' : 'stop'}],
                        usage: {prompt_tokens: 100, completion_tokens: 20}}});
                };
            }, repeated);
            const observed = await page.evaluate(async () => {
                await window.electron.settings.ai.addAssistant({name: 'Output recovery', provider: 'cloudflare', purpose: 'coding',
                    model: '@cf/qwen/qwen3.8-27b', accountId: 'a'.repeat(32), apiKey: 'test-token', defaultThinkingMode: 'off'});
                const assistant = (await window.electron.settings.ai.getAssistants()).find(item => item.name === 'Output recovery');
                const done = [], errors = [], stages = [];
                window.electron.aiCodingAgent.on.streamDone(event => done.push(event));
                window.electron.aiCodingAgent.on.streamError(event => errors.push(event));
                window.electron.aiCodingAgent.on.streamDelta(event => { if (event.type === 'stage') stages.push(event); });
                const result = await window.electron.aiCodingAgent.planCode({requestId: 'output-recovery', assistantId: assistant.id,
                    prompt: 'Build a styled plugin with feature stylesheets.'});
                return {result, done, errors, stages};
            });
            const requests = await app.evaluate(() => globalThis.__outputRequests);
            expect(requests.map(body => body.max_tokens)).toEqual([2048, 3072, 2048, 1536, 3072, 2048, 1024, 2048,
                ...(repeated ? [] : [1024, 1536, 6144])]);
            expect(observed.result.success).toBe(!repeated);
            expect(observed.done).toHaveLength(repeated ? 0 : 1);
            expect(observed.stages.some(stage => stage.label === 'Retrying complete file: /styles/surfaces.css (2048 output tokens)')).toBe(true);
            expect(JSON.stringify(observed)).not.toContain('DISCARDED_TRUNCATED_SOURCE');
            if (repeated) expect(observed.result.error).toContain('after bounded file splitting');
            else {
                expect(observed.errors).toEqual([]);
                expect(observed.result.content).toContain('.surface { color: red; }');
                expect(observed.result.content.match(/### File:/g)).toHaveLength(4);
            }
            const budget = await app.evaluate(() => globalThis.__FDO_E2E_LIVE_AI_BUDGET__);
            expect(budget.used).toBe(requests.length);
            const usage = await page.evaluate(() => window.electron.aiUsage.get({surface: 'coding'}));
            expect(usage.entries).toHaveLength(requests.length);
            expect(usage.entries.filter(entry => entry.status === 'failed')).toHaveLength(repeated ? 5 : 4);
        } finally { await closeElectronApp(app); }
    });
}
