import React from "react";
import {act, fireEvent, render, screen, waitFor} from "@testing-library/react";
import BuildOutputTerminalComponent from "../../../src/components/editor/BuildOutputTerminalComponent.js";
import virtualFS from "../../../src/components/editor/utils/VirtualFS";

let mockReportAiActivity;

jest.mock("../../../src/components/editor/AiCodingAgentPanel.jsx", () => function MockAiCodingAgentPanel(props) {
    const React = require("react");
    React.useEffect(() => {
        mockReportAiActivity = props.onActivityChange;
        props.onActivityChange?.({
            isLoading: true,
            hasResponse: false,
            error: "",
            latestStatus: "Generating the implementation response.",
            stage: "Generating plugin code",
            elapsedMs: 42000,
            stageElapsedMs: 12000,
        });
    }, []);
    return <div>AI Coding Agent Panel</div>;
});

describe("BuildOutputTerminalComponent", () => {
    beforeEach(() => {
        virtualFS.notifications.reset();
        virtualFS.build.history = [
            {
                kind: "build",
                error: true,
                message: "Build failed: syntax error",
                ts: Date.UTC(2024, 2, 9, 16, 0, 0),
            },
            {
                kind: "test",
                error: true,
                message: "Assertion failed in /index.test.ts",
                ts: Date.UTC(2024, 2, 9, 16, 1, 0),
            },
        ];
        virtualFS.build.message = {kind: "build", error: false, message: "", ts: 0};
        virtualFS.build.inProgress = false;
        virtualFS.tabs.listMarkers = jest.fn(() => []);
    });

    test("renders separate Build and Tests tabs with timestamped entries", async () => {
        const setSelectedTabId = jest.fn();
        const {rerender} = render(
            <BuildOutputTerminalComponent
                selectedTabId="output"
                setSelectedTabId={setSelectedTabId}
                codeEditor={null}
            />
        );

        expect(screen.getByRole("tab", {name: /Build/i})).toBeTruthy();
        expect(screen.getByRole("tab", {name: "Test", exact: true})).toBeTruthy();
        expect(screen.getByTestId("ai-agent-working-dots")).toBeTruthy();
        expect(screen.getByTestId("ai-agent-status-trigger")).toHaveTextContent("Overall: 42s");
        expect(screen.queryByTestId("ai-agent-tab-activity")).toBeNull();
        expect(screen.queryByText(/Generating the implementation response./i)).toBeNull();
        expect(screen.getByText(/Build failed: syntax error/i)).toBeTruthy();
        expect(screen.getByText(/\d{2}:\d{2}:\d{2}/)).toBeTruthy();
        fireEvent.click(screen.getByTestId("ai-agent-status-trigger"));
        expect(screen.getByRole("button", {name: "Show AI Coding Agent status"}).tagName).toBe("BUTTON");
        expect(screen.getByRole("button", {name: "Show AI Coding Agent status"})).toHaveAttribute("aria-expanded", "true");
        expect(screen.getByTestId("ai-agent-status-popover")).toHaveTextContent("Generating plugin code");
        expect(screen.getByTestId("ai-agent-status-popover")).toHaveTextContent("Stage: 12s elapsed");
        expect(screen.getByTestId("ai-agent-status-popover")).not.toHaveTextContent("Overall:");
        expect(setSelectedTabId).not.toHaveBeenCalled();
        fireEvent.mouseDown(document.body);
        await waitFor(() => expect(screen.queryByTestId("ai-agent-status-popover")).toBeNull());
        fireEvent.click(screen.getByRole("tab", {name: /AI Coding Agent/i}));
        expect(setSelectedTabId.mock.calls.some(([tabId]) => tabId === "ai-agent")).toBe(true);

        rerender(
            <BuildOutputTerminalComponent
                selectedTabId="tests"
                setSelectedTabId={setSelectedTabId}
                codeEditor={null}
            />
        );

        expect(screen.getByText(/Assertion failed in \/index\.test\.ts/i)).toBeTruthy();
        expect(screen.getAllByText(/\d{2}:\d{2}:\d{2}/).length).toBeGreaterThan(0);
    });

    test("animates only the tab for the active build or test operation", () => {
        virtualFS.build.inProgress = true;
        virtualFS.build.message = {kind: "test", error: false, message: "Running plugin tests", ts: Date.now()};
        const {unmount} = render(
            <BuildOutputTerminalComponent selectedTabId="tests" setSelectedTabId={jest.fn()} codeEditor={null}/>
        );
        expect(screen.getByTestId("test-working-dots")).toBeTruthy();
        expect(screen.queryByTestId("build-working-dots")).toBeNull();

        virtualFS.build.message = {kind: "build", error: false, message: "Building plugin", ts: Date.now()};
        unmount();
        render(<BuildOutputTerminalComponent selectedTabId="output" setSelectedTabId={jest.fn()} codeEditor={null}/>);
        expect(screen.getByTestId("build-working-dots")).toBeTruthy();
        expect(screen.queryByTestId("test-working-dots")).toBeNull();
    });

    test.each([['build', 'Build'], ['test', 'Test']])("opens %s progress without changing tabs and dismisses on Escape", async (kind, label) => {
        virtualFS.build.inProgress = true;
        virtualFS.build.message = {kind, error: false, message: `${label} is running`, ts: Date.now()};
        const setSelectedTabId = jest.fn();
        render(<BuildOutputTerminalComponent selectedTabId="ai-agent" setSelectedTabId={setSelectedTabId} codeEditor={null}/>);
        const button = screen.getByRole("button", {name: `Show ${label} status`});
        expect(button).toHaveAttribute("type", "button");
        expect(button).toHaveAttribute("aria-expanded", "false");
        fireEvent.click(button);
        expect(screen.getByRole("dialog", {name: `${label} status`})).toHaveTextContent(`${label} is running`);
        expect(screen.getByRole("dialog", {name: `${label} status`})).toHaveTextContent("0s elapsed");
        expect(setSelectedTabId).not.toHaveBeenCalled();
        fireEvent.keyDown(screen.getByRole("dialog", {name: `${label} status`}), {key: "Escape", keyCode: 27});
        await waitFor(() => expect(screen.queryByRole("dialog", {name: `${label} status`})).toBeNull());
        expect(button).toHaveAttribute("aria-expanded", "false");
    });

    test.each([["Enter", 13], [" ", 32]])("keeps %s activation on the status button instead of selecting its tab", (key, charCode) => {
        const setSelectedTabId = jest.fn();
        render(<BuildOutputTerminalComponent selectedTabId="output" setSelectedTabId={setSelectedTabId} codeEditor={null}/>);
        const button = screen.getByRole("button", {name: "Show AI Coding Agent status"});
        button.focus();
        fireEvent.keyDown(button, {key, keyCode: charCode});
        expect(fireEvent.keyPress(button, {key, charCode})).toBe(true);
        fireEvent.keyUp(button, {key, keyCode: charCode});
        // jsdom does not synthesize the native keyboard click.
        fireEvent.click(button, {detail: 0});
        expect(button).toHaveAttribute("aria-expanded", "true");
        expect(screen.getByRole("dialog", {name: "AI Coding Agent status"})).toHaveTextContent("Stage: 12s elapsed");
        expect(setSelectedTabId).not.toHaveBeenCalled();
    });
});


