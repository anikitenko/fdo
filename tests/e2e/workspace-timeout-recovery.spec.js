const {test, expect, _electron: electron} = require('@playwright/test');
const {launchElectronApp, closeElectronApp} = require('./helpers/electronApp');

test('native Cloudflare independently splits media, social and render with compact dependency context', async () => {
    const app = await launchElectronApp(electron, {isolatedUserDataDir: true, env: {
        FDO_E2E_LIVE_AI: '1', FDO_TEST_AI_MAX_REQUESTS: 'auto',
    }});
    try {
        const page = await app.firstWindow();
        await expect.poll(() => page.evaluate(async () => {
            try { return Array.isArray(await window.electron.settings.ai.getAssistants()); } catch { return false; }
        })).toBe(true);
        await app.evaluate(() => {
            globalThis.__independentRequests = [];
            let plans = 0;
            const roots = ['/media.ts', '/social.ts', '/render.tsx'];
            const expanded = new Set();
            globalThis.fetch = async (url, init = {}) => {
                const base = `https://api.cloudflare.com/client/v4/accounts/${'a'.repeat(32)}/ai/`;
                if (String(url).startsWith(`${base}models/search?`)) return Response.json({success: true,
                    result: [{name: '@cf/qwen/qwen3.8-27b', task: {name: 'Text Generation'}}]});
                if (String(url) !== `${base}run/@cf/qwen/qwen3.8-27b`) throw new Error('Unexpected endpoint');
                const body = JSON.parse(init.body);
                globalThis.__independentRequests.push(body);
                const path = body.response_format.json_schema.properties.path?.enum[0];
                let content;
                if (!path) {
                    content = {files: plans === 0 ? roots.map(path => ({path, contract: 'Export feature renderer'}))
                        : [{path: `/helpers/helper${plans}.ts`, contract: 'Export focused helper'}]};
                    if (plans) expanded.add(roots[plans - 1]);
                    plans++;
                } else if (roots.includes(path) && !expanded.has(path)) {
                    return Response.json({result: {choices: [{message: {content: 'truncated'}, finish_reason: 'length'}]}});
                } else {
                    content = {path, lines: ['export function render(): string {',
                        ...Array(80).fill('// INTERNAL_IMPLEMENTATION_DETAIL preserved in source'), 'return "Hello";', '}']};
                }
                return Response.json({result: {choices: [{message: {content: JSON.stringify(content)}, finish_reason: 'stop'}],
                    usage: {prompt_tokens: 100, completion_tokens: 20}}});
            };
        });
        const observed = await page.evaluate(async () => {
            await window.electron.settings.ai.addAssistant({name: 'Independent splits', provider: 'cloudflare', purpose: 'coding',
                model: '@cf/qwen/qwen3.8-27b', accountId: 'a'.repeat(32), apiKey: 'test-token', defaultThinkingMode: 'off'});
            const assistant = (await window.electron.settings.ai.getAssistants()).find(item => item.name === 'Independent splits');
            const done = [], errors = [];
            window.electron.aiCodingAgent.on.streamDone(event => done.push(event));
            window.electron.aiCodingAgent.on.streamError(event => errors.push(event));
            const result = await window.electron.aiCodingAgent.planCode({requestId: 'independent-splits', assistantId: assistant.id,
                prompt: 'Build a plugin with media, social and render modules.'});
            return {result, done, errors};
        });
        expect(observed.result.success).toBe(true);
        expect(observed.errors).toEqual([]);
        expect(observed.done).toHaveLength(1);
        expect(observed.result.content.match(/### File:/g)).toHaveLength(6);
        expect(observed.result.content.match(/INTERNAL_IMPLEMENTATION_DETAIL/g)).toHaveLength(480);
        const requests = await app.evaluate(() => globalThis.__independentRequests);
        expect(requests).toHaveLength(13);
        const lastPrompt = requests.at(-1).messages.at(-1).content;
        expect(lastPrompt).toContain('export function render(): string');
        expect(lastPrompt).not.toContain('INTERNAL_IMPLEMENTATION_DETAIL');
        const budget = await app.evaluate(() => globalThis.__FDO_E2E_LIVE_AI_BUDGET__);
        expect(budget.used).toBe(13);
        const lifecycle = await app.evaluate(() => globalThis.__FDO_E2E_CODING_LIFECYCLE__);
        const rendererCalls = lifecycle.filter(entry => entry.event === 'provider-request-dispatched' && entry.workspaceStep === '/render.tsx');
        expect(rendererCalls.map(entry => entry.maxOutputTokens)).toEqual([6144, 2048]);
        expect(rendererCalls.every(entry => entry.promptCharacters > 0 && entry.systemCharacters > 0 && entry.structured)).toBe(true);
        expect(lifecycle.find(entry => entry.event === 'request-failed')).toMatchObject({workspaceStep: '/media.ts', elapsedMs: expect.any(Number)});
        expect(lifecycle.find(entry => entry.event === 'request-completed')).toMatchObject({inputTokens: 100, outputTokens: 20});
        expect(JSON.stringify(lifecycle)).not.toMatch(/test-token|INTERNAL_IMPLEMENTATION_DETAIL/);
    } finally { await closeElectronApp(app); }
});


for (const scenario of ['recovers', 'persists', 'incomplete stream', 'planning timeout', 'aborted', 'budget exhausted', 'cancelled']) {
    test(`native Cloudflare HTTP 408 transport recovery: ${scenario}`, async () => {
        const app = await launchElectronApp(electron, {isolatedUserDataDir: true, env: {
            FDO_E2E_LIVE_AI: '1', FDO_TEST_AI_MAX_REQUESTS: scenario === 'budget exhausted' ? '3' : 'auto',
        }});
        try {
            const page = await app.firstWindow();
            await expect.poll(() => page.evaluate(async () => {
                try { return Array.isArray(await window.electron.settings.ai.getAssistants()); } catch { return false; }
            })).toBe(true);
            await app.evaluate((_electron, scenario) => {
                globalThis.__timeoutRequests = [];
                globalThis.fetch = async (url, init = {}) => {
                    const base = `https://api.cloudflare.com/client/v4/accounts/${'a'.repeat(32)}/ai/`;
                    if (String(url).startsWith(`${base}models/search?`)) return Response.json({success: true,
                        result: [{name: '@cf/qwen/qwen3.8-27b', task: {name: 'Text Generation'}}]});
                    if (String(url) !== `${base}run/@cf/qwen/qwen3.8-27b`) throw new Error('Unexpected endpoint');
                    const body = JSON.parse(init.body);
                    const attempt = globalThis.__timeoutRequests.push(body);
                    if (scenario === 'planning timeout' || attempt === 3 || (attempt === 4 && scenario === 'persists')) {
                        return Response.json({errors: [{message: 'Request timeout', code: scenario === 'aborted' ? 3008 : 3046}],
                            success: false, result: {}, messages: []}, {status: 408});
                    }
                    if (scenario === 'cancelled' && attempt === 4) return new Promise((resolve, reject) => {
                        const abort = () => reject(Object.assign(new Error('Aborted'), {name: 'AbortError'}));
                        if (init.signal.aborted) abort();
                        else init.signal.addEventListener('abort', abort, {once: true});
                    });
                    if (attempt >= 4) {
                        const text = 'The entry imports the completed renderer.\n```ts\nimport {render} from "./render";\n```\nUpdated the requested file.';
                        const events = [{choices: [{delta: {content: text}, finish_reason: null}]}];
                        if (scenario !== 'incomplete stream') events.push({choices: [{delta: {}, finish_reason: 'stop'}],
                            usage: {prompt_tokens: 100, completion_tokens: 20}});
                        return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''),
                            {headers: {'content-type': 'text/event-stream'}});
                    }
                    const content = attempt === 1 ? {files: [
                        {path: '/render.ts', contract: 'Export render()'}, {path: '/index.ts', contract: 'Import render()'},
                    ]} : {path: '/render.ts', content: 'export const render = () => "Hello";'};
                    return Response.json({result: {choices: [{message: {content: JSON.stringify(content)}, finish_reason: 'stop'}],
                        usage: {prompt_tokens: 100, completion_tokens: 20}}});
                };
            }, scenario);
            await page.evaluate(async () => {
                await window.electron.settings.ai.addAssistant({name: 'Timeout workspace', provider: 'cloudflare', purpose: 'coding',
                    model: '@cf/qwen/qwen3.8-27b', accountId: 'a'.repeat(32), apiKey: 'test-token', defaultThinkingMode: 'off'});
                const assistant = (await window.electron.settings.ai.getAssistants()).find(item => item.name === 'Timeout workspace');
                const done = [], errors = [], stages = [];
                window.electron.aiCodingAgent.on.streamDone(event => done.push(event));
                window.electron.aiCodingAgent.on.streamError(event => errors.push(event));
                window.electron.aiCodingAgent.on.streamDelta(event => { if (event.type === 'stage') stages.push(event); });
                window.__timeoutResult = window.electron.aiCodingAgent.planCode({requestId: 'timeout-test', assistantId: assistant.id,
                    prompt: 'Build a greeting plugin.'}).then(result => ({result, done, errors, stages}));
            });
            if (scenario === 'cancelled') {
                await expect.poll(() => app.evaluate(() => globalThis.__timeoutRequests.length)).toBe(4);
                await page.evaluate(() => window.electron.aiCodingAgent.cancelRequest({requestId: 'timeout-test'}));
            }
            const observed = await page.evaluate(() => window.__timeoutResult);
            const requests = await app.evaluate(() => globalThis.__timeoutRequests);
            const expectedCalls = scenario === 'planning timeout' ? 2 : ['aborted', 'budget exhausted'].includes(scenario) ? 3 : 4;
            expect(requests).toHaveLength(expectedCalls);
            if (expectedCalls === 4) {
                expect(requests[2].stream).toBe(false);
                expect(requests[2].response_format).toBeDefined();
                expect(requests[3].stream).toBe(true);
                expect(requests[3].response_format).toBeUndefined();
                expect(requests[3].max_tokens).toBe(requests[2].max_tokens);
                expect(requests[3].messages.at(-1).content).toContain('Return exactly one closed fenced code block');
            }
            expect(observed.stages.some(stage => stage.label.startsWith('Splitting'))).toBe(false);
            const success = scenario === 'recovers';
            expect(observed.done).toHaveLength(success ? 1 : 0);
            expect(observed.result.success).toBe(success);
            if (success) {
                expect(observed.errors).toEqual([]);
                expect(observed.result.content).toContain('export const render = () => "Hello";');
                expect(observed.result.content).toContain('### File: /index.ts');
                expect(observed.result.content.match(/### File:/g)).toHaveLength(2);
                expect(observed.result.content).not.toContain('The entry imports');
                expect(observed.result.content).not.toContain('Updated the requested file.');
            } else if (scenario === 'persists') expect(observed.result.error).toContain('/index.ts timed out at the provider while streaming');
            else if (scenario === 'planning timeout') expect(observed.result.error).toContain('Planning workspace files');
            else if (scenario === 'aborted') expect(observed.result.error).toContain('3008');
            else if (scenario === 'budget exhausted') expect(observed.result.error).toContain('1 requests needed, 0 remaining');
            else if (scenario === 'incomplete stream') expect(observed.result.error).toContain('before a completion event');
            else expect(observed.result.cancelled).toBe(true);
            const budget = await app.evaluate(() => globalThis.__FDO_E2E_LIVE_AI_BUDGET__);
            expect(budget.used).toBe(requests.length);
            const usage = await page.evaluate(() => window.electron.aiUsage.get({surface: 'coding'}));
            expect(usage.entries).toHaveLength(requests.length);
            expect(usage.entries.filter(entry => entry.status === 'completed')).toHaveLength(scenario === 'planning timeout' ? 0 : success ? 3 : 2);
        } finally { await closeElectronApp(app); }
    });
}
