import React from "react";
import {act, fireEvent, render, screen, waitFor} from "@testing-library/react";
import BuildOutputTerminalComponent from "../../../src/components/editor/BuildOutputTerminalComponent.js";
import virtualFS from "../../../src/components/editor/utils/VirtualFS";

let mockReportAiActivity;
let mockShowTests;

jest.mock("../../../src/components/editor/AiCodingAgentPanel.jsx", () => function MockAiCodingAgentPanel(props) {
    const React = require("react");
    React.useEffect(() => {
        mockReportAiActivity = props.onActivityChange;
        mockShowTests = props.onShowTests;
        props.onActivityChange?.({
            isLoading: true,
            hasResponse: false,
            error: "",
            latestStatus: "Generating the implementation response.",
            stage: "Generating plugin code",
            elapsedMs: 42000,
            stageElapsedMs: 12000,
            confidence: {label: "Not yet assessed", detail: "Verification has not started.", checks: []},
        });
    }, []);
    return <div>AI Coding Agent Panel</div>;
});

describe("BuildOutputTerminalComponent", () => {
    test('Live UI selection opens only its workspace assistant and cleans up the subscription', () => {
        let receive;
        const unsubscribe = jest.fn();
        const original = virtualFS.notifications.subscribe;
        const spy = jest.spyOn(virtualFS.notifications, 'subscribe').mockImplementation(function(name, callback) {
            if (name === 'liveUiAiSelection') {receive = callback; return unsubscribe;}
            return original.call(this, name, callback);
        });
        const select = jest.fn();
        const {unmount} = render(<BuildOutputTerminalComponent selectedTabId="output" setSelectedTabId={select} codeEditor={null}/>);
        try {
            act(() => receive({workspaceId: 'foreign-workspace'}));
            expect(select).not.toHaveBeenCalled();
            act(() => receive({workspaceId: virtualFS.sandboxName}));
            expect(select).toHaveBeenCalledWith('ai-agent');
        } finally {unmount(); spy.mockRestore();}
        expect(unsubscribe).toHaveBeenCalledTimes(1);
    });
    test('tray activation selects the agent tab, opens progress, and unsubscribes on unmount', async () => {
        const previous = window.electron.aiCodingAgent;
        let open;
        const unsubscribe = jest.fn();
        window.electron.aiCodingAgent = {onOpenActivity: callback => { open = callback; return unsubscribe; }};
        const setSelectedTabId = jest.fn();
        const {unmount} = render(<BuildOutputTerminalComponent selectedTabId="output" setSelectedTabId={setSelectedTabId} codeEditor={null}/>);
        try {
            act(() => open());
            expect(setSelectedTabId).toHaveBeenCalledWith('ai-agent');
            expect(await screen.findByRole('dialog', {name: 'AI Coding Agent status'})).toHaveTextContent('Generating plugin code');
            fireEvent.click(screen.getByTestId('ai-agent-status-trigger'));
            await waitFor(() => expect(screen.queryByRole('dialog', {name: 'AI Coding Agent status'})).not.toBeInTheDocument());
            act(() => open());
            expect(await screen.findByRole('dialog', {name: 'AI Coding Agent status'})).toBeVisible();
        } finally {
            unmount();
            window.electron.aiCodingAgent = previous;
        }
        expect(unsubscribe).toHaveBeenCalledTimes(1);
    });
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
        expect(screen.getByTestId("ai-agent-working-dots")).toHaveAttribute("data-active", "true");
        expect(screen.getByRole("tab", {name: /AI Coding Agent/}).querySelectorAll(".fdo-ai-mark")).toHaveLength(1);
        expect(screen.getByTestId("ai-agent-status-trigger").querySelector(".fdo-ai-mark")).toBeNull();
        expect(screen.getByTestId("ai-agent-status-trigger")).toHaveTextContent("42s");
        expect(screen.queryByTestId("ai-agent-tab-activity")).toBeNull();
        expect(screen.queryByText(/Generating the implementation response./i)).toBeNull();
        expect(screen.getByText(/Build failed: syntax error/i)).toBeTruthy();
        expect(screen.getByText(/\d{2}:\d{2}:\d{2}/)).toBeTruthy();
        fireEvent.click(screen.getByTestId("ai-agent-status-trigger"));
        expect(screen.getByRole("button", {name: "Show AI Coding Agent status"}).tagName).toBe("BUTTON");
        expect(screen.getByRole("button", {name: "Show AI Coding Agent status"})).toHaveAttribute("aria-expanded", "true");
        expect(screen.getByTestId("ai-agent-status-popover")).toHaveTextContent("Generating plugin code");
        expect(screen.getByTestId("ai-agent-status-popover")).toHaveTextContent("Verification confidence: Not yet assessed");
        expect(screen.getByTestId("ai-agent-status-popover")).toHaveTextContent("Stage: 12 seconds elapsed");
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
        expect(screen.getByRole("dialog", {name: `${label} status`})).toHaveTextContent("0 seconds elapsed");
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
        expect(screen.getByRole("dialog", {name: "AI Coding Agent status"})).toHaveTextContent("Stage: 12 seconds elapsed");
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
    expect(dialog).toHaveTextContent("Stage: 7 seconds elapsed");
    expect(screen.getByTestId("ai-agent-status-trigger")).toHaveTextContent("1m 5s");
    expect(screen.queryByTestId("ai-agent-working-dots")).toBeNull();
    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(screen.queryByRole("dialog", {name: "AI Coding Agent status"})).toBeNull());
    act(() => mockReportAiActivity({isLoading: true, elapsedMs: 0, stage: "Starting a new request"}));
    expect(screen.getByTestId("ai-agent-status-trigger")).toHaveTextContent("0s");
    expect(screen.getByTestId("ai-agent-status-trigger")).toHaveAttribute("aria-expanded", "false");
});