test("keeps the status popover mounted through phase changes and completion until dismissed", async () => {
    render(<BuildOutputTerminalComponent selectedTabId="ai-agent" setSelectedTabId={jest.fn()} codeEditor={null}/>);
    fireEvent.click(screen.getByTestId("ai-agent-status-trigger"));
    const dialog = screen.getByRole("dialog", {name: "AI Coding Agent status"});
    for (const [stage, elapsedMs, isLoading] of [
        ["Generating file 2", 51000, true], ["Retrying the provider", 58000, true],
        ["Validating changes", 65000, true], ["Request finished", 65000, false],
    ]) {
        act(() => mockReportAiActivity({stage, elapsedMs, stageElapsedMs: isLoading ? 0 : 7000, isLoading, latestStatus: stage}));
        expect(screen.getByRole("dialog", {name: "AI Coding Agent status"})).toBe(dialog);
        expect(dialog).toHaveTextContent(stage);
        expect(screen.getByTestId("ai-agent-status-trigger")).toHaveAttribute("aria-expanded", "true");
    }
    expect(dialog).toHaveTextContent("Stage: 7s elapsed");
    expect(screen.getByTestId("ai-agent-status-trigger")).toHaveTextContent("Overall: 1m 05s");
    expect(screen.queryByTestId("ai-agent-working-dots")).toBeNull();
    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(screen.queryByRole("dialog", {name: "AI Coding Agent status"})).toBeNull());
    act(() => mockReportAiActivity({isLoading: true, elapsedMs: 0, stage: "Starting a new request"}));
    expect(screen.getByTestId("ai-agent-status-trigger")).toHaveTextContent("Overall: 0s");
    expect(screen.getByTestId("ai-agent-status-trigger")).toHaveAttribute("aria-expanded", "false");
});
