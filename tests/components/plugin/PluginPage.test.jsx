import React from "react";
import {render, screen, waitFor} from "@testing-library/react";
import {PluginPage} from "../../../src/components/plugin/PluginPage.jsx";

describe("PluginPage host contract", () => {
    beforeEach(() => {
        jest.restoreAllMocks();
        document.head.innerHTML = "";
        window.fetch = jest.fn(() => Promise.resolve({ok: true}));
        window.Worker = jest.fn();
        window.SharedWorker = jest.fn();
        window.RTCPeerConnection = jest.fn();
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

    test("registers the message listener before announcing readiness so a fast parent render message is not missed", async () => {
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
            expect(window.electron.notifications.add).toHaveBeenCalledWith(
                "Error rendering plugin",
                expect.any(String),
                "danger",
            );
        });

        expect(postMessageSpy).toHaveBeenCalledWith(
            expect.objectContaining({ type: "PLUGIN_STAGE", stage: "iframe-render-handle-failed" }),
            "*",
        );
        expect(postMessageSpy).toHaveBeenCalledWith({ type: "PLUGIN_HELLO" }, "*");
    });

    test("shows an in-iframe error state when plugin render import fails", async () => {
        jest.spyOn(window.parent, "postMessage").mockImplementation(() => {});

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

        expect(window.electron.notifications.add).toHaveBeenCalledWith(
            "Error rendering plugin",
            expect.any(String),
            "danger",
        );
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
        expect(cspMeta?.getAttribute("content")).toContain("navigate-to 'none'");
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
