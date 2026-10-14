const {test, expect, _electron: electron} = require('@playwright/test');
const {launchElectronApp, closeElectronApp} = require('./helpers/electronApp');

for (const thinkingMode of ['off', 'on', 'auto']) {
    test(`OpenRouter workspace honors ${thinkingMode} during planning and file generation`, async () => {
        const app = await launchElectronApp(electron, {isolatedUserDataDir: true,
            env: {FDO_E2E_LIVE_AI: '1', FDO_TEST_AI_MAX_REQUESTS: '3'}});
        try {
            const page = await app.firstWindow();
            await expect.poll(() => page.evaluate(async () => {
                try { return Array.isArray(await window.electron.settings.ai.getAssistants()); } catch { return false; }
            })).toBe(true);
            // Mock HTTP only: settings, native SDK, planning, source validation
            // and IPC run from the built application.
            await app.evaluate(() => {
                globalThis.__openRouterPolicyRequests = [];
                globalThis.fetch = async (url, init = {}) => {
                    const address = String(url);
                    if (address === 'https://openrouter.ai/api/v1/auth/key') return Response.json({data: {}});
                    if (address === 'https://openrouter.ai/api/v1/models') return Response.json({data: [{id: 'policy-model',
                        supported_parameters: ['structured_outputs', 'response_format'],
                        architecture: {input_modalities: ['text', 'image'], output_modalities: ['text']}}]});
                    if (address !== 'https://openrouter.ai/api/v1/chat/completions') throw new Error('Unexpected endpoint');
                    const body = JSON.parse(init.body);
                    globalThis.__openRouterPolicyRequests.push(body);
                    if (body.reasoning?.effort !== undefined && body.reasoning?.max_tokens !== undefined) {
                        return Response.json({error: {message: 'Only one of reasoning.effort and reasoning.max_tokens can be specified'}}, {status: 400});
                    }
                    const responses = [
                        {files: [{path: '/logic.ts', contract: 'Export format(value: unknown): string', visualReference: false},
                            {path: '/tests/logic.test.ts', contract: 'Test format with node:test', visualReference: false}]},
                        {path: '/logic.ts', lines: ['export const format = (value: unknown): string => JSON.stringify(value);']},
                        {path: '/tests/logic.test.ts', lines: ["import test from 'node:test';", "import assert from 'node:assert/strict';",
                            "import {format} from '../logic';", "test('formats', () => assert.equal(format({}), '{}'));"]},
                    ];
                    const response = responses[globalThis.__openRouterPolicyRequests.length - 1];
                    if (!response) throw new Error('Unexpected extra generation request');
                    return new Response([
                        {choices: [{delta: {content: JSON.stringify(response)}}]},
                        {choices: [{delta: {}, finish_reason: 'stop'}]},
                        {choices: [], usage: {prompt_tokens: 100, completion_tokens: 30}},
                    ].map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n',
                    {headers: {'content-type': 'text/event-stream'}});
                };
            });
            const result = await page.evaluate(async thinkingMode => {
                await window.electron.settings.ai.addAssistant({name: 'Policy regression', provider: 'openrouter',
                    purpose: 'coding', model: 'policy-model', apiKey: 'test-only-token', defaultThinkingMode: thinkingMode});
                const assistant = (await window.electron.settings.ai.getAssistants()).find(item => item.name === 'Policy regression');
                return window.electron.aiCodingAgent.planCode({requestId: 'policy-regression', assistantId: assistant.id,
                    prompt: 'Create a pure JSON formatter and node:test tests as workspace files.', workspaceFiles: []});
            }, thinkingMode);
            expect(result.success, result.error).toBe(true);
            expect(result.content).toContain('### File: /tests/logic.test.ts');
            const requests = await app.evaluate(() => globalThis.__openRouterPolicyRequests);
            expect(requests).toHaveLength(3);
            for (const body of requests) {
                expect(body.reasoning).toEqual(thinkingMode === 'auto' ? undefined : {enabled: thinkingMode === 'on'});
                expect(body.response_format?.type).toBe('json_schema');
                expect(body.provider).toEqual({require_parameters: true});
            }
            expect(requests[0].max_tokens).toBe(2048);
            expect(await app.evaluate(() => globalThis.__FDO_E2E_LIVE_AI_BUDGET__.used)).toBe(3);
        } finally { await closeElectronApp(app); }
    });
}
