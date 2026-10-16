// Synthetic plugin in a disposable Electron profile; no external requests.
const fs = require('node:fs');
const path = require('node:path');
const {_electron: electron} = require('@playwright/test');
const {launchElectronApp, closeElectronApp} = require('../tests/e2e/helpers/electronApp');
const {deploySdkExample, selectPluginOpen, removePlugin} = require('../tests/e2e/helpers/sdkExamples');

async function main() {
    delete process.env.CI;
    const output = path.resolve(process.argv[2] || 'artifacts/desktop-performance/plugin-element-waits.json');
    const report = {generatedAt: new Date().toISOString(), notes: [
        'Seven sequential existing-element waits and 100 simultaneous missing-element waits.',
        'Idle query counts exclude initial registration/checks. Timings describe this helper, not total app startup.',
    ]};
    const app = await launchElectronApp(electron, {isolatedUserDataDir: true});
    const id = 'performance-element-waits';
    let home;
    try {
        home = await app.firstWindow();
        await deploySdkExample(home, {relativePath: id}, {pluginName: id, compiledContent: `
            const {FDO_SDK} = require('@anikitenko/fdo-sdk');
            class WaitPlugin extends FDO_SDK {
                get metadata(){return {name:'Element waits',version:'1.0.0',author:'FDO',description:'Synthetic element waits',icon:'cube'};}
                init(){}
                render(){return '<main><div id="already-present">Ready</div><div id="waiting-ground"></div></main>';}
            }
            new WaitPlugin();
        `});
        await selectPluginOpen(home, id);
        const root = home.frameLocator(`iframe[data-plugin-id="${id}"]`).locator('main');
        await root.waitFor();
        report.runtime = await app.evaluate(() => ({node: process.versions.node, electron: process.versions.electron}));
        report.measurements = await root.evaluate(async () => {
            const existingMs = [];
            for (let i = 0; i < 7; i++) {
                const start = performance.now();
                await new Promise(resolve => window.waitForElement('#already-present', resolve));
                existingMs.push(performance.now() - start);
            }
            // Let the host finish its compositor/stylesheet setup before measuring idle work.
            await new Promise(resolve => setTimeout(resolve, 100));
            const query = document.querySelector;
            let queries = 0;
            document.querySelector = function(selector) {
                if (String(selector).startsWith('#perf-wait-')) queries++;
                return query.call(this, selector);
            };
            try {
                const completed = Array.from({length: 100}, (_, i) => new Promise(resolve =>
                    window.waitForElement(`#perf-wait-${i}`, resolve, 3000)));
                await Promise.resolve();
                const registrationQueries = queries;
                await new Promise(resolve => setTimeout(resolve, 350));
                const idleQueries = queries - registrationQueries;
                const fragment = document.createDocumentFragment();
                for (let i = 0; i < 100; i++) {
                    const node = document.createElement('span');node.id = `perf-wait-${i}`;fragment.append(node);
                }
                const start = performance.now();
                document.getElementById('waiting-ground').append(fragment);
                let timeout;
                try {
                    await Promise.race([Promise.all(completed), new Promise((_, reject) => {
                        timeout = setTimeout(() => reject(new Error('Element waits did not complete')), 4000);
                    })]);
                } finally {clearTimeout(timeout);}
                return {existingMs, missingWaiters: 100, idleDurationMs: 350, registrationQueries, idleQueries,
                    insertedElementsToCallbacksMs: performance.now() - start};
            } finally {
                document.querySelector = query;
                document.getElementById('waiting-ground').replaceChildren();
            }
        });
        report.status = 'complete';
        console.log(JSON.stringify(report.measurements));
    } catch (error) {report.status = 'failed'; report.error = error.stack; throw error;}
    finally {
        if (home && !home.isClosed()) await removePlugin(home, id).catch(() => {});
        await closeElectronApp(app);
        fs.mkdirSync(path.dirname(output), {recursive: true});
        fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    }
}
main().catch(error => {console.error(error); process.exitCode = 1;});
