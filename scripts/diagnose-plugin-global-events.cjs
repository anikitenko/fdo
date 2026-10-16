// Synthetic plugin and disposable profile; counts callbacks, not app-wide speed.
const fs = require('node:fs');
const path = require('node:path');
const {_electron: electron, expect} = require('@playwright/test');
const {launchElectronApp, closeElectronApp} = require('../tests/e2e/helpers/electronApp');
const {deploySdkExample, selectPluginOpen, removePlugin} = require('../tests/e2e/helpers/sdkExamples');

async function main() {
    delete process.env.CI;
    const output = path.resolve(process.argv[2] || 'artifacts/desktop-performance/plugin-global-events.json');
    const report = {generatedAt: new Date().toISOString(), notes: [
        'Twelve sequential plugin renders. Each view registers one listener using the public helper.',
        'Counts show retained callback work; dispatch duration is synthetic and is not total UI performance.',
    ], samples: []};
    const app = await launchElectronApp(electron, {isolatedUserDataDir: true});
    const id = 'performance-global-events';
    let home;
    try {
        home = await app.firstWindow();
        await deploySdkExample(home, {relativePath: id}, {pluginName: id, compiledContent: `
            const {FDO_SDK} = require('@anikitenko/fdo-sdk');
            class EventsPlugin extends FDO_SDK {
                constructor(){super();this.revision=0;}
                get metadata(){return {name:'Global event performance',version:'1.0.0',author:'FDO',description:'Synthetic view lifecycle',icon:'cube'};}
                init(){}
                render(){return '<main><output>'+(++this.revision)+'</output></main>';}
                renderOnLoad(){return '() => {document.documentElement.dataset.globalSetups=String(Number(document.documentElement.dataset.globalSetups||0)+1); window.addGlobalEventListener("fdo-performance-event", () => {window.__globalCalls=(window.__globalCalls||0)+1;}); document.querySelector("output").dataset.ready=document.querySelector("output").textContent;}';}
            }
            new EventsPlugin();
        `});
        await selectPluginOpen(home, id);
        const root = home.frameLocator(`iframe[data-plugin-id="${id}"]`).locator('main');
        await root.waitFor();
        report.runtime = await app.evaluate(() => ({node: process.versions.node, electron: process.versions.electron}));
        let previous = 0;
        for (let i = 0; i < 12; i++) {
            if (i) await home.evaluate(id => window.electron.plugin.render(id), id);
            await expect.poll(() => root.evaluate(node => Number(node.querySelector('output').dataset.ready || 0))).toBeGreaterThan(previous);
            const sample = await root.evaluate(() => {
                window.__globalCalls = 0;
                const start = performance.now();
                for (let i = 0; i < 100; i++) window.dispatchEvent(new Event('fdo-performance-event'));
                return {revision: Number(document.querySelector('output').dataset.ready), setups: Number(document.documentElement.dataset.globalSetups),
                    dispatches: 100, callbacks: window.__globalCalls, dispatchMs: performance.now() - start};
            });
            previous = sample.revision;
            report.samples.push(sample);
        }
        report.status = 'complete';
        console.log(JSON.stringify(report.samples));
    } catch (error) {report.status = 'failed';report.error = error.stack;throw error;}
    finally {
        if (home && !home.isClosed()) await removePlugin(home, id).catch(() => {});
        await closeElectronApp(app);
        fs.mkdirSync(path.dirname(output), {recursive: true});
        fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    }
}
main().catch(error => {console.error(error);process.exitCode = 1;});
