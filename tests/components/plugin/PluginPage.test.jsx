import React from "react";
import {render, screen, waitFor} from "@testing-library/react";
import {PluginPage} from "../../../src/components/plugin/PluginPage.jsx";

describe("PluginPage host contract", () => {
    beforeEach(() => {
        jest.restoreAllMocks();
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
});
