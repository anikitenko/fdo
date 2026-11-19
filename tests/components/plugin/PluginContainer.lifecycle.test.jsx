import React from "react";
import {act, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {PluginContainer} from "../../../src/components/PluginContainer.jsx";

jest.mock("../../../src/components/plugin/utils/useBabelWorker", () => ({
    useBabelWorker: () => ({
        transform: jest.fn(async (code) => code),
    }),
}));

jest.mock("../../../src/components/AppToaster.jsx", () => ({
    AppToaster: {
        show: jest.fn(),
    },
}));

describe("PluginContainer state preservation", () => {
    let uiMessageHandler;
    let renderHandler;
    let runtimeStatusResponses;
    let replaceNextRender;

    beforeEach(() => {
        replaceNextRender = false;
        uiMessageHandler = null;
        renderHandler = null;
        runtimeStatusResponses = [
            { success: true, statuses: [{ id: "example-plugin", inited: true }] },
        ];
        window.fetch = jest.fn().mockResolvedValue({
            text: jest.fn().mockResolvedValue(/* language=TEXT */ `
                <!DOCTYPE html>
                <html lang="en">
                    <head>
                        <script defer src="./plugin_host.test.js"></script>
                    </head>
                    <body>
                        <div id="plugin-root"></div>
                    </body>
                </html>
            `),
        });
        window.electron.plugin = {
            render: jest.fn(async (_id, options) => {replaceNextRender = options?.replace === true;return {success: true};}),
            init: jest.fn().mockResolvedValue(undefined),
            getRuntimeStatus: jest.fn(() => Promise.resolve(runtimeStatusResponses.shift() || runtimeStatusResponses[0] || {
                success: true,
                statuses: [{ id: "example-plugin", inited: true }],
            })),
            uiMessage: jest.fn().mockResolvedValue({ ok: true }),
            on: {
                render: jest.fn((handler) => {
                    renderHandler = payload => {handler({...payload, renderRequest: {replace: replaceNextRender}});replaceNextRender = false;};
                }),
                uiMessage: jest.fn((handler) => {
                    uiMessageHandler = handler;
                }),
            },
            off: {
                render: jest.fn(),
                uiMessage: jest.fn(),
            },
        };

        window.electron.system.openExternal = jest.fn();
        window.electron.plugin.recordUiLifecycle = jest.fn(async () => ({success: true}));
    });

    const payload = label => ({id: 'example-plugin', content: {html: `<input value="default"/><p>${label}</p>`}});
    const send = (frame, data) => window.dispatchEvent(new MessageEvent('message', {source: frame.contentWindow, data}));
    const layout = {docElRect: {width: 800, height: 600}, bodyRect: {width: 800, height: 600}, rootRect: {width: 800, height: 600}};
    async function mountedView({acknowledge = true} = {}) {
        const view = render(<PluginContainer plugin="example-plugin"/>);
        await waitFor(() => expect(window.electron.plugin.render).toHaveBeenCalledTimes(1));
        const frame = view.container.querySelector('iframe');
        const post = jest.spyOn(frame.contentWindow, 'postMessage');
        act(() => {
            fireEvent.load(frame);
            send(frame, {type: 'PLUGIN_HELLO', documentId: 'document-one'});
            send(frame, {type: 'PLUGIN_LAYOUT_READY', documentId: 'document-one', layout});
            renderHandler(payload('original'));
        });
        if (acknowledge) act(() => send(frame, {type: 'PLUGIN_STAGE', documentId: 'document-one', stage: 'iframe-component-mounted'}));
        const input = frame.contentDocument.createElement('input');
        input.value = 'temporary user setting';
        frame.contentDocument.body.appendChild(input);
        return {...view, frame, input, post, renders: () => post.mock.calls.filter(([message]) => message.type === 'PLUGIN_RENDER')};
    }

    test('duplicate greetings preserve the document, input, mount status and render count', async () => {
        const view = await mountedView();
        act(() => {send(view.frame, {type: 'PLUGIN_HELLO', documentId: 'document-one'});});
        expect(view.renders()).toHaveLength(1);
        expect(view.input.isConnected).toBe(true);
        expect(view.input.value).toBe('temporary user setting');
        expect(view.container.querySelector('iframe')).toBe(view.frame);
    });

    test('background updates are deferred and applying the latest update is explicit', async () => {
        const view = await mountedView();
        act(() => {renderHandler(payload('first update')); renderHandler(payload('latest update'));});
        expect(view.renders()).toHaveLength(1);
        expect(view.input.value).toBe('temporary user setting');
        fireEvent.click(screen.getByRole('button', {name: 'Open updated view'}));
        expect(view.renders()).toHaveLength(2);
        expect(view.renders()[1][0].content.code).toContain('latest update');
        expect(window.electron.plugin.recordUiLifecycle).toHaveBeenCalledWith('example-plugin', expect.objectContaining({event: 'render-replaced', reason: 'user_opened_update'}));
    });

    test('keeping the current view suppresses identical offers but allows a later different update', async () => {
        const view = await mountedView();
        act(() => renderHandler(payload('update')));
        fireEvent.click(screen.getByRole('button', {name: 'Keep current view'}));
        act(() => renderHandler(payload('update')));
        expect(screen.queryByRole('button', {name: 'Open updated view'})).not.toBeInTheDocument();
        act(() => renderHandler(payload('another update')));
        expect(screen.getByRole('button', {name: 'Open updated view'})).toBeInTheDocument();
        expect(view.renders()).toHaveLength(1);
    });

    test('explicit navigation permits one replacement; later background updates remain deferred', async () => {
        const {requestPluginUiRender} = require('../../../src/utils/plugins/runtime/pluginUiLifecycle');
        const view = await mountedView();
        await act(async () => {await requestPluginUiRender('example-plugin', {replace: true});});
        act(() => renderHandler(payload('navigation')));
        expect(view.renders()).toHaveLength(2);
        act(() => renderHandler(payload('background')));
        expect(view.renders()).toHaveLength(2);
        expect(screen.getByRole('button', {name: 'Open updated view'})).toBeInTheDocument();
    });

    test('a rejected navigation render cannot authorize a later background replacement', async () => {
        const {requestPluginUiRender} = require('../../../src/utils/plugins/runtime/pluginUiLifecycle');
        const view = await mountedView();
        window.electron.plugin.render.mockResolvedValue({success: false});
        await act(async () => {await requestPluginUiRender('example-plugin', {replace: true});});
        act(() => renderHandler(payload('background')));
        expect(view.renders()).toHaveLength(1);
        expect(screen.getByRole('button', {name: 'Open updated view'})).toBeInTheDocument();
    });

    test('mount recovery never automatically destroys a previously mounted interface', async () => {
        const {requestPluginUiRender} = require('../../../src/utils/plugins/runtime/pluginUiLifecycle');
        const view = await mountedView();
        jest.useFakeTimers();
        try {
            await act(async () => {await requestPluginUiRender('example-plugin', {replace: true});});
            act(() => renderHandler(payload('slow navigation')));
            await act(async () => {jest.advanceTimersByTime(6000);});
            expect(view.container.querySelector('iframe')).toBe(view.frame);
            expect(screen.getByText('Plugin UI failed to load')).toBeInTheDocument();
            expect(window.electron.plugin.recordUiLifecycle).toHaveBeenCalledWith('example-plugin', expect.objectContaining({event: 'recovery-blocked', reason: 'component_mount_missing'}));
        } finally {jest.useRealTimers();}
    });

    test('an interactive first view is protected even when its mount acknowledgement never arrives', async () => {
        jest.useFakeTimers();
        try {
            const view = await mountedView({acknowledge: false});
            act(() => renderHandler(payload('unexpected update before acknowledgement')));
            expect(screen.getByRole('button', {name: 'Open updated view'})).toBeInTheDocument();
            expect(view.renders()).toHaveLength(1);
            await act(async () => {jest.advanceTimersByTime(6000);});
            expect(view.container.querySelector('iframe')).toBe(view.frame);
            expect(view.input.value).toBe('temporary user setting');
        } finally {jest.useRealTimers();}
    });

    test('old document greetings and stages cannot replay or mark the replacement document mounted', async () => {
        const view = await mountedView();
        act(() => {
            fireEvent.load(view.frame);
            send(view.frame, {type: 'PLUGIN_HELLO', documentId: 'document-two'});
            send(view.frame, {type: 'PLUGIN_LAYOUT_READY', documentId: 'document-two', layout});
        });
        expect(view.renders()).toHaveLength(2);
        act(() => {
            send(view.frame, {type: 'PLUGIN_HELLO', documentId: 'document-one'});
            send(view.frame, {type: 'PLUGIN_LAYOUT_READY', documentId: 'document-one', layout});
            send(view.frame, {type: 'PLUGIN_STAGE', documentId: 'document-one', stage: 'iframe-render-crashed', message: 'stale error'});
        });
        expect(view.renders()).toHaveLength(2);
        expect(screen.queryByText('stale error')).not.toBeInTheDocument();
    });
});
