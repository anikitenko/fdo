const {test, expect, _electron: electron} = require('@playwright/test');
const {launchElectronApp, closeElectronApp, openEditorWithMockedIPC} = require('./helpers/electronApp');

test('floating assistant preserves its draft, shares the IDE session, and redocks on window close', async ({}, testInfo) => {
    const app = await launchElectronApp(electron, {isolatedUserDataDir: true});
    try {
        await app.evaluate(() => {
            globalThis.fetch = async url => {
                const address = String(url);
                if (address.endsWith('/models/fixture-model')) return Response.json({id: 'fixture-model'});
                if (address.endsWith('/models')) return Response.json({data: [{id: 'fixture-model'}]});
                throw new Error('Unexpected network request in window-lifecycle fixture.');
            };
        });
        await (await app.firstWindow()).evaluate(() => window.electron.settings.ai.addAssistant({name: 'Window fixture', provider: 'openai', model: 'fixture-model', purpose: 'coding', apiKey: 'fixture'}));
        const editor = await openEditorWithMockedIPC(app, {__useRealAssistants: true});
        await editor.waitForFunction(() => typeof window.__editorTestApi?.getState === 'function');
        await editor.getByRole('tab', {name: /AI Coding Agent/}).click();
        const prompt = editor.locator('#prompt-input');
        await expect(prompt).toBeVisible();
        await prompt.fill('Keep this current request draft.');
        const ownerId = await app.evaluate(({BrowserWindow}, url) =>
            BrowserWindow.getAllWindows().find(window => window.webContents.getURL() === url)?.id, editor.url());
        await app.evaluate(({BrowserWindow}) => {
            globalThis.__assistantPreloadErrors = [];
            for (const owner of BrowserWindow.getAllWindows()) owner.webContents.on('did-create-window', child => {
                child.webContents.on('preload-error', (_event, _path, error) => globalThis.__assistantPreloadErrors.push(error.message));
            });
        });
        const newWindow = app.waitForEvent('window');
        await editor.getByRole('button', {name: 'Open assistant window'}).click();
        const assistant = await newWindow;
        await expect(assistant.getByRole('button', {name: 'Return to editor'})).toBeVisible();
        await expect(assistant.getByRole('button', {name: 'Review workspace', exact: true})).toBeVisible();
        await expect(assistant.getByRole('button', {name: 'Review & repair', exact: true})).toBeVisible();
        expect(await assistant.evaluate(() => typeof window.electron)).toBe('undefined');
        await assistant.getByRole('button', {name: 'Show IDE'}).click();
        await expect.poll(() => app.evaluate(({BrowserWindow}, ownerId) => {
            const companion = BrowserWindow.getAllWindows().find(window => window.webContents.getURL() === 'about:blank');
            return !companion?.getParentWindow() && BrowserWindow.getFocusedWindow()?.id === ownerId;
        }, ownerId)).toBe(true);
        expect(await app.evaluate(() => globalThis.__assistantPreloadErrors)).toEqual([]);
        // Show IDE now truly puts the independent assistant behind the editor.
        // Bring it forward again before inspecting its visible controls.
        await editor.getByRole('button', {name: 'Show assistant window'}).click();
        await expect(assistant.locator('#prompt-input')).toHaveValue('Keep this current request draft.');
        await expect(assistant.getByRole('button', {name: 'Submit', exact: true})).toBeInViewport();
        expect(await assistant.getByText('Smart Mode guidance', {exact: true}).evaluate(summary => summary.parentElement.open)).toBe(false);
        await assistant.getByRole('button', {name: 'Reset workspace conversation'}).click();
        await expect(assistant.getByRole('alertdialog')).toBeVisible();
        expect(await editor.getByRole('alertdialog').count()).toBe(0);
        await assistant.getByRole('button', {name: 'Cancel', exact: true}).click();
        await expect(assistant.locator('.bp6-alert')).toHaveCount(0);
        await assistant.screenshot({path: testInfo.outputPath('assistant-window.png')});
        await assistant.locator('#prompt-input').fill('Edited in the floating window.');
        // The source editor stays in its existing renderer and does not acquire
        // a second assistant instance or a duplicate prompt field.
        expect(await editor.locator('#prompt-input').count()).toBe(0);
        await expect(editor.getByRole('button', {name: 'Show assistant window'})).toBeVisible();
        await assistant.getByRole('button', {name: 'Return to editor'}).click();
        await expect(prompt).toHaveValue('Edited in the floating window.');
        const secondWindow = app.waitForEvent('window');
        await editor.getByRole('button', {name: 'Open assistant window'}).click();
        const reopened = await secondWindow;
        await expect(reopened.locator('#prompt-input')).toHaveValue('Edited in the floating window.');
        await app.evaluate(({BrowserWindow}) => {
            const child = BrowserWindow.getAllWindows().find(window => window.webContents.getURL() === 'about:blank');
            child.close();
        });
        await expect(prompt).toHaveValue('Edited in the floating window.');
        // Keep a real IPC request open while moving the assistant back to its
        // tab. Only HTTP is simulated; the SDK, events and request state are real.
        await app.evaluate(() => {
            globalThis.__assistantWindowRequests = 0;
            const metadataFetch = globalThis.fetch;
            globalThis.fetch = async (url, init) => {
                if (!String(url).endsWith('/responses')) return metadataFetch(url, init);
                globalThis.__assistantWindowRequests += 1;
                return new Response(new ReadableStream({start(controller) {globalThis.__assistantWindowStream = controller;}}),
                    {headers: {'content-type': 'text/event-stream'}});
            };
        });
        const thirdWindow = app.waitForEvent('window');
        await editor.getByRole('button', {name: 'Open assistant window'}).click();
        const working = await thirdWindow;
        await working.getByLabel('Action', {exact: true}).selectOption('explain');
        await working.locator('#prompt-input').fill('Explain this plugin.');
        await working.getByRole('button', {name: 'Submit', exact: true}).click();
        await expect.poll(() => app.evaluate(() => globalThis.__assistantWindowRequests)).toBe(1);
        await expect(working.getByTestId('ai-coding-request-progress')).toBeVisible();
        await expect(working.getByTestId('ai-coding-request-progress')).toBeInViewport();
        await working.getByRole('button', {name: 'Return to editor'}).click();
        await expect(editor.getByRole('button', {name: 'Stop', exact: true})).toBeVisible();
        await app.evaluate(() => {
            const text = 'Fixture response survived moving the assistant.';
            const events = [{type: 'response.output_text.delta', delta: text}, {type: 'response.completed', response: {
                status: 'completed', output: [{type: 'message', content: [{type: 'output_text', text}]}],
                usage: {input_tokens: 1, output_tokens: 1, total_tokens: 2},
            }}];
            const stream = globalThis.__assistantWindowStream;
            stream.enqueue(new TextEncoder().encode(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('')));
            stream.close();
        });
        await expect(editor.getByTestId('ai-coding-response')).toContainText('Fixture response survived moving the assistant.');
        expect(await app.evaluate(() => globalThis.__assistantWindowRequests)).toBe(1);
    } finally {await closeElectronApp(app);}
});
