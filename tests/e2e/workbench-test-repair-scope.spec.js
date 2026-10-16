const {test, expect, _electron: electron} = require('@playwright/test');
const {launchElectronApp, closeElectronApp} = require('./helpers/electronApp');
const {buildWorkbenchConvergencePrompt} = require('./helpers/workbenchConvergence.cjs');
const {workbenchTestRepairPaths} = require('./helpers/workbenchRepairScope.cjs');
const originalRecording = require('../fixtures/ai/workbench-test-repair-scope.json');
// Keep this test-only repair's retained implementation valid. The archived
// recording used a nonexistent TextEncoder.decode method for data URL sizing.
const recorded = {...originalRecording, files: {...originalRecording.files,
    '/features/tools/logic.ts': originalRecording.files['/features/tools/logic.ts'].replace(
        'new TextEncoder().decode(new Uint8Array(0)).length === 0 ? decodeURIComponent(payload).length : payload.length',
        'new TextEncoder().encode(decodeURIComponent(payload)).byteLength'),
}};
// The recording predates these renderers' classes-object interfaces. This test
// repairs tests within an otherwise valid workspace, rather than replaying an
// unrelated implementation migration outside that repair scope.
recorded.files['/render.tsx'] = recorded.files['/render.tsx']
    .replace('render(json: unknown = null)', 'render()')
    .replace('renderCategory(category: string)', 'renderCategory(category: Parameters<typeof renderCategoryWorkspace>[0])')
    .replace('{ "data-role": "tool-workbench" }', '{ class: shellClass, "data-role": "tool-workbench" }')
    .replace('renderDashboard(dom, cardClass, dashboardClass)', 'renderDashboard(undefined, undefined, {card: cardClass, dashboard: dashboardClass})')
    .replace('renderJsonWorkspace(dom, workspaceClass, resultClass)', 'renderJsonWorkspace({workspace: workspaceClass, result: resultClass})')
    .replace(/renderCategoryWorkspace\(dom, workspaceClass, resultClass, ([^)]+)\)/g, 'renderCategoryWorkspace($1, {workspace: workspaceClass, result: resultClass})')
    .replace('renderLibrary(dom, libraryClass)', 'renderLibrary({library: libraryClass})')
    .replace('renderSpaceDialog(dom)', 'renderSpaceDialog({result: resultClass})');
recorded.files['/render.test.ts'] = recorded.files['/render.test.ts'].replace('render({ tool: "json" })', 'render()');

test('Workbench test repair uses seven scoped file requests within fourteen remaining slots', async () => {
    const app = await launchElectronApp(electron, {isolatedUserDataDir: true,
        env: {FDO_E2E_LIVE_AI: '1', FDO_TEST_AI_MAX_REQUESTS: '14'}});
    try {
        const page = await app.firstWindow();
        await app.evaluate((_electron, files) => {
            globalThis.__scopedRequests = [];
            globalThis.fetch = async (url, init = {}) => {
                if (String(url).includes('/models/search')) return Response.json({success: true,
                    result: [{name: '@cf/test/model', task: {name: 'Text Generation'}}]});
                if (!String(url).endsWith('/run/@cf/test/model')) throw new Error(`Unexpected endpoint ${url}`);
                const body = JSON.parse(init.body);
                const path = body.response_format?.json_schema?.properties?.path?.enum?.[0]
                    || body.messages.at(-1).content.match(/Generate ONLY (\/[^\s]+)\. Its contract:/)?.[1];
                if (!path || !files[path]) throw new Error('Unexpected workspace inventory or out-of-scope request');
                globalThis.__scopedRequests.push(path);
                if (body.stream) return new Response([
                    {choices: [{delta: {content: JSON.stringify({path, lines: files[path].split('\n')})}}]},
                    {choices: [{delta: {}, finish_reason: 'stop'}]},
                ].map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), {headers: {'content-type': 'text/event-stream'}});
                return Response.json({result: {choices: [{message: {content: JSON.stringify({path, lines: files[path].split('\n')})}, finish_reason: 'stop'}]}});
            };
        }, recorded.files);
        const result = await page.evaluate(async ({prompt, files}) => {
            await window.electron.settings.ai.addAssistant({name: 'Scoped test repair', provider: 'cloudflare', purpose: 'coding',
                model: '@cf/test/model', apiKey: 'test-token', accountId: 'a'.repeat(32), defaultThinkingMode: 'off'});
            const assistant = (await window.electron.settings.ai.getAssistants()).find(item => item.name === 'Scoped test repair');
            return window.electron.aiCodingAgent.planCode({requestId: 'scoped-repair', assistantId: assistant.id,
                prompt, workspaceFiles: Object.entries(files).map(([path, content]) => ({path, content}))});
        }, {prompt: buildWorkbenchConvergencePrompt(recorded), files: recorded.files});
        expect(result.success, result.error).toBe(true);
        const expected = workbenchTestRepairPaths(recorded);
        expect(await app.evaluate(() => globalThis.__scopedRequests)).toEqual(expected);
        expect([...result.content.matchAll(/^### File: (.+)$/gm)].map(match => match[1])).toEqual(expected);
        expect(await app.evaluate(() => globalThis.__FDO_E2E_LIVE_AI_BUDGET__.used)).toBe(7);
    } finally { await closeElectronApp(app); }
});
