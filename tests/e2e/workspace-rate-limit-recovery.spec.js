const {test, expect, _electron: electron} = require('@playwright/test');
const {launchElectronApp, closeElectronApp} = require('./helpers/electronApp');

for (const retrySeconds of [15, 86400]) {
    test(`workspace HTTP 429 respects a ${retrySeconds}s server reset`, async () => {
        const app = await launchElectronApp(electron, {isolatedUserDataDir: true,
            env: {FDO_E2E_LIVE_AI: '1', FDO_TEST_AI_MAX_REQUESTS: '3'}});
        try {
            const page = await app.firstWindow();
            await expect.poll(() => page.evaluate(async () => {
                try { return Array.isArray(await window.electron.settings.ai.getAssistants()); } catch { return false; }
            })).toBe(true);
            await app.evaluate((_, retrySeconds) => {
                globalThis.__rateLimitRequests = [];
                globalThis.fetch = async (url, init = {}) => {
                    const address = String(url);
                    if (address === 'https://openrouter.ai/api/v1/auth/key') return Response.json({data: {}});
                    if (address === 'https://openrouter.ai/api/v1/models') return Response.json({data: [{id: 'rate-model',
                        supported_parameters: ['structured_outputs'], architecture: {input_modalities: ['text']}}]});
                    if (address !== 'https://openrouter.ai/api/v1/chat/completions') throw new Error('Unexpected endpoint');
                    const body = JSON.parse(init.body);
                    globalThis.__rateLimitRequests.push({at: Date.now(), body});
                    const attempt = globalThis.__rateLimitRequests.length;
                    if (attempt === 1) return Response.json({error: {code: 429, message: 'Provider returned error'}},
                        {status: 429, headers: {'retry-after': String(retrySeconds)}});
                    const response = attempt === 2 ? {files: [{path: '/logic.ts', contract: 'Export answer = 42', visualReference: false}]}
                        : attempt === 3 ? {path: '/logic.ts', lines: ['export const answer = 42;']} : null;
                    if (!response) throw new Error('Unexpected extra request');
                    return new Response([
                        {choices: [{delta: {content: JSON.stringify(response)}}]},
                        {choices: [{delta: {}, finish_reason: 'stop'}]},
                        {choices: [], usage: {prompt_tokens: 10, completion_tokens: 10}},
                    ].map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n',
                    {headers: {'content-type': 'text/event-stream'}});
                };
            }, retrySeconds);
            const result = await page.evaluate(async () => {
                window.__rateLimitStatuses = [];
                window.electron.aiCodingAgent.on.streamDelta(data => {
                    if (data.requestId === 'rate-recovery' && data.type === 'status'
                        && data.metadata?.phase === 'provider-retry') window.__rateLimitStatuses.push(data);
                });
                await window.electron.settings.ai.addAssistant({name: 'Rate recovery', provider: 'openrouter',
                    purpose: 'coding', model: 'rate-model', apiKey: 'test-only-token', defaultThinkingMode: 'off'});
                const assistant = (await window.electron.settings.ai.getAssistants()).find(item => item.name === 'Rate recovery');
                return window.electron.aiCodingAgent.planCode({requestId: 'rate-recovery', assistantId: assistant.id,
                    prompt: 'Create a workspace module exporting answer = 42.', workspaceFiles: []});
            });
            const requests = await app.evaluate(() => globalThis.__rateLimitRequests);
            const statuses = await page.evaluate(() => window.__rateLimitStatuses);
            if (retrySeconds === 15) {
                expect(result.success, result.error).toBe(true);
                expect(result.content).toContain('export const answer = 42;');
                expect(requests).toHaveLength(3);
                expect(requests[1].at - requests[0].at).toBeGreaterThanOrEqual(15000);
                expect(requests[1].body).toEqual(requests[0].body);
                expect(statuses).toHaveLength(1);
                expect(statuses[0].message).toContain('once in 15 seconds');
                expect(statuses[0].metadata.delayMs).toBe(15000);
            } else {
                expect(result.success).toBe(false);
                expect(result.error).toContain('HTTP 429');
                expect(result.error).toContain('86400 seconds');
                expect(requests).toHaveLength(1);
                expect(statuses).toHaveLength(0);
            }
            expect(await app.evaluate(() => globalThis.__FDO_E2E_LIVE_AI_BUDGET__.used)).toBe(requests.length);
        } finally { await closeElectronApp(app); }
    });
}
