// Uses synthetic data and a disposable Electron profile; never calls an AI provider.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const {_electron: electron} = require('@playwright/test');
const {launchElectronApp, closeElectronApp} = require('../tests/e2e/helpers/electronApp');

async function main() {
    // The shared launcher enables expensive trace snapshots in CI. They would
    // distort this measurement; this process is a diagnostic, not a CI test.
    delete process.env.CI;
    const rendererHtml = fs.readFileSync(path.resolve('dist/renderer/index.html'), 'utf8');
    const rendererBundles = [...rendererHtml.matchAll(/<script\b[^>]*\bsrc=(?:"([^"]+)"|'([^']+)'|([^\s>]+))/g)]
        .map(match => match[1] || match[2] || match[3]).filter(name => !name.includes('://'));
    assert.ok(rendererBundles.length, 'No local renderer bundles found; build FDO before profiling');
    for (const bundle of rendererBundles) {
        const source = fs.readFileSync(path.resolve('dist/renderer', bundle), 'utf8');
        assert.ok(!source.slice(0, 500).includes('ATTENTION: The "eval" devtool'), 'Build a production renderer before profiling (npm run build:renderer)');
    }
    const output = path.resolve(process.argv[2] || 'artifacts/desktop-performance/baseline.json');
    // External dependencies resolve from this project's node_modules.
    fs.mkdirSync(path.resolve('node_modules/.cache'), {recursive: true});
    const cache = fs.mkdtempSync(path.resolve('node_modules/.cache/fdo-performance-'));
    const storeModule = path.join(cache, 'store.cjs');
    require('esbuild').buildSync({entryPoints: ['src/utils/persistence/store.js'], outfile: storeModule,
        bundle: true, platform: 'node', format: 'cjs', packages: 'external'});
    const report = {generatedAt: new Date().toISOString(), host: {platform: process.platform,
        arch: process.arch, cpu: os.cpus()[0]?.model, memoryGiB: os.totalmem() / 2 ** 30},
        rendererBundles,
        notes: ['Production dist build; synthetic temporary profile; no Playwright tracing.',
            'The storage section measures the legacy JSON store for comparison; IPC and UI use the live notification backend.',
            'Synthetic JSON chat history is removed after control measurements; current chat history lives in SQLite.',
            'UI timings include React, layout and paint scheduling; they are not React-only timings.',
            'Small sample counts describe a baseline, not statistically reliable tail latency.'], scenarios: []};
    let app;
    try {
        app = await launchElectronApp(electron, {isolatedUserDataDir: true, env: {FDO_E2E_KEEP_USER_DATA: '0'}});
        const page = await app.firstWindow();
        page.setDefaultTimeout(15000);
        await page.bringToFront();
        await page.waitForFunction(() => !!window.__homeTestApi?.getSearchActionsSnapshot);
        report.runtime = await app.evaluate(() => ({...process.versions}));
        await app.evaluate((_, storeModule) => {
            globalThis.__performanceStore = process.mainModule.require(storeModule).settings;
        }, storeModule);
        await page.getByRole('button', {name: 'Show right sidebar', exact: true}).click();
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Performance.enable');
        await page.evaluate(() => {
            window.__desktopPerf = {longTasks: []};
            const observer = new PerformanceObserver(list => {
                window.__desktopPerf.longTasks.push(...list.getEntries().map(entry => ({start: entry.startTime, ms: entry.duration})));
            });
            observer.observe({type: 'longtask'});
            window.__desktopPerf.observer = observer;
        });

        for (const {notifications, sessions} of [
            {notifications: 10, sessions: 0}, {notifications: 250, sessions: 0},
            {notifications: 1000, sessions: 0}, {notifications: 10, sessions: 100},
        ]) {
            const scenario = {notifications, sessions};
            report.scenarios.push(scenario);
            scenario.storage = await app.evaluate(async (_, {notifications, sessions, repositoryPath}) => {
                const store = globalThis.__performanceStore;
                const now = new Date().toISOString();
                store.set('notifications', Array.from({length: notifications}, (_, i) => ({
                    id: `perf-${i}`, title: `Performance notification ${i}`, message: 'Synthetic notification. '.repeat(8),
                    type: '', read: false, createdAt: now, updatedAt: now,
                })));
                store.set('ai.sessions', Array.from({length: sessions}, (_, i) => ({
                    id: `session-${i}`, name: `Synthetic session ${i}`, createdAt: now,
                    messages: Array.from({length: 20}, (_, j) => ({id: `message-${j}`, role: j % 2 ? 'assistant' : 'user',
                        content: 'Synthetic message content. '.repeat(40), createdAt: now})),
                })));
                const measure = operation => {
                    operation(); // Warm up separately from the samples.
                    return Array.from({length: 15}, () => {const start = performance.now(); operation(); return performance.now() - start;});
                };
                const result = {
                    fileBytes: process.mainModule.require('node:fs').statSync(store.path).size,
                    readPreferenceMs: measure(() => store.get('ai.options.chatStreamingDefault')),
                    readNotificationsMs: measure(() => store.get('notifications')),
                    updateOneNotificationMs: measure(() => {
                        const items = store.get('notifications');
                        items[0].read = !items[0].read;
                        store.set('notifications', items);
                    }),
                };
                store.delete('ai.sessions');
                // Seed the SQLite fixture through the production repository,
                // outside the measured interval and without UI broadcasts.
                const {openNotificationDatabase} = process.mainModule.require(repositoryPath);
                const database = openNotificationDatabase(process.mainModule.require('node:path').join(
                    process.mainModule.require('node:path').dirname(store.path), 'notifications.sqlite'));
                try {
                    database.execute('deleteAll', undefined, false);
                    for (const item of store.get('notifications')) database.execute('add', item, false);
                } finally { database.close(); }
                await new Promise(resolve => setTimeout(resolve, 100));
                return result;
            }, {notifications, sessions, repositoryPath: path.resolve('src/utils/persistence/notificationDatabase.cjs')});
            // Refresh the real application's UI through its normal broadcast path.
            await page.evaluate(() => window.electron.notifications.markAsRead('perf-0'));
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            scenario.ipcGetNotificationsMs = await page.evaluate(async () => {
                const samples = [];
                for (let i = 0; i < 10; i++) {
                    const start = performance.now();
                    await window.electron.notifications.get();
                    samples.push(performance.now() - start);
                }
                return samples;
            });
            const before = await cdp.send('Performance.getMetrics');
            if (process.env.FDO_PERF_CPU === '1') {
                await cdp.send('Profiler.enable');
                await cdp.send('Profiler.start');
            }
            const uiStart = await page.evaluate(() => performance.now());
            // Measure click-to-next-paint inside the renderer, excluding automation round trips.
            await page.evaluate(() => {
                window.__desktopPerf.openMs = null;
                document.addEventListener('click', () => {
                    const start = performance.now();
                    const check = () => {
                        if (document.querySelector('.bp6-drawer .bp6-callout')) {
                            requestAnimationFrame(() => requestAnimationFrame(() => {window.__desktopPerf.openMs = performance.now() - start;}));
                        } else requestAnimationFrame(check);
                    };
                    requestAnimationFrame(check);
                }, {once: true, capture: true});
            });
            // Open through the existing sidebar Notifications action.
            await page.getByRole('button', {name: 'Notifications', exact: true}).click();
            await page.waitForFunction(() => window.__desktopPerf.openMs !== null);
            scenario.openPanelToPaintMs = await page.evaluate(() => window.__desktopPerf.openMs);
            scenario.renderedNotifications = await page.locator('.bp6-drawer .bp6-callout').count();
            assert.ok(scenario.renderedNotifications > 0 && scenario.renderedNotifications <= Math.min(50, notifications),
                'Notification viewport must render a bounded row count');
            scenario.markReadIpcAndPaintMs = await page.evaluate(async () => {
                const start = performance.now();
                await window.electron.notifications.markAsRead('perf-1');
                await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                return performance.now() - start;
            });
            const after = await cdp.send('Performance.getMetrics');
            if (process.env.FDO_PERF_CPU === '1') {
                const {profile} = await cdp.send('Profiler.stop');
                fs.mkdirSync(path.dirname(output), {recursive: true});
                fs.writeFileSync(output.replace(/\.json$/, '') + `-${notifications}-${sessions}.cpuprofile`, JSON.stringify(profile));
            }
            const metric = (sample, name) => sample.metrics.find(item => item.name === name)?.value || 0;
            scenario.renderer = Object.fromEntries(['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration']
                .map(name => [name + 'Ms', (metric(after, name) - metric(before, name)) * 1000]));
            scenario.longTasks = await page.evaluate(since => window.__desktopPerf.longTasks.filter(task => task.start >= since), uiStart);
            if (notifications > 50) {
                await page.waitForFunction(count => {
                    const list = document.querySelector('[role="list"][aria-label="Notifications"]');
                    list.scrollTop = list.scrollHeight;
                    return !!list.querySelector(`[aria-posinset="${count}"]`);
                }, notifications);
                await page.getByRole('list', {name: 'Notifications'}).evaluate(list => {list.scrollTop = 0;});
                await page.locator('[role="listitem"][aria-posinset="1"]').waitFor();
            }
            if (notifications === 1000) {
                await page.screenshot({path: output.replace(/\.json$/, '') + '-notifications.png'});
            }
            await page.getByRole('button', {name: 'Close', exact: true}).click();
            await page.locator('.bp6-drawer').waitFor({state: 'hidden'});
            console.log(JSON.stringify({notifications, sessions, openMs: scenario.openPanelToPaintMs,
                markReadMs: scenario.markReadIpcAndPaintMs, longTasks: scenario.longTasks.length}));
        }
        report.status = 'complete';
    } catch (error) {
        report.status = 'failed';
        report.error = error.stack || String(error);
        throw error;
    } finally {
        if (app) await closeElectronApp(app);
        fs.mkdirSync(path.dirname(output), {recursive: true});
        fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
        fs.rmSync(cache, {recursive: true, force: true});
        console.log(`Report: ${output}`);
    }
}

main().catch(error => {console.error(error); process.exitCode = 1;});
