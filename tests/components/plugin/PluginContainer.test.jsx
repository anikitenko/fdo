import React from "react";
import {act, render, screen, waitFor} from "@testing-library/react";
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

describe("PluginContainer message hardening", () => {
    let uiMessageHandler;
    let renderHandler;
    let runtimeStatusResponses;

    beforeEach(() => {
        uiMessageHandler = null;
        renderHandler = null;
        runtimeStatusResponses = [
            { success: true, statuses: [{ id: "example-plugin", inited: true }] },
        ];
        window.fetch = jest.fn().mockResolvedValue({
            text: jest.fn().mockResolvedValue(`
                <!DOCTYPE html>
                <html>
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
            render: jest.fn().mockResolvedValue(undefined),
            init: jest.fn().mockResolvedValue(undefined),
            getRuntimeStatus: jest.fn(() => Promise.resolve(runtimeStatusResponses.shift() || runtimeStatusResponses[0] || {
                success: true,
                statuses: [{ id: "example-plugin", inited: true }],
            })),
            uiMessage: jest.fn().mockResolvedValue({ ok: true }),
            on: {
                render: jest.fn((handler) => {
                    renderHandler = handler;
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
    });

    test("accepts external-link requests only from the mounted plugin iframe and only for http(s) URLs", async () => {
        const { container } = render(<PluginContainer plugin="example-plugin" />);
        const iframe = container.querySelector("iframe");
        const iframeWindow = {
            postMessage: jest.fn(),
        };

        Object.defineProperty(iframe, "contentWindow", {
            configurable: true,
            value: iframeWindow,
        });

        await waitFor(() => {
            expect(window.electron.plugin.on.uiMessage).toHaveBeenCalled();
        });

        window.dispatchEvent(new MessageEvent("message", {
            data: { type: "OPEN_EXTERNAL_LINK", url: "https://example.com" },
            source: {},
        }));
        expect(window.electron.system.openExternal).not.toHaveBeenCalled();

        window.dispatchEvent(new MessageEvent("message", {
            data: { type: "OPEN_EXTERNAL_LINK", url: "javascript:alert(1)" },
            source: iframeWindow,
        }));
        expect(window.electron.system.openExternal).not.toHaveBeenCalled();

        window.dispatchEvent(new MessageEvent("message", {
            data: { type: "OPEN_EXTERNAL_LINK", url: "https://example.com/docs" },
            source: iframeWindow,
        }));
        expect(window.electron.system.openExternal).toHaveBeenCalledWith("https://example.com/docs");

        uiMessageHandler?.({ id: "other-plugin", content: { ok: false } });
        expect(iframeWindow.postMessage).not.toHaveBeenCalled();

        uiMessageHandler?.({ id: "example-plugin", content: { ok: true } });
        expect(iframeWindow.postMessage).toHaveBeenCalledWith({ type: "UI_MESSAGE", content: { ok: true } }, "*");
    });

    test("registers the render listener before requesting plugin render", async () => {
        const { container } = render(<PluginContainer plugin="example-plugin" />);

        await waitFor(() => {
            expect(window.electron.plugin.render).toHaveBeenCalled();
        });

        expect(window.fetch).toHaveBeenCalledWith("static://host/plugin_host.html");
        expect(container.querySelector("iframe")?.getAttribute("srcdoc")).toContain('src="static://host/plugin_host.test.js"');
        expect(container.querySelector("iframe")?.getAttribute("sandbox")).toBe("allow-scripts");
        expect(window.electron.plugin.on.render.mock.invocationCallOrder[0]).toBeLessThan(
            window.electron.plugin.render.mock.invocationCallOrder[0]
        );
        expect(renderHandler).toEqual(expect.any(Function));
    });

    test("opens the host command bar when the plugin iframe sends the shortcut message", async () => {
        const onRequestCommandBar = jest.fn();
        const { container } = render(<PluginContainer plugin="example-plugin" onRequestCommandBar={onRequestCommandBar} />);
        const iframe = container.querySelector("iframe");
        const iframeWindow = {
            postMessage: jest.fn(),
        };

        Object.defineProperty(iframe, "contentWindow", {
            configurable: true,
            value: iframeWindow,
        });

        await waitFor(() => {
            expect(window.electron.plugin.on.uiMessage).toHaveBeenCalled();
        });

        window.dispatchEvent(new MessageEvent("message", {
            data: { type: "PLUGIN_SHORTCUT", shortcut: "command-bar" },
            source: iframeWindow,
        }));

        expect(onRequestCommandBar).toHaveBeenCalled();
    });

    test("waits for plugin init before requesting render", async () => {
        runtimeStatusResponses = [
            { success: true, statuses: [{ id: "example-plugin", ready: true, inited: false }] },
            { success: true, statuses: [{ id: "example-plugin", inited: true }] },
        ];

        render(<PluginContainer plugin="example-plugin" />);

        await waitFor(() => {
            expect(window.electron.plugin.getRuntimeStatus).toHaveBeenCalled();
        });

        expect(window.electron.plugin.render).not.toHaveBeenCalled();

        await waitFor(() => {
            expect(window.electron.plugin.init).toHaveBeenCalledWith("example-plugin");
        });

        await waitFor(() => {
            expect(window.electron.plugin.render).toHaveBeenCalledWith("example-plugin");
        });
    });

    test("ignores render payloads from other plugins", async () => {
        render(<PluginContainer plugin="example-plugin" />);

        await waitFor(() => {
            expect(window.electron.plugin.render).toHaveBeenCalledWith("example-plugin");
        });

        renderHandler?.({ id: "other-plugin", content: { render: JSON.stringify("<div>wrong</div>"), onLoad: JSON.stringify("null") } });

        renderHandler?.({ id: "example-plugin", content: { render: JSON.stringify("<div>ok</div>"), onLoad: JSON.stringify("null") } });

        await waitFor(() => {
            expect(renderHandler).toEqual(expect.any(Function));
        });
    });

    test("continues runtime-status polling after transient failures and eventually requests render", async () => {
        runtimeStatusResponses = [
            { success: false, statuses: [] },
            { success: true, statuses: [{ id: "example-plugin", inited: true }] },
        ];

        render(<PluginContainer plugin="example-plugin" />);

        await waitFor(() => {
            expect(window.electron.plugin.getRuntimeStatus.mock.calls.length).toBeGreaterThanOrEqual(2);
            expect(window.electron.plugin.render).toHaveBeenCalledWith("example-plugin");
        });
    });

    test("retries render request when first request is not accepted by runtime", async () => {
        jest.useFakeTimers();
        window.electron.plugin.render = jest.fn()
            .mockResolvedValueOnce({ success: false, error: "Plugin is not ready" })
            .mockResolvedValueOnce({ success: true });

        try {
            render(<PluginContainer plugin="example-plugin" />);

            await waitFor(() => {
                expect(window.electron.plugin.render).toHaveBeenCalledTimes(1);
            });

            await act(async () => {
                jest.advanceTimersByTime(1700);
            });

            await waitFor(() => {
                expect(window.electron.plugin.render.mock.calls.length).toBeGreaterThanOrEqual(2);
            });
        } finally {
            jest.useRealTimers();
        }
    });

    test("renders error text with explicit high-contrast colors", async () => {
        render(<PluginContainer plugin="example-plugin" />);

        await waitFor(() => {
            expect(window.electron.plugin.render).toHaveBeenCalledWith("example-plugin");
            expect(renderHandler).toEqual(expect.any(Function));
        });

        act(() => {
            renderHandler?.({ id: "example-plugin", content: null });
        });

        const heading = await screen.findByText("Plugin UI failed to load");
        expect(heading.getAttribute("style")).toContain("color: rgb(31, 41, 51)");
        expect(screen.getByText(/Invalid plugin render payload/i).getAttribute("style"))
            .toContain("color: rgb(57, 75, 89)");
    });

    test("does not route non-privileged backend handler failures into capability-denied flow", async () => {
        window.electron.plugin.uiMessage = jest.fn().mockResolvedValue({
            ok: false,
            code: "PLUGIN_BACKEND_HANDLER_FAILED",
            error: "Simulated backend handler failure",
            correlationId: "corr-handler-failed",
        });
        const onCapabilityDenied = jest.fn();
        const {container} = render(
            <PluginContainer plugin="example-plugin" onCapabilityDenied={onCapabilityDenied}/>
        );
        const iframe = container.querySelector("iframe");
        const iframeWindow = {postMessage: jest.fn()};
        Object.defineProperty(iframe, "contentWindow", {
            configurable: true,
            value: iframeWindow,
        });

        await waitFor(() => {
            expect(window.electron.plugin.on.uiMessage).toHaveBeenCalled();
        });

        act(() => {
            window.dispatchEvent(new MessageEvent("message", {
                data: {
                    type: "UI_MESSAGE_REQUEST",
                    requestId: "req-1",
                    message: {handler: "simulateError", content: {}},
                },
                source: iframeWindow,
            }));
        });

        await waitFor(() => {
            expect(window.electron.plugin.uiMessage).toHaveBeenCalledWith("example-plugin", {
                handler: "simulateError",
                content: {},
            });
            expect(onCapabilityDenied).not.toHaveBeenCalled();
            expect(iframeWindow.postMessage).toHaveBeenCalledWith({
                type: "UI_MESSAGE_RESPONSE",
                requestId: "req-1",
                content: expect.objectContaining({
                    ok: false,
                    code: "PLUGIN_BACKEND_HANDLER_FAILED",
                }),
            }, "*");
        });
    });

    test("routes plugin backend empty responses into dialog flow with explicit remediation", async () => {
        window.electron.plugin.uiMessage = jest.fn().mockResolvedValue({
            ok: false,
            code: "PLUGIN_BACKEND_EMPTY_RESPONSE",
            error: 'Plugin backend handler "systemFile.v1.buildMotdDryRunRequest" returned no response.',
            correlationId: "corr-empty-response",
        });
        const onCapabilityDenied = jest.fn();
        const {container} = render(
            <PluginContainer plugin="example-plugin" onCapabilityDenied={onCapabilityDenied}/>
        );
        const iframe = container.querySelector("iframe");
        const iframeWindow = {postMessage: jest.fn()};
        Object.defineProperty(iframe, "contentWindow", {
            configurable: true,
            value: iframeWindow,
        });

        await waitFor(() => {
            expect(window.electron.plugin.on.uiMessage).toHaveBeenCalled();
        });

        act(() => {
            window.dispatchEvent(new MessageEvent("message", {
                data: {
                    type: "UI_MESSAGE_REQUEST",
                    requestId: "req-empty-response",
                    message: {handler: "systemFile.v1.buildMotdDryRunRequest", content: {}},
                },
                source: iframeWindow,
            }));
        });

        await waitFor(() => {
            expect(onCapabilityDenied).toHaveBeenCalledWith(expect.objectContaining({
                pluginId: "example-plugin",
                code: "PLUGIN_BACKEND_EMPTY_RESPONSE",
                correlationId: "corr-empty-response",
            }));
        });
    });

    test("routes capability-denied failures into capability-denied flow", async () => {
        window.electron.plugin.uiMessage = jest.fn().mockResolvedValue({
            ok: false,
            code: "CAPABILITY_DENIED",
            error: 'Missing capability "system.process.exec"',
            correlationId: "corr-cap-denied",
        });
        const onCapabilityDenied = jest.fn();
        const {container} = render(
            <PluginContainer plugin="example-plugin" onCapabilityDenied={onCapabilityDenied}/>
        );
        const iframe = container.querySelector("iframe");
        const iframeWindow = {postMessage: jest.fn()};
        Object.defineProperty(iframe, "contentWindow", {
            configurable: true,
            value: iframeWindow,
        });

        await waitFor(() => {
            expect(window.electron.plugin.on.uiMessage).toHaveBeenCalled();
        });

        act(() => {
            window.dispatchEvent(new MessageEvent("message", {
                data: {
                    type: "UI_MESSAGE_REQUEST",
                    requestId: "req-2",
                    message: {handler: "terraform.previewPlan", content: {}},
                },
                source: iframeWindow,
            }));
        });

        await waitFor(() => {
            expect(onCapabilityDenied).toHaveBeenCalledWith(expect.objectContaining({
                pluginId: "example-plugin",
                code: "CAPABILITY_DENIED",
                correlationId: "corr-cap-denied",
            }));
        });
    });

    test("routes host privileged-action validation failures into capability dialog flow", async () => {
        window.electron.plugin.uiMessage = jest.fn().mockResolvedValue({
            ok: false,
            code: "VALIDATION_FAILED",
            error: 'Host privileged action "action" must be "system.host.write", "system.fs.mutate", "system.process.exec", "system.workflow.run", "system.clipboard.read", or "system.clipboard.write".',
            correlationId: "corr-validation-failed",
        });
        const onCapabilityDenied = jest.fn();
        const {container} = render(
            <PluginContainer plugin="example-plugin" onCapabilityDenied={onCapabilityDenied}/>
        );
        const iframe = container.querySelector("iframe");
        const iframeWindow = {postMessage: jest.fn()};
        Object.defineProperty(iframe, "contentWindow", {
            configurable: true,
            value: iframeWindow,
        });

        await waitFor(() => {
            expect(window.electron.plugin.on.uiMessage).toHaveBeenCalled();
        });

        act(() => {
            window.dispatchEvent(new MessageEvent("message", {
                data: {
                    type: "UI_MESSAGE_REQUEST",
                    requestId: "req-validation",
                    message: {handler: "system.file.write", content: {}},
                },
                source: iframeWindow,
            }));
        });

        await waitFor(() => {
            expect(onCapabilityDenied).toHaveBeenCalledWith(expect.objectContaining({
                pluginId: "example-plugin",
                code: "VALIDATION_FAILED",
                correlationId: "corr-validation-failed",
            }));
        });
    });

    test("routes privileged handler failures even when response uses success:false shape", async () => {
        window.electron.plugin.uiMessage = jest.fn().mockResolvedValue({
            success: false,
            code: "VALIDATION_FAILED",
            error: 'Host privileged action "action" must be "system.host.write", "system.fs.mutate", "system.process.exec", "system.workflow.run", "system.clipboard.read", or "system.clipboard.write".',
            correlationId: "corr-validation-success-false",
        });
        const onCapabilityDenied = jest.fn();
        const {container} = render(
            <PluginContainer plugin="example-plugin" onCapabilityDenied={onCapabilityDenied}/>
        );
        const iframe = container.querySelector("iframe");
        const iframeWindow = {postMessage: jest.fn()};
        Object.defineProperty(iframe, "contentWindow", {
            configurable: true,
            value: iframeWindow,
        });

        await waitFor(() => {
            expect(window.electron.plugin.on.uiMessage).toHaveBeenCalled();
        });

        act(() => {
            window.dispatchEvent(new MessageEvent("message", {
                data: {
                    type: "UI_MESSAGE_REQUEST",
                    requestId: "req-validation-success-false",
                    message: {handler: "requestPrivilegedAction", content: {}},
                },
                source: iframeWindow,
            }));
        });

        await waitFor(() => {
            expect(onCapabilityDenied).toHaveBeenCalledWith(expect.objectContaining({
                pluginId: "example-plugin",
                code: "VALIDATION_FAILED",
                correlationId: "corr-validation-success-false",
            }));
        });
    });

    test("routes privileged handler bridge exceptions into capability dialog flow", async () => {
        window.electron.plugin.uiMessage = jest.fn().mockRejectedValue(
            Object.assign(new Error("IPC bridge rejected privileged request"), {code: "IPC_FAILURE"})
        );
        const onCapabilityDenied = jest.fn();
        const {container} = render(
            <PluginContainer plugin="example-plugin" onCapabilityDenied={onCapabilityDenied}/>
        );
        const iframe = container.querySelector("iframe");
        const iframeWindow = {postMessage: jest.fn()};
        Object.defineProperty(iframe, "contentWindow", {
            configurable: true,
            value: iframeWindow,
        });

        await waitFor(() => {
            expect(window.electron.plugin.on.uiMessage).toHaveBeenCalled();
        });

        act(() => {
            window.dispatchEvent(new MessageEvent("message", {
                data: {
                    type: "UI_MESSAGE_REQUEST",
                    requestId: "req-bridge-reject",
                    message: {handler: "requestPrivilegedAction", content: {}},
                },
                source: iframeWindow,
            }));
        });

        await waitFor(() => {
            expect(onCapabilityDenied).toHaveBeenCalledWith(expect.objectContaining({
                pluginId: "example-plugin",
                code: "IPC_FAILURE",
            }));
        });
    });

    test("surfaces unsupported custom process scopes from the latest privileged audit entry", async () => {
        runtimeStatusResponses = [
            {
                success: true,
                statuses: [{
                    id: "example-plugin",
                    inited: true,
                    lastPrivilegedAudit: {
                        success: false,
                        scope: "internal-runner",
                        command: "/usr/local/bin/internal-runner",
                        args: ["status"],
                        cwd: "/tmp/project",
                        correlationId: "corr-scope-denied",
                        error: {
                            code: "SCOPE_DENIED",
                            message: 'Unknown or unsupported process scope "internal-runner".',
                        },
                    },
                }],
            },
        ];

        const onCapabilityDenied = jest.fn();
        render(<PluginContainer plugin="example-plugin" onCapabilityDenied={onCapabilityDenied}/>);

        await waitFor(() => {
            expect(onCapabilityDenied).toHaveBeenCalledWith(expect.objectContaining({
                pluginId: "example-plugin",
                code: "SCOPE_DENIED",
                correlationId: "corr-scope-denied",
                extraDetails: expect.objectContaining({
                    scope: "internal-runner",
                    command: "/usr/local/bin/internal-runner",
                    cwd: "/tmp/project",
                }),
            }));
        });
    });
});
