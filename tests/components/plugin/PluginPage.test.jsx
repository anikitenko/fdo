import React from "react";
import {act, render, screen, waitFor} from "@testing-library/react";
import {PluginPage} from "../../../src/components/plugin/PluginPage.jsx";

describe("PluginPage host contract", () => {
    beforeEach(() => {
        jest.restoreAllMocks();
        document.head.innerHTML = "";
        window.fetch = jest.fn(() => Promise.resolve({ok: true}));
        window.Worker = jest.fn();
        window.SharedWorker = jest.fn();
        window.RTCPeerConnection = jest.fn();
        URL.createObjectURL = jest.fn(() => 'blob:missing-plugin-render-fixture');
        URL.revokeObjectURL = jest.fn();
        Object.defineProperty(window.navigator, "sendBeacon", {
            configurable: true,
            writable: true,
            value: jest.fn(() => true),
        });
        window.electron.notifications = {
            add: jest.fn(),
        };
    });

    test("mounts the plugin host page and announces readiness to the parent", () => {
        const postMessageSpy = jest.spyOn(window.parent, "postMessage").mockImplementation(() => {});

        const { container } = render(<PluginPage />);

        expect(postMessageSpy).toHaveBeenCalledWith({ type: "PLUGIN_STAGE", stage: "iframe-listeners-ready", message: "" }, "*");
        expect(postMessageSpy).toHaveBeenCalledWith({ type: "PLUGIN_HELLO" }, "*");
        expect(container.querySelector(".plugin-page-loader")).toBeTruthy();

        postMessageSpy.mockRestore();
    });

    test("installs the request bridge before readiness and releases it on unmount", async () => {
        const previous = window.createBackendReq;
        const postMessageSpy = jest.spyOn(window.parent, "postMessage").mockImplementation((message) => {
            if (message.type === "PLUGIN_HELLO") expect(window.createBackendReq).toEqual(expect.any(Function));
        });
        const {unmount} = render(<PluginPage />);
        const request = window.createBackendReq;
        const unfinished = request("echo", {});
        unmount();
        await expect(unfinished).resolves.toMatchObject({success: false, error: expect.stringContaining("disposed")});
        expect(window.createBackendReq).toBe(previous);
        await expect(request("echo", {})).resolves.toMatchObject({success: false});
        postMessageSpy.mockRestore();
    });

    test("registers the message listener before announcing readiness so a fast parent render message is not missed", async () => {
        URL.createObjectURL.mockImplementation(() => {throw new Error('Fixture module preparation failed');});
        const addEventListenerSpy = jest.spyOn(window, "addEventListener");
        const postMessageSpy = jest.spyOn(window.parent, "postMessage").mockImplementation((message) => {
            if (message?.type === "PLUGIN_HELLO") {
                window.dispatchEvent(new MessageEvent("message", {
                    source: window.parent,
                    data: {
                        type: "PLUGIN_RENDER",
                        content: {
                            code: "\"<div>broken\"",
                            onLoad: "null",
                        },
                    },
                }));
            }
        });

        render(<PluginPage />);

        expect(addEventListenerSpy).toHaveBeenCalledWith("message", expect.any(Function));

        await waitFor(() => {
            expect(postMessageSpy).toHaveBeenCalledWith(
                {type: "PLUGIN_STAGE", stage: "iframe-render-handle-failed", message: 'Fixture module preparation failed'},
                "*",
            );
        });

        expect(screen.getByText('Fixture module preparation failed')).toBeInTheDocument();
        expect(window.electron.notifications.add).not.toHaveBeenCalled();
        expect(postMessageSpy).toHaveBeenCalledWith({ type: "PLUGIN_HELLO" }, "*");
    });

    test("keeps waiting for a cold plugin instead of failing before the parent's initialization deadline", () => {
        jest.useFakeTimers();
        jest.spyOn(window.parent, 'postMessage').mockImplementation(() => {});
        try {
            const {container, unmount} = render(<PluginPage/>);
            act(() => {jest.advanceTimersByTime(6500);});
            expect(container.querySelector('.plugin-page-loader')).toBeInTheDocument();
            expect(screen.queryByText('Plugin failed to load')).not.toBeInTheDocument();
            expect(window.electron.notifications.add).not.toHaveBeenCalled();
            unmount();
        } finally {jest.useRealTimers();}
    });

    test("shows an in-iframe error state when plugin render import fails", async () => {
        const postMessageSpy = jest.spyOn(window.parent, "postMessage").mockImplementation(() => {});

        render(<PluginPage />);

        window.dispatchEvent(new MessageEvent("message", {
            source: window.parent,
            data: {
                type: "PLUGIN_RENDER",
                content: {
                    code: "\"<div>broken\"",
                    onLoad: "null",
                },
            },
        }));

        await waitFor(() => {
            expect(screen.getByText("Plugin failed to load")).toBeTruthy();
        });

        expect(postMessageSpy).toHaveBeenCalledWith(
            expect.objectContaining({type: "PLUGIN_STAGE", stage: "iframe-module-import-failed", message: expect.any(String)}),
            "*",
        );
        const failure = postMessageSpy.mock.calls.find(([message]) => message.stage === 'iframe-module-import-failed')[0];
        expect(screen.getByText(failure.message)).toBeInTheDocument();
        expect(window.electron.notifications.add).not.toHaveBeenCalled();
    });

    test("bridges Cmd/Ctrl+K to the host command bar", () => {
        const postMessageSpy = jest.spyOn(window.parent, "postMessage").mockImplementation(() => {});

        render(<PluginPage />);

        const shortcutEvent = new KeyboardEvent("keydown", {
            key: "k",
            metaKey: true,
            bubbles: true,
            cancelable: true,
        });
        window.dispatchEvent(shortcutEvent);

        expect(postMessageSpy).toHaveBeenCalledWith({ type: "PLUGIN_SHORTCUT", shortcut: "command-bar" }, "*");
        postMessageSpy.mockRestore();
    });

    test("blocks plugin-relative anchor navigation at the host page layer", () => {
        const addEventListenerSpy = jest.spyOn(document, "addEventListener");

        render(<PluginPage />);

        const clickHandler = addEventListenerSpy.mock.calls.find(
            ([eventName, _handler, capture]) => eventName === "click" && capture === true
        )?.[1];
        expect(clickHandler).toEqual(expect.any(Function));

        const preventDefault = jest.fn();
        const anchor = document.createElement("a");
        anchor.setAttribute("href", "/");

        clickHandler({
            target: {
                closest: () => anchor,
            },
            preventDefault,
        });

        expect(preventDefault).toHaveBeenCalled();
    });

    test("applies deny-by-default network CSP and blocks fetch without network grants", () => {
        render(<PluginPage />);

        const cspMeta = document.head.querySelector("meta[http-equiv='Content-Security-Policy']");
        expect(cspMeta?.getAttribute("content")).toContain("connect-src 'none'");
        expect(cspMeta?.getAttribute("content")).toContain("worker-src 'none'");
        expect(cspMeta?.getAttribute("content")).not.toContain("navigate-to");
        expect(cspMeta?.getAttribute("content")).toContain("form-action 'none'");
        expect(cspMeta?.getAttribute("content")).toContain("frame-src 'none'");
        expect(() => window.fetch("https://example.com")).toThrow(/system\.network\.https/);
        expect(() => new window.Worker("blob:test")).toThrow(/Network access denied/);
        expect(() => navigator.sendBeacon("https://example.com/collect")).toThrow(/system\.network\.https/);
        expect(() => new window.RTCPeerConnection()).toThrow(/WebRTC transports are disabled/);
    });

    test("allows HTTPS fetch when network capabilities are granted via host metadata", () => {
        const meta = document.createElement("meta");
        meta.setAttribute("name", "fdo-plugin-capabilities");
        meta.setAttribute("content", JSON.stringify([
            "system.network",
            "system.network.https",
            "system.network.scope.public-web-secure",
        ]));
        document.head.appendChild(meta);

        const originalFetch = window.fetch;
        window.fetch = jest.fn(() => Promise.resolve({ok: true}));

        render(<PluginPage />);

        const cspMeta = document.head.querySelector("meta[http-equiv='Content-Security-Policy']");
        expect(cspMeta?.getAttribute("content")).toContain("connect-src https:");
        expect(() => window.fetch("https://example.com")).not.toThrow();
        expect(() => window.fetch("http://example.com")).toThrow(/system\.network\.http/);

        window.fetch = originalFetch;
    });

    test("enforces destination scope checks for browser network primitives", () => {
        const meta = document.createElement("meta");
        meta.setAttribute("name", "fdo-plugin-capabilities");
        meta.setAttribute("content", JSON.stringify([
            "system.network",
            "system.network.https",
            "system.network.scope.loopback-dev",
        ]));
        document.head.appendChild(meta);

        render(<PluginPage />);

        expect(() => window.fetch("https://example.com")).toThrow(/scope\.<scope-id>/);
        expect(() => navigator.sendBeacon("https://example.com/collect")).toThrow(/scope\.<scope-id>/);
    });
});
