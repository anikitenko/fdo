const {test, expect, _electron: electron} = require('@playwright/test');
const {launchElectronApp, closeElectronApp} = require('./helpers/electronApp');
const {deploySdkExample, selectPluginOpen} = require('./helpers/sdkExamples');

for (const failFirstChunk of [false, true]) {
test(`injected charts use static chunks through load, update and remount${failFirstChunk ? ' after a failed chunk retry' : ''}`, async () => {
    test.setTimeout(60000);
    let app;
    try {
        app = await launchElectronApp(electron, {isolatedUserDataDir: true});
        const page = await app.firstWindow();
        const scriptUrls = [], loadErrors = [];
        page.on('request', request => {
            if (request.resourceType() === 'script' && /\.js(?:[?#]|$)/.test(request.url()) && request.frame().parentFrame()) scriptUrls.push(request.url());
        });
        page.on('console', message => {
            if (/Not allowed to load local resource|Loading chunk|ChunkLoadError|Evaluating a string as JavaScript violates|Refused to evaluate/.test(message.text())) loadErrors.push(message.text());
        });
        const id = 'chart-runtime-fixture';
        await deploySdkExample(page, {slug: id, relativePath: id}, {pluginName: id, compiledContent: `
const {FDO_SDK, PluginRegistry, defineRenderOnLoad} = require('@anikitenko/fdo-sdk');
class Fixture extends FDO_SDK {
 get metadata(){return {name:'Chart fixture',version:'1.0.0',author:'FDO',description:'Chart runtime',icon:'chart'};}
 init(){}
 render(){return '<main><h1>Charts</h1><button id="load-chart" disabled>Load chart</button><p id="chart-error"></p><div id="charts" style="width:640px"></div></main>';}
 renderOnLoad(){return defineRenderOnLoad(async()=>{
     const config = {type:'area', xKey:'day', data:[{day:'Mon',cost:12},{day:'Tue',cost:24}], series:[{key:'cost',label:'Cost'}], label:'Daily cost'};
     const button = document.getElementById('load-chart');
     let chart;
     const load = async () => {
         try {
             chart = await window.FDOCharts.create(document.getElementById('charts'), config);
             window.chartFixture = chart;
             window.chartConfig = config;
             document.getElementById('chart-error').textContent = '';
         } catch (error) {document.getElementById('chart-error').textContent = String(error.message);}
     };
     button.addEventListener('click', load);
     button.disabled = false;
     return () => {button.removeEventListener('click', load); chart?.dispose();};
 }, {language:'typescript'});}
}
PluginRegistry.registerPlugin(new Fixture());`});
        await page.evaluate(() => {window.__E2E__ = false;});
        await selectPluginOpen(page, id);
        const frame = page.frameLocator(`iframe[data-plugin-id="${id}"]`);
        await expect(frame.getByRole('heading', {name: 'Charts', exact: true})).toBeVisible({timeout: 20000});
        expect(await page.locator(`iframe[data-plugin-id="${id}"]`).getAttribute('sandbox')).toBe('allow-scripts');
        const loadButton = frame.getByRole('button', {name: 'Load chart', exact: true});
        await expect(loadButton).toBeEnabled();
        if (failFirstChunk) {
            // Custom Electron protocols are not intercepted by Playwright routes.
            // Fail one real Webpack script request through the static handler.
            await frame.locator('#charts').evaluate(() => {
                const append = document.head.appendChild;
                document.head.appendChild = function(node) {
                    if (node.tagName === 'SCRIPT' && node.src.startsWith('static://host/')) {
                        document.head.appendChild = append;
                        window.rejectedChartUrl = node.src;
                        node.src = 'static://host/__missing_chart_chunk_for_test__.js';
                    }
                    return append.call(this, node);
                };
            });
            await loadButton.click();
            await expect(frame.locator('#chart-error')).toContainText('Loading chunk');
            expect(await frame.locator('#charts').evaluate(() => window.rejectedChartUrl)).toMatch(/^static:\/\/host\//);
            loadErrors.length = 0;
        }
        const initialScriptCount = scriptUrls.length;
        await loadButton.click();
        await expect(frame.getByRole('figure', {name: 'Daily cost'})).toBeVisible();
        await expect(frame.locator('.recharts-area')).toHaveCount(1);
        await expect.poll(() => frame.locator('.recharts-wrapper > svg.recharts-surface').getAttribute('width')).toBe('640');
        await frame.locator('#charts').evaluate(element => {
            element.style.width = '420px';
            window.chartFixture.update({...window.chartConfig, type: 'bar', label: 'Updated cost'});
        });
        await expect(frame.getByRole('figure', {name: 'Updated cost'})).toBeVisible();
        await expect(frame.locator('.recharts-bar')).toHaveCount(1);
        await expect.poll(() => frame.locator('.recharts-wrapper > svg.recharts-surface').getAttribute('width')).toBe('420');
        for (const type of ['line', 'pie']) {
            await frame.locator('#charts').evaluate((_element, type) => window.chartFixture.update({...window.chartConfig, type}), type);
            await expect(frame.locator(`.recharts-${type}`)).toHaveCount(1);
            if (type === 'pie') {
                await expect(frame.locator('.recharts-pie-sector path')).toHaveCount(2);
                await expect(frame.locator('.recharts-legend-item-text')).toHaveText(['Mon', 'Tue']);
                expect(await frame.locator('.recharts-pie-sector path').evaluateAll(paths => paths.map(path => path.getAttribute('fill'))))
                    .toEqual(['#22b8f0', '#51cf66']);
            }
        }
        await frame.locator('#charts').evaluate(() => window.chartFixture.update({...window.chartConfig, data: []}));
        await expect(frame.getByRole('status')).toHaveText('No chart data available.');
        await frame.locator('#charts').evaluate(() => window.chartFixture.dispose());
        await expect(frame.locator('#charts')).toBeEmpty();
        expect(scriptUrls.length).toBeGreaterThan(initialScriptCount);
        expect(scriptUrls.slice(initialScriptCount).every(url => url.startsWith('static://host/'))).toBe(true);
        expect(scriptUrls.filter(url => !/^static:\/\/(host|assets)\//.test(url))).toEqual([]);
        await page.reload();
        await selectPluginOpen(page, id);
        await expect(loadButton).toBeEnabled();
        await loadButton.click();
        await expect(frame.getByRole('figure', {name: 'Daily cost'})).toBeVisible();
        await expect(frame.locator('.recharts-area')).toHaveCount(1);
        expect(scriptUrls.filter(url => !/^static:\/\/(host|assets)\//.test(url))).toEqual([]);
        expect(loadErrors).toEqual([]);

    } finally {if (app) await closeElectronApp(app);}
});

}
