const {test, expect, _electron: electron} = require('@playwright/test');
const {launchElectronApp, closeElectronApp, openEditorWithMockedIPC} = require('./helpers/electronApp');

test('Markdown preview follows unsaved Monaco edits and preserves undo across view changes', async () => {
    test.setTimeout(90000);
    let app;
    try {
        app = await launchElectronApp(electron, {isolatedUserDataDir:true});
        const editor = await openEditorWithMockedIPC(app);
        await editor.waitForFunction(() => !!window.__editorTestApi?.getState);
        await editor.locator('.monaco-editor').first().click();
        await editor.keyboard.press('ControlOrMeta+N');
        const name = editor.getByPlaceholder('Name', {exact:true});
        await name.fill('preview-fixture.md'); await name.press('Enter');
        await editor.waitForFunction(() => window.__editorTestApi.getState().activeTabId === '/preview-fixture.md');
        await editor.evaluate(() => window.__editorTestApi.createFile('/preview-fixture.md', '# Preview fixture\n\n**Unsaved Markdown**\n\n| Item | Status |\n| --- | --- |\n| Plugin | Ready |', 'markdown'));
        await editor.getByRole('button', {name:'Split', exact:true}).click();
        const preview = editor.getByRole('region', {name:'Markdown preview: /preview-fixture.md'});
        await expect(preview.getByRole('heading', {name:'Preview fixture'})).toBeVisible();
        await expect(preview.getByRole('table')).toBeVisible();
        await expect(editor.locator('.monaco-editor').first()).toBeVisible();
        const tabs = editor.getByRole('tablist', {name:'Open files'});
        const geometry = await tabs.evaluate(element => {
            const row = element.getBoundingClientRect();
            const item = element.querySelector('[aria-selected="true"]').closest('[class*="fileTabItem"]').getBoundingClientRect();
            const breadcrumbs = element.nextElementSibling;
            return {verticalOverflow:element.scrollHeight-element.clientHeight,top:item.top-row.top,bottom:row.bottom-item.bottom,breadcrumbHeight:breadcrumbs.getBoundingClientRect().height,breadcrumbBackground:getComputedStyle(breadcrumbs).backgroundColor};
        });
        expect(geometry.verticalOverflow).toBe(0);
        expect(geometry.top).toBeGreaterThanOrEqual(4);
        expect(geometry.bottom).toBeGreaterThanOrEqual(4);
        expect(geometry.breadcrumbHeight).toBe(28);
        expect(geometry.breadcrumbBackground).toBe('rgb(30, 30, 30)');
        await editor.locator('.monaco-editor').first().click();
        await editor.keyboard.press('ControlOrMeta+End');
        await editor.keyboard.insertText('\n\nLive preview update');
        await expect(preview.getByText('Live preview update')).toBeVisible();
        await editor.screenshot({path:'/tmp/fdo-markdown-split.png'});
        await editor.getByRole('button', {name:'Preview', exact:true}).click();
        await expect(editor.locator('.monaco-editor').first()).toBeHidden();
        await expect(preview.getByText('Live preview update')).toBeVisible();
        await editor.getByRole('button', {name:'Code', exact:true}).click();
        await expect(editor.locator('.monaco-editor').first()).toBeVisible();
        await editor.locator('.monaco-editor').first().click();
        await editor.keyboard.press('ControlOrMeta+Z');
        await expect.poll(() => editor.evaluate(() => window.__editorTestApi.getFileContent('/preview-fixture.md'))).not.toContain('Live preview update');
        await editor.getByRole('button', {name:'Preview', exact:true}).click();
        await expect(preview.getByRole('heading', {name:'Preview fixture'})).toBeVisible();
        await expect(preview.getByText('Live preview update')).toHaveCount(0);

        // Different rendered heights exercise synchronization rather than two
        // coincidentally equal scroll offsets. Use real Monaco wheel scrolling.
        await editor.evaluate(() => window.__editorTestApi.createFile('/preview-fixture.md',
            Array.from({length:100}, (_,i) => `## Section ${i + 1}\n\nA paragraph with **rendered formatting**.\n`).join('\n'), 'markdown'));
        await editor.getByRole('button', {name:'Split', exact:true}).click();
        const code = editor.locator('.monaco-editor').first();
        await code.hover(); await editor.mouse.wheel(0, 1200);
        const previewFraction = () => preview.evaluate(element => element.scrollTop / (element.scrollHeight - element.clientHeight));
        await expect.poll(previewFraction).toBeGreaterThan(0.001);
        await expect.poll(async () => {
            const scroll = await editor.evaluate(() => window.__editorTestApi.getEditorScroll());
            return Math.abs(scroll.top / scroll.range - await previewFraction());
        }).toBeLessThan(0.015);
        await preview.evaluate(element => {element.scrollTop = (element.scrollHeight - element.clientHeight) * 0.75;});
        await expect.poll(async () => {
            const scroll = await editor.evaluate(() => window.__editorTestApi.getEditorScroll());
            return Math.abs(scroll.top / scroll.range - 0.75);
        }).toBeLessThan(0.015);
        // Wait beyond a scroll frame to catch feedback loops or bouncing.
        await editor.waitForTimeout(200);
        expect(await previewFraction()).toBeCloseTo(0.75, 2);

        await editor.evaluate(() => {
            const paths=Array.from({length:12},(_,i)=>`/long-open-file-name-${i}.ts`);
            for(const path of paths)window.__editorTestApi.createFile(path,'export {};');
            window.__editorTestApi.openTabs(paths.map((id,i)=>({id,active:i===11})));
        });
        const scrollbar = editor.getByLabel('Scroll open files', {exact:true});
        await expect(scrollbar).toHaveAttribute('data-overflow','true');
        expect((await scrollbar.boundingBox()).y).toBeLessThan((await tabs.boundingBox()).y);
        await scrollbar.evaluate(element=>{element.scrollLeft=100;});
        await expect.poll(()=>tabs.evaluate(element=>element.scrollLeft)).toBe(100);
        await expect.poll(()=>tabs.evaluate(element=>element.scrollHeight-element.clientHeight)).toBe(0);
        await editor.screenshot({path:'/tmp/fdo-editor-top-tabs-scrollbar.png'});
    } finally {if (app) await closeElectronApp(app);}
});
