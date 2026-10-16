const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {createRequire} = require('node:module');
const Conf = createRequire(require.resolve('electron-store'))('conf').default;
const {_electron: electron} = require('@playwright/test');
const {launchElectronApp, closeElectronApp} = require('../tests/e2e/helpers/electronApp');

async function main() {
    delete process.env.CI;
    const output = path.resolve(process.argv[2] || 'artifacts/desktop-performance/chat-storage.json');
    const report = {generatedAt: new Date().toISOString(), notes: [
        'Synthetic isolated profiles; no provider requests; eager migration runs during app startup.',
        'Seven warm samples per operation, measured inside the renderer across real IPC.',
    ], scenarios: []};
    let app;
    const profiles = [];
    try {
        for (const count of [1, 20, 100]) {
            const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fdo-chat-performance-'));
            profiles.push(profile);
            const store = new Conf({cwd: profile, configName: 'settings', encryptionKey: 'FDO-APPLICATION'});
            const now = new Date().toISOString();
            store.set('ai.sessions', Array.from({length: count}, (_, i) => ({id: `session-${i}`, name: `Session ${i}`,
                createdAt: now, updatedAt: now, messages: Array.from({length: 20}, (_, j) => ({id: `message-${j}`,
                    role: j % 2 ? 'assistant' : 'user', content: 'Synthetic message content. '.repeat(40), createdAt: now}))})));
            const scenario = {sessions: count, messagesPerSession: 20, settingsBytesBefore: fs.statSync(store.path).size};
            report.scenarios.push(scenario);
            const start = performance.now();
            app = await launchElectronApp(electron, {isolatedUserDataDir: true, env: {FDO_E2E_USER_DATA_DIR: profile}});
            scenario.launchMs = performance.now() - start;
            const page = await app.firstWindow();
            await page.waitForFunction(() => !!window.__homeTestApi);
            report.runtime = await app.evaluate(() => ({node: process.versions.node, electron: process.versions.electron}));
            Object.assign(scenario, await page.evaluate(async count => {
                const start = performance.now();
                const api = window.electron.aiChat;
                const list = () => api.listSessions ? api.listSessions() : api.getSessions();
                const sessions = await list();
                if (sessions.length !== count) throw new Error('Unexpected chat fixture count');
                const firstReadMs = performance.now() - start;
                const measure = async operation => {
                    const samples = [];
                    for (let i = 0; i < 7; i++) {
                        const start = performance.now();
                        await operation(i);
                        samples.push(performance.now() - start);
                    }
                    return samples;
                };
                return {firstReadMs,
                    listPayloadBytes: new TextEncoder().encode(JSON.stringify(sessions)).byteLength,
                    listSessionsMs: await measure(list),
                    selectSessionMs: await measure(async () => api.getSession ? api.getSession('session-0') : (await api.getSessions()).find(item => item.id === 'session-0')),
                    renameSessionMs: await measure(i => window.electron.aiChat.renameSession('session-0', `Renamed ${i}`)),
                    readPreferencesMs: await measure(() => window.electron.aiChat.getPreferences()),
                };
            }, count));
            scenario.settingsBytesAfter = fs.statSync(store.path).size;
            scenario.backend = fs.existsSync(path.join(profile, 'chat-history.sqlite')) ? 'sqlite' : 'json';
            console.log(JSON.stringify(scenario));
            await closeElectronApp(app);
            app = null;
        }
        report.status = 'complete';
    } catch (error) { report.status = 'failed'; report.error = error.stack; throw error; }
    finally {
        await closeElectronApp(app);
        for (const profile of profiles) fs.rmSync(profile, {recursive: true, force: true});
        fs.mkdirSync(path.dirname(output), {recursive: true});
        fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    }
}
main().catch(error => {console.error(error); process.exitCode = 1;});
