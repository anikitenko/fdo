const {test, expect, _electron: electron} = require('@playwright/test');
const {launchElectronApp, closeElectronApp} = require('./helpers/electronApp');
const recorded = require('../fixtures/ai/workspace-global-sdk-dom.json');

test('recorded global DOM shim is corrected before acceptance and renders with SDK style maps', async () => {
    const app = await launchElectronApp(electron, {reviewedWorkspaceFixture: true, isolatedUserDataDir: true,
        env: {FDO_E2E_LIVE_AI: '1', FDO_TEST_AI_MAX_REQUESTS: '1'}});
    try {
        const page = await app.firstWindow();
        const keys = ['shell', 'dashboard', 'card', 'library', 'workspace', 'result', 'dock'];
        const files = {
            '/package.json': JSON.stringify({name: 'sdk-dom-replay', version: '1.0.0', dependencies: {}}),
            '/render.tsx': recorded.content,
            '/styles.css': keys.map(key => `.${key} { color: red; }`).join('\n'),
            '/ui/dashboard.ts': `export interface WorkbenchState {jsonOpen: boolean; libraryOpen: boolean; spaceOpen: boolean}
export interface WorkbenchRenderArgs {${keys.map(key => `${key}Class: string;`).join('')}}
export function renderWorkbenchShell(_state: WorkbenchState, args: WorkbenchRenderArgs) {
return '<main data-role="tool-workbench" class="' + args.shellClass + '">' + Object.values(args).join(' ') + '</main>';
}`,
            '/render.test.ts': String.raw`import {test} from 'node:test'; import assert from 'node:assert/strict';
import {composeRender} from './render';
test('styles and renderer survive SDK constructor repair', () => {
 const html = composeRender(); assert.match(html, /data-role="tool-workbench"/);
 assert.doesNotMatch(html, /undefined|\[object Object\]/); assert.match(html, /class="go/);
});`,
        };
        const before = await page.evaluate(latestContent => window.electron.plugin.runTests({latestContent}), files);
        expect(before.success).toBe(false);
        expect(before.output || before.error).toMatch(/DOM.*not a constructor/);
        await app.evaluate((_electron, source) => {
            globalThis.fetch = async (url, init = {}) => {
                if (String(url).includes('/models/search')) return Response.json({success: true,
                    result: [{name: '@cf/test/model', task: {name: 'Text Generation'}}]});
                if (!String(url).endsWith('/run/@cf/test/model')) throw new Error(`Unexpected request: ${url}`);
                const body = JSON.parse(init.body);
                const path = body.response_format?.json_schema?.properties?.path?.enum?.[0]
                    || JSON.stringify(body.messages).match(/Generate ONLY (\/[^\s]+)\. Its contract:/)?.[1];
                if (path !== '/render.tsx') throw new Error('Unexpected inventory request');
                const content = body.response_format ? JSON.stringify({path, lines: source.split('\n')})
                    : `\`\`\`tsx\n${source}\n\`\`\``;
                if (body.stream) return new Response([
                    {choices: [{delta: {content}}]},
                    {choices: [{delta: {}, finish_reason: 'stop'}]},
                ].map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n',
                {headers: {'content-type': 'text/event-stream'}});
                return Response.json({result: {choices: [{message: {content}, finish_reason: 'stop'}]}});
            };
        }, recorded.content);
        const result = await page.evaluate(async files => {
            await window.electron.settings.ai.addAssistant({name: 'SDK DOM repair', provider: 'cloudflare', purpose: 'coding',
                model: '@cf/test/model', apiKey: 'test-token', accountId: 'a'.repeat(32), defaultThinkingMode: 'off'});
            const assistant = (await window.electron.settings.ai.getAssistants()).find(item => item.name === 'SDK DOM repair');
            return window.electron.aiCodingAgent.planCode(window.__withReviewedWorkspace({requestId: 'sdk-dom', assistantId: assistant.id,
                prompt: 'Repair the SDK DOM constructor and style-map argument errors.', repairPaths: ['/render.tsx'],
                workspaceFiles: Object.entries(files).map(([path, content]) => ({path, content}))}));
        }, files);
        expect(result.success, result.error).toBe(true);
        files['/render.tsx'] = result.content.match(/```\w*\n([\s\S]*)\n```/)[1];
        expect(files['/render.tsx']).not.toContain('globalThis');
        expect(files['/render.tsx']).not.toContain('style: string');
        const after = await page.evaluate(latestContent => window.electron.plugin.runTests({latestContent}), files);
        expect(after.success, after.output || after.error).toBe(true);
        expect(after.skipped).toBe(false);
        const built = await page.evaluate(latestContent => window.electron.plugin.build({latestContent}), {
            ...files, '/index.ts': 'export {composeRender} from "./render";',
        });
        expect(built.success, built.error).toBe(true);
        expect(await app.evaluate(() => globalThis.__FDO_E2E_LIVE_AI_BUDGET__.used)).toBe(1);
    } finally { await closeElectronApp(app); }
});