test('candidate testing selects the Tests tab', () => {
    const select = jest.fn();
    render(<BuildOutputTerminalComponent selectedTabId="ai-agent" setSelectedTabId={select}/>);
    act(() => mockShowTests());
    expect(select).toHaveBeenCalledWith('tests');
});
test('closing completed progress resizes the active tab highlight without switching tabs', () => {
    const select = jest.fn();
    const {container} = render(<BuildOutputTerminalComponent selectedTabId="ai-agent" setSelectedTabId={select}/>);
    const tab = container.querySelector('[role="tab"][data-tab-id="ai-agent"]');
    Object.defineProperty(tab, 'clientWidth', {get: () => tab.querySelector('button') ? 240 : 160});
    fireEvent.click(screen.getByTestId('ai-agent-status-trigger'));
    act(() => mockReportAiActivity({isLoading: false, stage: 'Finished', elapsedMs: 42000}));
    const indicator = container.querySelector('.bp6-tab-indicator-wrapper');
    expect(indicator.style.width).toBe('240px');
    fireEvent.click(screen.getByRole('button', {name: 'Close AI Coding Agent status'}));
    expect(screen.queryByTestId('ai-agent-status-trigger')).toBeNull();
    expect(indicator.style.width).toBe('160px');
    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(select).not.toHaveBeenCalled();
});

test('guide approval closes open progress and prevents tray requests from reopening it', async () => {
    const previous = window.electron.aiCodingAgent;
    let open;
    window.electron.aiCodingAgent = {onOpenActivity: callback => { open = callback; return () => {}; }};
    const {unmount} = render(<BuildOutputTerminalComponent selectedTabId="ai-agent" setSelectedTabId={jest.fn()} codeEditor={null}/>);
    try {
        act(() => open());
        expect(await screen.findByRole('dialog', {name: 'AI Coding Agent status'})).toBeVisible();
        act(() => mockReportAiActivity({isLoading: true, guideReviewPending: true, stage: 'Waiting for plugin guide approval'}));
        await waitFor(() => expect(screen.queryByRole('dialog', {name: 'AI Coding Agent status'})).toBeNull());
        expect(screen.getByTestId('ai-agent-status-trigger')).toBeDisabled();
        act(() => open());
        expect(screen.queryByRole('dialog', {name: 'AI Coding Agent status'})).toBeNull();
        act(() => mockReportAiActivity({isLoading: true, guideReviewPending: false, stage: 'Generating files'}));
        expect(screen.getByTestId('ai-agent-status-trigger')).toBeEnabled();
        expect(screen.queryByRole('dialog', {name: 'AI Coding Agent status'})).toBeNull();
        fireEvent.click(screen.getByTestId('ai-agent-status-trigger'));
        expect(await screen.findByRole('dialog', {name: 'AI Coding Agent status'})).toBeVisible();
        fireEvent.click(screen.getByRole('button', {name: 'Close AI Coding Agent status'}));
        await waitFor(() => expect(screen.queryByRole('dialog', {name: 'AI Coding Agent status'})).toBeNull());
    } finally {
        unmount();
        window.electron.aiCodingAgent = previous;
    }
});

test('test output follows the latest appended result without waiting for smooth scroll animation', async () => {
    render(<BuildOutputTerminalComponent selectedTabId="tests" setSelectedTabId={jest.fn()} codeEditor={null}/>);
    const output=screen.getByRole('region',{name:'Plugin test output'});
    Object.defineProperty(output,'scrollHeight',{configurable:true,value:1000});
    act(()=>virtualFS.build.addMessage('First result',false,'test'));
    await waitFor(()=>expect(output.scrollTop).toBe(1000));
    output.scrollTop=100;
    Object.defineProperty(output,'scrollHeight',{configurable:true,value:1800});
    act(()=>virtualFS.build.addMessage('Latest result',false,'test'));
    await waitFor(()=>expect(output.scrollTop).toBe(1800));
    expect(output).toHaveTextContent('Latest result');
});
