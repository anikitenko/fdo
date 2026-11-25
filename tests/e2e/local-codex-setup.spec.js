const {test, expect, _electron: electron} = require('@playwright/test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {launchElectronApp, closeElectronApp} = require('./helpers/electronApp');

test('local Codex setup works without a CLI and imports only the selected skill', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fdo-local-codex-'));
    const directory = path.join(root, 'skills', 'fixture');
    const name = 'fdo-import-fixture';
    let app;
    try {
        await fs.mkdir(directory, {recursive:true});
        await fs.writeFile(path.join(directory, 'SKILL.md'), `---\nname: ${name}\ndescription: Import fixture\n---\nReview this plugin.\n`);
        app = await launchElectronApp(electron, {isolatedUserDataDir:true, env:{CODEX_HOME:root}});
        const page = await app.firstWindow();
        await page.waitForFunction(() => !!window.electron?.settings?.ai);
        await app.evaluate((_electron, root) => {process.env.PATH = root;}, root);
        await expect(page.evaluate(() => window.electron.settings.ai.getAvailableModels('codex-cli'))).rejects.toThrow(/Install Codex CLI/);
        const skill = await page.evaluate(async name => (await window.electron.settings.ai.listLocalCodexSkills()).find(s => s.name === name), name);
        expect(skill.content).toContain('Review this plugin.');
        const result = await page.evaluate(key => window.electron.settings.ai.importLocalCodexSkills([key]), skill.key);
        expect(result.skills).toEqual([expect.objectContaining({name, enabled:false, assistantIds:[]})]);
        if (process.env.FDO_TEST_CODEX_PATH) {
            const models = await page.evaluate(file => window.electron.settings.ai.getAvailableModels('codex-cli', '', undefined, undefined, file), process.env.FDO_TEST_CODEX_PATH);
            expect(models.length).toBeGreaterThan(0);
        }
    } finally {
        if (app) await closeElectronApp(app);
        await fs.rm(root, {recursive:true, force:true});
    }
});
