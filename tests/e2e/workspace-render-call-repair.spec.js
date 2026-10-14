const {test, expect, _electron: electron} = require('@playwright/test');
const {launchElectronApp, closeElectronApp} = require('./helpers/electronApp');
const saved = require('../fixtures/ai/workbench-render-call-errors.json');

for (const unchanged of [false, true]) {
    test(`recorded render call repair ${unchanged ? 'rejects repeated defects' : 'corrects defects before acceptance'}`, async () => {
        const app = await launchElectronApp(electron, {isolatedUserDataDir: true,
            env: {FDO_E2E_LIVE_AI: '1', FDO_TEST_AI_MAX_REQUESTS: '8'}});
        try {
            const page = await app.firstWindow();
            const corrected = 'import { DOM } from "@anikitenko/fdo-sdk";\n' + saved['/render.tsx']
                .replace('  const cardClass = dom.createClassFromStyle(css.card);\n', '')
                .replace('renderDashboard(cardClass)', 'renderDashboard()')
                .replace('renderJsonWorkspace(resultClass)', 'renderJsonWorkspace()');
            await app.evaluate((_electron, {broken, corrected, unchanged}) => {
                globalThis.__renderRepairPrompts = [];
                globalThis.fetch = async (url, init = {}) => {
                    if (String(url).includes('/models/search')) return Response.json({success: true,
                        result: [{name: '@cf/test/model', task: {name: 'Text Generation'}}]});
                    if (!String(url).endsWith('/run/@cf/test/model')) throw new Error(`Unexpected URL ${url}`);
                    const body = JSON.parse(init.body);
                    globalThis.__renderRepairPrompts.push(body.messages.at(-1).content);
                    const source = unchanged || globalThis.__renderRepairPrompts.length === 1 ? broken : corrected;
                    return Response.json({result: {choices: [{message: {content: JSON.stringify({path: '/render.tsx', lines: source.split('\n')})}, finish_reason: 'stop'}]}});
                };
            }, {broken: saved['/render.tsx'], corrected, unchanged});
            const result = await page.evaluate(async workspaceFiles => {
                await window.electron.settings.ai.addAssistant({name: 'Render call repair', provider: 'cloudflare', purpose: 'coding',
                    model: '@cf/test/model', apiKey: 'test-token', accountId: 'a'.repeat(32), defaultThinkingMode: 'off'});
                const assistant = (await window.electron.settings.ai.getAssistants()).find(item => item.name === 'Render call repair');
                return window.electron.aiCodingAgent.planCode({requestId: 'render-call-repair', assistantId: assistant.id,
                    prompt: 'Correct the missing DOM import and zero-argument renderer call errors in /render.tsx. Preserve existing dependencies.',
                    repairPaths: ['/render.tsx'], workspaceFiles});
            }, [...Object.entries(saved).map(([path, content]) => ({path, content})), {path: '/styles.css', content: '.shell {display: block}'}]);
            const prompts = await app.evaluate(() => globalThis.__renderRepairPrompts);
            expect(prompts[1]).toContain('DOM is not defined');
            expect(prompts[1]).toContain('renderDashboard from /ui/dashboard.ts declares zero parameters');
            expect(prompts[1]).toContain('renderJsonWorkspace from /ui/jsonWorkspace.ts declares zero parameters');
            if (unchanged) {
                expect(result.success).toBe(false);
                expect(result.error).toContain('No changes were applied');
                expect(prompts).toHaveLength(3);
            } else {
                expect(result.success, result.error).toBe(true);
                expect(result.content).toContain(corrected.trim());
                expect([...result.content.matchAll(/^### File: (.+)$/gm)].map(match => match[1])).toEqual(['/render.tsx']);
                expect(prompts).toHaveLength(2);
            }
        } finally { await closeElectronApp(app); }
    });
}
