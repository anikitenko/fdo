import React from "react";
import {act, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {HotkeysProvider} from "@blueprintjs/core";
import AiCodingAgentPanel, {
    buildSmartModeGuidance,
    buildSelectionGuidance,
    isAiCodingOutputLimitError,
    isInformationalOnlyPrompt,
    shouldAutoApplySingleFileResponse,
} from "../../../src/components/editor/AiCodingAgentPanel.jsx";
import {isNewPluginCreationRequest, resolveAiCodingAgentAction} from "../../../src/components/editor/utils/aiCodingAgentRouting.js";
import {selectPluginAuthoringScenario} from "../../../src/utils/plugins/authoring/pluginAuthoringScenarioCatalog.js";
import virtualFS from "../../../src/components/editor/utils/VirtualFS";
import runPluginTests from "../../../src/components/editor/utils/runTests.js";
import {getPendingFiles, stagePendingFiles} from "../../../src/components/editor/utils/aiPendingFiles";
import AiPendingFiles from "../../../src/components/editor/AiPendingFiles";

const mockAppToasterShow = jest.fn();

const skillMentionFixture = () => ({skills: [
    {name: 'team-review', description: 'Read $HOME literally.', enabled: true, assistantIds: ['assistant-1']},
    {name: 'team-style', description: 'Another model', enabled: true, assistantIds: ['other']},
    {name: 'team-disabled', description: 'Disabled', enabled: false, assistantIds: ['assistant-1']},
]});

test('Codex skill picker requires deliberate selection and preserves literal variables and descriptions', async () => {
    window.electron.settings.ai.getExtensions = jest.fn().mockResolvedValue(skillMentionFixture());
    render(<TestHarness/>);
    const input = await screen.findByLabelText(/Describe what you want to do/i);
    await waitFor(() => expect(window.electron.settings.ai.getExtensions).toHaveBeenCalled());
    fireEvent.change(input, {target: {value: 'Keep $HOME and ${NAME}; use $te'}});
    expect(await screen.findByRole('listbox', {name: 'Codex skill suggestions'})).toBeVisible();
    expect(screen.getByRole('option', {name: '$team-review'})).toBeVisible();
    expect(screen.getByText('Read $HOME literally.')).toBeVisible();
    expect(screen.queryByRole('option', {name: '$team-style'})).toBeNull();
    expect(screen.queryByRole('option', {name: '$team-disabled'})).toBeNull();
    expect(fireEvent.keyDown(input, {key: 'Enter'})).toBe(true);
    expect(input.value).toBe('Keep $HOME and ${NAME}; use $te');
    fireEvent.keyDown(input, {key: 'Escape'}); fireEvent.keyUp(input, {key: 'Escape'});
    expect(screen.queryByRole('listbox', {name: 'Codex skill suggestions'})).toBeNull();
    fireEvent.click(input);
    fireEvent.keyDown(input, {key: 'Tab'}); fireEvent.keyUp(input, {key: 'Tab'});
    expect(input.value).toBe('Keep $HOME and ${NAME}; use $team-review ');
    expect(screen.queryByRole('listbox', {name: 'Codex skill suggestions'})).toBeNull();
    fireEvent.change(input, {target: {value: 'Explain $HOME, $myVariable, ${NAME}, and `$team-review`'}});
    expect(screen.queryByRole('listbox', {name: 'Codex skill suggestions'})).toBeNull();
});

test('skill suggestions refresh after assignment changes and disappear for another provider', async () => {
    let changed;
    window.electron.settings.ai.on = {extensionsUpdated: jest.fn(handler => {changed = handler;})};
    window.electron.settings.ai.off = {extensionsUpdated: jest.fn()};
    window.electron.settings.ai.getExtensions = jest.fn().mockResolvedValue(skillMentionFixture());
    window.electron.settings.ai.getAssistants.mockResolvedValue([
        {id: 'assistant-1', provider: 'codex-cli', name: 'Codex', purpose: 'coding', default: true},
        {id: 'api', provider: 'openrouter', name: 'API', purpose: 'coding'},
    ]);
    const {unmount} = render(<TestHarness/>);
    const input = await screen.findByLabelText(/Describe what you want to do/i);
    await waitFor(() => expect(window.electron.settings.ai.getExtensions).toHaveBeenCalled());
    fireEvent.change(input, {target: {value: '$'}});
    expect(await screen.findByRole('option', {name: '$team-review'})).toBeVisible();
    window.electron.settings.ai.getExtensions.mockResolvedValue({skills: []});
    await act(async () => changed());
    fireEvent.change(input, {target: {value: '$te'}});
    expect(screen.queryByRole('listbox', {name: 'Codex skill suggestions'})).toBeNull();
    fireEvent.change(screen.getByLabelText('AI Assistant'), {target: {value: 'api'}});
    fireEvent.change(input, {target: {value: '$'}});
    expect(screen.queryByRole('listbox', {name: 'Codex skill suggestions'})).toBeNull();
    unmount(); expect(window.electron.settings.ai.off.extensionsUpdated).toHaveBeenCalled();
});

test('a follow-up sends literal dollar variables unchanged without skill errors or expansion', async () => {
    window.electron.settings.ai.getExtensions = jest.fn().mockResolvedValue(skillMentionFixture());
    window.electron.aiCodingAgent.smartMode.mockImplementation(async ({requestId}) => {
        streamHandlers.done?.({requestId, fullContent: 'This is a plain explanation.'});
        return {success: true, requestId, content: 'This is a plain explanation.'};
    });
    render(<TestHarness/>);
    const input = await screen.findByLabelText(/Describe what you want to do/i);
    fireEvent.change(input, {target: {value: 'Explain my plugin without changing files.'}});
    fireEvent.click(screen.getByRole('button', {name: /Submit/i}));
    await waitFor(() => expect(input).not.toHaveAttribute('readonly'));
    fireEvent.change(input, {target: {value: 'Can you also explain the literal variables $HOME, $myVariable and ${NAME} without changing files?'}});
    fireEvent.click(screen.getByRole('button', {name: /Submit/i}));
    await waitFor(() => expect(window.electron.aiCodingAgent.smartMode).toHaveBeenCalledTimes(2));
    expect(window.electron.aiCodingAgent.smartMode.mock.lastCall[0].prompt).toContain('$HOME, $myVariable and ${NAME}');
    expect(screen.queryByTestId('ai-coding-error')).toBeNull();
});

jest.mock("../../../src/components/editor/utils/VirtualFS", () => ({
    __esModule: true,
    default: {
        listModels: jest.fn(() => []),
        getLatestContent: jest.fn(() => ({})),
        setFileContent: jest.fn(),
        fs: {
            version: jest.fn(() => ({ version: "" })),
            create: jest.fn(() => ({ version: "snapshot-1" })),
        },
        tabs: {
            get: jest.fn(() => []),
        },
        build: {
            getHistory: jest.fn(() => []),
        },
    },
}));

jest.mock("../../../src/components/editor/utils/runTests.js", () => ({
    __esModule: true,
    default: jest.fn(),
}));

jest.mock("../../../src/components/AppToaster.jsx", () => ({
    AppToaster: {
        show: (...args) => mockAppToasterShow(...args),
    },
}));

function TestHarness({ codeEditor, onActivityChange }) {
    const [response, setResponse] = React.useState("");
    return (
        <HotkeysProvider>
            <AiCodingAgentPanel codeEditor={codeEditor} response={response} setResponse={setResponse} onActivityChange={onActivityChange} />
        </HotkeysProvider>
    );
}

test.each([false, true])('workspace review detects unregistered styles with repair=%s even when tests and AI review pass', async repair => {
    virtualFS.getLatestContent.mockReturnValue({
        '/index.ts': 'import {render} from "./view"; export const renderPlugin = render;',
        '/view.ts': 'import css from "./styles.css"; export const render = () => `<div class="panel">Content</div>`;',
        '/styles.css': '.panel {display:grid}',
    });
    runPluginTests.mockResolvedValue({success: true, skipped: false});
    window.electron.aiCodingAgent.smartMode.mockImplementation(async ({requestId}) => {
        const content = JSON.stringify({status: 'completed', summary: 'Tests passed.', findings: [], limitations: []});
        Promise.resolve().then(() => streamHandlers.done?.({requestId, fullContent: content}));
        return {success: true, requestId, content};
    });
    window.electron.aiCodingAgent.planCode.mockResolvedValue({success: false, error: 'Fixture repair provider unavailable'});
    render(<TestHarness/>);
    const button = await screen.findByRole('button', {name: repair ? 'Review & repair' : 'Review workspace'});
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => expect(window.electron.aiCodingAgent.smartMode).toHaveBeenCalled());
    expect(window.electron.plugin.activate).not.toHaveBeenCalled();
    expect(window.electron.plugin.deactivate).not.toHaveBeenCalled();
    expect(window.electron.plugin.init).not.toHaveBeenCalled();
    expect(window.electron.plugin.render).not.toHaveBeenCalled();
    expect(window.electron.aiCodingAgent.smartMode.mock.lastCall[0].context).toContain('STYLESHEET REVIEW CONTRACT');
    if (repair) {
        await waitFor(() => expect(window.electron.aiCodingAgent.planCode).toHaveBeenCalled());
        const request = window.electron.aiCodingAgent.planCode.mock.lastCall[0];
        expect(request.repairPaths).toEqual(['/index.ts', '/view.ts']);
        expect(request.prompt).toContain('CSS entries are objects');
        await screen.findAllByText(/Fixture repair provider unavailable/);
    } else {
        await waitFor(() => expect(screen.getByTestId('ai-coding-response')).toHaveTextContent('unregistered plugin styles'));
        expect(window.electron.aiCodingAgent.planCode).not.toHaveBeenCalled();
    }
    expect(virtualFS.setFileContent).not.toHaveBeenCalled();
});

let streamHandlers;

test.each([false, true])('workspace progress follows the current file after a provider retry (popover: %s)', async popover => {
    let requestId, finish;
    const activity = jest.fn();
    window.electron.aiCodingAgent.smartMode.mockImplementationOnce(request => {
        requestId = request.requestId;
        return new Promise(resolve => { finish = resolve; });
    });
    render(<TestHarness onActivityChange={popover ? activity : undefined}/>);
    await screen.findByLabelText(/Describe what you want to do/i);
    fireEvent.change(screen.getByLabelText(/Describe what you want to do/i), {target: {value: 'Explain this plugin'}});
    fireEvent.click(screen.getByRole('button', {name: /Submit/i}));
    await waitFor(() => expect(requestId).toBeTruthy());
    await act(async () => {
        streamHandlers.delta({requestId, type: 'stage', label: 'Generating file 1 of 12: /types.ts', content: '',
            estimate: {path: '/types.ts', index: 1, total: 12}});
        streamHandlers.delta({requestId, type: 'reset'});
        streamHandlers.delta({requestId, type: 'status', message: 'Retrying the provider.', metadata: {phase: 'provider-retry'}});
    });
    if (popover) expect(activity.mock.lastCall[0].estimate).toContain('Estimating remaining time');
    else expect(screen.getByTestId('ai-coding-request-progress')).toHaveTextContent('Estimating remaining time');
    for (const label of ['Generating file 2 of 12: /render.tsx', 'Repairing file: /render.tsx', 'Splitting oversized module: /render.tsx']) {
        await act(async () => {
            streamHandlers.delta({requestId, type: 'stage', label, content: 'Pending types file'});
            streamHandlers.delta({requestId, type: 'status', message: 'Waiting for the complete response from Cloudflare.', metadata: {phase: 'waiting-for-first-content'}});
        });
        if (popover) {
            expect(activity.mock.lastCall[0].stage).toBe(label);
            expect(activity.mock.lastCall[0].latestStatus).toBe('Waiting for the complete response from Cloudflare.');
        } else {
            const progress = screen.getByTestId('ai-coding-request-progress');
            expect(progress.querySelector('strong')).toHaveTextContent(label);
            expect(progress).not.toHaveTextContent('Correcting generated code · attempt 2');
        }
    }
    await act(async () => {
        streamHandlers.error({requestId, error: 'Test finished'});
        finish({success: false, requestId, error: 'Test finished'});
    });
});

test("shows measured streaming progress, preserves whitespace, and resets counts on retry", async () => {
    let requestId;
    let finish;
    const onActivityChange = jest.fn();
    window.electron.aiCodingAgent.smartMode.mockImplementationOnce((request) => {
        requestId = request.requestId;
        return new Promise(resolve => { finish = resolve; });
    });
    render(<TestHarness onActivityChange={onActivityChange} />);
    await waitFor(() => expect(window.electron.settings.ai.getAssistants).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText(/Describe what you want to do/i), {target: {value: "Explain this plugin"}});
    fireEvent.click(screen.getByRole("button", {name: /Submit/i}));
    await waitFor(() => expect(requestId).toBeTruthy());
    const runningPrompt = screen.getByLabelText(/Current request/);
    expect(runningPrompt).toHaveAttribute('readonly');
    expect(runningPrompt).not.toBeDisabled();
    expect(runningPrompt).toHaveValue('Explain this plugin');
    fireEvent.change(runningPrompt, {target: {value: 'Accidental replacement'}});
    expect(runningPrompt).toHaveValue('Explain this plugin');
    await act(async () => {
        streamHandlers.delta({requestId, type: "status", message: "First answer", metadata: {phase: "first-content"}});
        for (const content of ["```js\nconst a =", "\n  ", "42;\n```"])
            streamHandlers.delta({requestId, content});
        streamHandlers.delta({requestId: "stale", content: "discard this"});
    });
    const response = await screen.findByTestId("ai-coding-response");
    expect(response.querySelector("pre").textContent).toBe("```js\nconst a =\n  42;\n```");
    expect(response.querySelector("code")).toBeNull();
    await waitFor(() => expect(onActivityChange.mock.lastCall[0].latestStatus).toContain("25 answer characters received"));
    await act(async () => {
        streamHandlers.delta({requestId, type: "reset"});
        streamHandlers.delta({requestId, content: "New"});
    });
    await waitFor(() => expect(onActivityChange.mock.lastCall[0].latestStatus).toContain("3 answer characters received"));
    await act(async () => {
        streamHandlers.delta({requestId, type: "stage", label: "Generating file 2 of 3: /index.ts", content: "Pending first file"});
        streamHandlers.delta({requestId, type: "status", message: "Waiting for the complete response from Cloudflare. This request returns its answer all at once. (10s elapsed)", metadata: {phase: "waiting-for-first-content"}});
    });
    expect(onActivityChange.mock.lastCall[0].stage).toBe("Generating file 2 of 3: /index.ts");
    expect(onActivityChange.mock.lastCall[0].latestStatus).toContain("Waiting for the complete response from Cloudflare.");
    await act(async () => {
        streamHandlers.delta({requestId, type: "status", message: "First answer", metadata: {phase: "first-content"}});
        streamHandlers.delta({requestId, content: "Next"});
    });
    await waitFor(() => {
        expect(onActivityChange.mock.lastCall[0].stage).toBe("Generating file 2 of 3: /index.ts");
        expect(onActivityChange.mock.lastCall[0].latestStatus).toContain("4 answer characters received");
    });
    await act(async () => {
        streamHandlers.error({requestId, error: "Test stream stopped"});
        finish({success: false, requestId, error: "Test stream stopped"});
    });
    expect(screen.getByTestId("ai-coding-response")).toHaveTextContent("Pending first file");
    expect(screen.getByTestId("ai-coding-response")).toHaveTextContent("Next");
    expect(virtualFS.createFile).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/Describe what you want to do/i)).not.toHaveAttribute('readonly');
});

test.each([undefined, "another-snapshot"])("keeps historical replies browseable without apply controls for snapshot %s", async (snapshot) => {
    virtualFS.sandboxName = "old-history";
    localStorage.setItem("fdo:plugin-ai-history:v1:old-history", JSON.stringify([
        {role: "assistant", content: "Historical plugin changes", ...(snapshot ? {snapshot} : {})},
    ]));
    render(<TestHarness />);
    await waitFor(() => expect(window.electron.settings.ai.getAssistants).toHaveBeenCalled());
    expect(screen.getByTestId("ai-conversation-history").textContent).toContain("Historical plugin changes");
    expect(screen.queryByTestId("ai-coding-response")).toBeNull();
    expect(screen.queryByRole("button", {name: /Apply proposed changes/i})).toBeNull();
});

test.each([false, true])("snapshot restore blocks a delayed edit, including switch-back=%s", async (switchBack) => {
    virtualFS.sandboxName = "snapshot-chat";
    let onSwitch;
    virtualFS.notifications = {subscribe: jest.fn((_event, handler) => { onSwitch = handler; return () => {}; })};
    let finish;
    const pending = new Promise(resolve => { finish = resolve; });
    const reply = async ({requestId}) => {
        await pending;
        const content = '```typescript\n// SOLUTION READY TO APPLY\nexport const name = "Stale edit";\n```';
        streamHandlers.done?.({requestId, fullContent: content});
        return {success: true, requestId, content};
    };
    window.electron.aiCodingAgent.generateCode.mockImplementation(reply);
    const model = {getLanguageId: () => "typescript", getValue: () => 'export const name = "Original";',
        getValueInRange: () => "", pushEditOperations: jest.fn()};
    render(<TestHarness codeEditor={{getSelection: () => null, getModel: () => model}} />);
    await waitFor(() => expect(window.electron.settings.ai.getAssistants).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText(/Action/i, {selector: "select"}), {target: {value: "generate"}});
    fireEvent.change(document.querySelector("#prompt-input"), {target: {value: "Update the name in /index.ts to Stale edit"}});
    fireEvent.click(screen.getByRole("button", {name: /Submit/i}));
    await waitFor(() => expect(window.electron.aiCodingAgent.generateCode).toHaveBeenCalled());
    await act(async () => {
        virtualFS.fs.snapshotSwitchRevision = 1;
        onSwitch({from: "original", to: "restored"});
        if (switchBack) {
            virtualFS.fs.snapshotSwitchRevision = 2;
            onSwitch({from: "restored", to: "original"});
        }
        finish();
    });
    await waitFor(() => expect(screen.queryByRole("button", {name: /Stop/i})).toBeNull());
    expect(model.pushEditOperations).not.toHaveBeenCalled();
    expect(virtualFS.createFile).not.toHaveBeenCalled();
    expect(virtualFS.fs.create).not.toHaveBeenCalled();
    const history = JSON.parse(localStorage.getItem("fdo:plugin-ai-history:v1:snapshot-chat"));
    expect(history.filter(message => message.role === "snapshot")).toHaveLength(switchBack ? 2 : 1);
    expect(history.some(message => message.role === "assistant")).toBe(false);
});

test("restores plugin conversation and includes it in a follow-up, then clears it", async () => {
    virtualFS.sandboxName = "history-plugin";
    const codeEditor = {getSelection: () => null, getModel: () => ({
        getValue: () => "export const name = 'Quasar Quill';", getLanguageId: () => "typescript",
        getValueInRange: () => "",
    })};
    window.electron.aiCodingAgent.smartMode.mockImplementation(async ({requestId}) => {
        const content = "We chose Quasar Quill for the display name.";
        streamHandlers.done?.({requestId, fullContent: content});
        return {success: true, requestId, content};
    });
    const first = render(<TestHarness codeEditor={codeEditor} />);
    await waitFor(() => expect(window.electron.settings.ai.getAssistants).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("Changes"), {target: {value: "review"}});
    fireEvent.change(screen.getByLabelText(/Describe what you want to do/i), {target: {value: "Explain the display name Quasar Quill. Do not modify code."}});
    fireEvent.click(screen.getByRole("button", {name: /Submit/i}));
    await waitFor(() => expect(JSON.parse(localStorage.getItem("fdo:plugin-ai-history:v1:history-plugin"))).toHaveLength(2));
    first.unmount();
    render(<TestHarness codeEditor={codeEditor} />);
    await waitFor(() => expect(screen.getByTestId("ai-coding-response").textContent).toContain("We chose Quasar Quill"));
    fireEvent.change(screen.getByLabelText("Changes"), {target: {value: "review"}});
    fireEvent.change(screen.getByLabelText(/Describe what you want to do/i), {target: {value: "What name did we choose earlier? Do not modify code."}});
    fireEvent.click(screen.getByRole("button", {name: /Submit/i}));
    await waitFor(() => expect(window.electron.aiCodingAgent.smartMode).toHaveBeenCalledTimes(2));
    expect(JSON.stringify(window.electron.aiCodingAgent.smartMode.mock.calls[1][0])).toContain("Previous conversation in this plugin workspace");
    expect(JSON.stringify(window.electron.aiCodingAgent.smartMode.mock.calls[1][0])).toContain("We chose Quasar Quill");
    await waitFor(() => expect(screen.queryByRole("button", {name: /Stop/i})).toBeNull());
    fireEvent.click(screen.getByRole("button", {name: "Reset workspace conversation"}));
    expect(screen.getByText(/removes the saved AI conversation for the current plugin workspace/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {name: "Reset conversation"}));
    expect(JSON.parse(localStorage.getItem("fdo:plugin-ai-history:v1:history-plugin"))).toEqual([]);
});

test.each(["raw", "solution"])("applies the recorded live FILE-comment response to its named files (%s)", async (format) => {
    const recorded = require("node:fs").readFileSync(require("node:path").join(__dirname, "../../fixtures/ai/rename-file-comments.txt"), "utf8");
    const content = format === "solution" ? `\`\`\`typescript\n// SOLUTION READY TO APPLY\n${recorded}\n\`\`\`` : recorded;
    const {BLANK_TEMPLATE_MAIN, BLANK_TEMPLATE_RENDER} = require("../../../src/components/editor/utils/virtualTemplates");
    const model = {
        getLanguageId: () => "typescript",
        getValue: () => BLANK_TEMPLATE_RENDER("Aurora Anvil"),
        getValueInRange: () => "",
        pushEditOperations: jest.fn(),
    };
    virtualFS.getFileName.mockReturnValue("/render.tsx");
    virtualFS.getLatestContent.mockReturnValue({
        "/index.ts": BLANK_TEMPLATE_MAIN("Aurora Anvil"),
        "/render.tsx": model.getValue(),
    });
    const reply = async ({requestId}) => {
        streamHandlers.done?.({requestId, fullContent: content});
        return {success: true, requestId, content};
    };
    window.electron.aiCodingAgent.smartMode.mockImplementation(reply);
    window.electron.aiCodingAgent.generateCode.mockImplementation(reply);
    window.electron.aiCodingAgent.planCode.mockImplementation(reply);
    render(<TestHarness codeEditor={{getModel: () => model, getSelection: () => null}} />);
    await waitFor(() => expect(window.electron.settings.ai.getAssistants).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText(/Describe what you want to do/i), {target: {value:
        "Please rename this plugin to Quasar Quill. Update the plugin metadata name in /index.ts and make /render.tsx show the same visible heading. Apply the changes in the current plugin workspace only. If you change multiple files, return executable workspace file sections."}});
    fireEvent.click(screen.getByRole("button", {name: /Submit/i}));
    await waitFor(() => expect(virtualFS.createFile).toHaveBeenCalledWith("/index.ts", expect.anything(), undefined));
    const updates = Object.fromEntries(virtualFS.createFile.mock.calls.map(([path, fileModel]) => [path, fileModel.getValue()]));
    expect(updates["/index.ts"]).toContain('name: "Quasar Quill"');
    expect(updates["/render.tsx"]).toContain('`Quasar Quill`');
    expect(updates["/render.tsx"]).not.toContain("class MyPlugin");
    expect(model.pushEditOperations).not.toHaveBeenCalled();
    expect(await screen.findByText("Applied as snapshot snapshot-1")).toBeTruthy();
});

beforeEach(() => {
    virtualFS.sandboxName = "";
    virtualFS.fs.snapshotSwitchRevision = 0;
    delete virtualFS.notifications;
    delete window.__requestSnapshotSwitch;
    delete window.__openSnapshotsPanel;
    localStorage.clear();
    jest.clearAllMocks();
    window.location.hash = "";
    mockAppToasterShow.mockReset();
    streamHandlers = {
        delta: null,
        done: null,
        error: null,
        cancelled: null,
    };

    window.electron.settings.ai = {
        getAssistants: jest.fn().mockResolvedValue([
            {
                id: "assistant-1",
                name: "Codex",
                provider: "codex-cli",
                model: "gpt-5.4-mini",
                purpose: "coding",
                default: true,
            },
        ]),
    };

    virtualFS.listModels = jest.fn(() => []);
    virtualFS.getLatestContent = jest.fn(() => ({}));
    virtualFS.getFileName = jest.fn(() => "/index.ts");
    virtualFS.setFileContent = jest.fn();
    virtualFS.createFile = jest.fn();
    virtualFS.createFolder = jest.fn();
    virtualFS.fs.version = jest.fn(() => ({ version: "" }));
    virtualFS.fs.create = jest.fn(() => ({ version: "snapshot-1" }));
    virtualFS.tabs.get = jest.fn(() => []);
    virtualFS.build.getHistory = jest.fn(() => []);
    runPluginTests.mockReset();

    window.electron.system.getFdoSdkKnowledge = jest.fn().mockResolvedValue({ success: true, results: [] });
    window.electron.system.getExternalReferenceKnowledge = jest.fn().mockResolvedValue({ success: true, results: [] });
    window.electron.plugin = {
        ...(window.electron.plugin || {}),
        typecheck: jest.fn().mockResolvedValue({success: true}),
        build: jest.fn().mockResolvedValue({success: true}),
        runTests: jest.fn().mockResolvedValue({success: true, skipped: false}),
        getAll: jest.fn().mockResolvedValue({
            plugins: [
                { id: "demo", metadata: { name: "Demo Plugin" } },
            ],
        }),
        getRuntimeStatus: jest.fn().mockResolvedValue({
            success: true,
            statuses: [{ id: "demo", loading: false, loaded: true, ready: true, inited: true }],
        }),
        activate: jest.fn().mockResolvedValue({ success: true }),
        deactivate: jest.fn().mockResolvedValue({ success: true }),
        init: jest.fn().mockResolvedValue({ success: true }),
        render: jest.fn().mockResolvedValue({ success: true }),
        getLogTail: jest.fn().mockResolvedValue({ success: false, combined: "" }),
        getLogTrace: jest.fn().mockResolvedValue({ success: false, combined: "" }),
    };

    window.electron.aiCodingAgent = {
        setActivity: jest.fn(),
        routeJudge: jest.fn().mockResolvedValue({
            success: true,
            judge: {
                available: false,
                route: "smart",
                confidence: 0,
                reasons: ["test-default"],
            },
        }),
        on: {
            streamDelta: jest.fn((handler) => { streamHandlers.delta = handler; }),
            streamDone: jest.fn((handler) => { streamHandlers.done = handler; }),
            streamError: jest.fn((handler) => { streamHandlers.error = handler; }),
            streamCancelled: jest.fn((handler) => { streamHandlers.cancelled = handler; }),
        },
        off: {
            streamDelta: jest.fn(),
            streamDone: jest.fn(),
            streamError: jest.fn(),
            streamCancelled: jest.fn(),
        },
        smartMode: jest.fn(),
        generateCode: jest.fn(),
        editCode: jest.fn(),
        explainCode: jest.fn(),
        fixCode: jest.fn(async ({ requestId }) => {
            const patchResponse = [
                "```patch",
                "File: /index.ts",
                "<<<<<<< SEARCH",
                "const brokenValue = oldThing();",
                "=======",
                "const brokenValue = safeThing();",
                ">>>>>>> REPLACE",
                "```",
            ].join("\n");

            Promise.resolve().then(() => {
                streamHandlers.done?.({
                    requestId,
                    fullContent: patchResponse,
                });
            });

            return {
                success: true,
                requestId,
                content: patchResponse,
            };
        }),
        planCode: jest.fn(),
        cancelRequest: jest.fn().mockResolvedValue({ success: true, cancelled: true }),
    };

    runPluginTests.mockResolvedValue({
        success: false,
        skipped: false,
        error: "Plugin tests failed with exit code 1.",
        output: "ReferenceError in /tests/unit/plugin.test.ts: describe is not defined",
    });
});

describe("AiCodingAgentPanel auto-apply patch flow", () => {
    test.each([
        ['codex-cli', undefined, 'Text only in FDO', true],
        ['openrouter', {provider: 'openrouter', model: 'image-model', imageSupport: 'supported', source: 'provider-metadata'}, 'Images supported', false],
        ['openrouter', {provider: 'openrouter', model: 'image-model', imageSupport: 'unsupported', source: 'provider-metadata'}, 'Text only', true],
    ])('shows screenshot support and gates upload for %s (%s)', async (provider, inputCapabilities, label, disabled) => {
        window.electron.settings.ai.getAssistants.mockResolvedValueOnce([
            {id: 'assistant-1', name: 'Selected', provider, model: 'image-model', purpose: 'coding', default: true, inputCapabilities},
        ]);
        render(<TestHarness />);
        await screen.findByLabelText('AI Assistant');
        fireEvent.change(screen.getByLabelText('Action'), {target: {value: 'plan'}});
        expect(screen.getByText(`Screenshots: ${label}`)).toBeTruthy();
        expect(screen.getByRole('button', {name: 'Upload Image'}).disabled).toBe(disabled);
    });

    test('reloads assistants without losing the selected assistant or prompt draft', async () => {
        const assistants = [
            {id: 'a', name: 'First', provider: 'openai', purpose: 'coding', default: true},
            {id: 'b', name: 'Second', provider: 'openai', purpose: 'coding'},
        ];
        window.electron.settings.ai.getAssistants.mockResolvedValueOnce(assistants)
            .mockResolvedValueOnce([assistants[0], {...assistants[1], name: 'Updated second'}]);
        render(<TestHarness />);
        const select = await screen.findByLabelText('AI Assistant');
        fireEvent.change(select, {target: {value: 'b'}});
        const prompt = screen.getByLabelText(/Describe what you want to do/i);
        fireEvent.change(prompt, {target: {value: 'Keep this draft'}});
        fireEvent.click(screen.getByRole('button', {name: 'Reload AI assistants'}));
        await screen.findByRole('option', {name: /Updated second/});
        expect(select.value).toBe('b');
        expect(prompt.value).toBe('Keep this draft');
        expect(window.electron.settings.ai.getAssistants).toHaveBeenCalledTimes(2);
    });

    test('offers assistant reload when none were configured at window opening', async () => {
        window.electron.settings.ai.getAssistants.mockResolvedValueOnce([]);
        render(<TestHarness />);
        const reload = await screen.findByRole('button', {name: 'Reload AI assistants'});
        fireEvent.click(reload);
        const select = await screen.findByLabelText('AI Assistant');
        expect(select.value).toBe('assistant-1');
    });

    test('keeps the existing assistant usable when reloading fails', async () => {
        window.electron.settings.ai.getAssistants.mockResolvedValueOnce([
            {id: 'assistant-1', name: 'Existing', provider: 'codex-cli', purpose: 'coding', default: true},
        ]).mockRejectedValueOnce(new Error('Unavailable'));
        render(<TestHarness />);
        const select = await screen.findByLabelText('AI Assistant');
        fireEvent.click(screen.getByRole('button', {name: 'Reload AI assistants'}));
        await screen.findByText('Could not reload AI assistants. Try again or check Settings.');
        expect(select.value).toBe('assistant-1');
    });

    test.each(['apply', 'review'])('conversational feature follow-ups work in %s mode without stale failure routing', async mode => {
        virtualFS.getLatestContent.mockReturnValue({
            '/index.ts': 'export const plugin = true;',
            '/render.ts': 'export const render = () => "Top level keys";',
        });
        virtualFS.build.getHistory.mockReturnValue([{error: true, message: '/index.ts: previous build error'}]);
        const content = '### File: /render.ts\n```typescript\nexport const render = () => "<button>Show nested values</button>";\n```';
        window.electron.aiCodingAgent.planCode.mockImplementation(async ({requestId}) => {
            streamHandlers.done?.({requestId, fullContent: content});
            return {success: true, requestId, content};
        });
        render(<TestHarness />);
        await waitFor(() => expect(window.electron.settings.ai.getAssistants).toHaveBeenCalled());
        fireEvent.change(screen.getByLabelText('Changes'), {target: {value: mode}});
        fireEvent.change(screen.getByLabelText(/Describe what you want to do/i), {target: {value:
            'wow cool, I like that plugin and I see that it shows top level keys.. and can you please add a button to show values of those keys including nested?'}});
        fireEvent.click(screen.getByRole('button', {name: /Submit/i}));
        await waitFor(() => expect(window.electron.aiCodingAgent.planCode).toHaveBeenCalledTimes(1));
        expect(window.electron.aiCodingAgent.fixCode).not.toHaveBeenCalled();
        if (mode === 'review') {
            expect(virtualFS.createFile).not.toHaveBeenCalled();
            const apply = await screen.findByRole('button', {name: 'Apply proposed changes'});
            await waitFor(() => expect(apply).not.toBeDisabled());
            fireEvent.click(apply);
        }
        await waitFor(() => expect(virtualFS.createFile).toHaveBeenCalledWith('/render.ts', expect.anything(), undefined));
        const renderModel = virtualFS.createFile.mock.calls.find(([path]) => path === '/render.ts')[1];
        expect(renderModel.getValue()).toContain('Show nested values');
    });

    test("restores the snapshot linked from a saved conversation entry", async () => {
        virtualFS.sandboxName = "linked-snapshot";
        const requestSnapshotSwitch = jest.fn();
        window.__requestSnapshotSwitch = requestSnapshotSwitch;
        localStorage.setItem("fdo:plugin-ai-history:v1:linked-snapshot", JSON.stringify([
            {
                role: "user",
                content: "Create a functional Web Tools Workbench plugin.",
                snapshot: "zygomorphic-turquoise",
            },
        ]));

        render(<TestHarness />);

        await waitFor(() => expect(window.electron.settings.ai.getAssistants).toHaveBeenCalled());
        fireEvent.click(screen.getByRole("button", {name: "Snapshot: zygomorphic-turquoise"}));

        expect(requestSnapshotSwitch).toHaveBeenCalledWith("zygomorphic-turquoise");
    });

    test.each(["apply", "review"])("%s mode applies the selected-code fix only after authorization", async (mode) => {
        const selection = {
            startLineNumber: 2,
            startColumn: 1,
            endLineNumber: 2,
            endColumn: 31,
        };
        const fullRange = {
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: 3,
            endColumn: 1,
        };

        const initialSource = [
            "function keepThis() {}",
            "const brokenValue = oldThing();",
            "console.log(brokenValue);",
        ].join("\n");

        const selectedCode = "const brokenValue = oldThing();";
        let currentValue = initialSource;

        const model = {
            getLanguageId: jest.fn(() => "typescript"),
            getValue: jest.fn(() => currentValue),
            getValueInRange: jest.fn((range) => {
                if (range === selection) return selectedCode;
                return currentValue;
            }),
            getFullModelRange: jest.fn(() => fullRange),
            pushEditOperations: jest.fn((_, edits) => {
                const [edit] = edits;
                if (edit.range === selection) {
                    currentValue = currentValue.replace(selectedCode, edit.text);
                } else if (edit.range === fullRange) {
                    currentValue = edit.text;
                }
            }),
        };

        const codeEditor = {
            getSelection: jest.fn(() => selection),
            getModel: jest.fn(() => model),
            focus: jest.fn(),
        };

        render(<TestHarness codeEditor={codeEditor} />);

        await waitFor(() => {
            expect(window.electron.settings.ai.getAssistants).toHaveBeenCalled();
        });

        virtualFS.fs.create.mockClear();
        fireEvent.change(screen.getByLabelText("Changes"), {target: {value: mode}});
        fireEvent.change(screen.getByLabelText(/Action/i), { target: { value: "fix" } });
        fireEvent.change(screen.getByLabelText(/Describe the error/i), {
            target: { value: "please fix current problems in code" },
        });
        fireEvent.click(screen.getByRole("button", { name: /Submit/i }));

        await waitFor(() => {
            expect(window.electron.aiCodingAgent.fixCode).toHaveBeenCalled();
        });

        if (mode === "review") {
            const applyButton = await screen.findByRole("button", {name: "Apply proposed changes"});
            expect(currentValue).toBe(initialSource);
            expect(model.pushEditOperations).not.toHaveBeenCalled();
            expect(virtualFS.fs.create).not.toHaveBeenCalled();
            return;
        }

        await waitFor(() => {
            expect(currentValue).toContain("const brokenValue = safeThing();");
        });

        expect(currentValue).toContain("function keepThis() {}");
        expect(currentValue).toContain("console.log(brokenValue);");
        expect(currentValue).not.toContain("const brokenValue = oldThing();");
        expect(model.pushEditOperations).toHaveBeenCalled();
        expect(codeEditor.focus).toHaveBeenCalled();
        expect(virtualFS.fs.create).toHaveBeenCalledTimes(2);
        expect(virtualFS.fs.create.mock.calls[1][0]).toBe("snapshot-1");
        expect(await screen.findByText(/Applied the generated single-file change/i)).toBeTruthy();
        expect(screen.getByText(/Saved a restore point and persisted this result as the current workspace state/i)).toBeTruthy();
    });

    test("falls back to diagnostic smart mode when fix has no selected code or derived workspace target", async () => {
        const model = {
            getLanguageId: jest.fn(() => "typescript"),
            getValue: jest.fn(() => "export default class Plugin {}"),
            getValueInRange: jest.fn(() => ""),
            getFullModelRange: jest.fn(() => ({
                startLineNumber: 1,
                startColumn: 1,
                endLineNumber: 1,
                endColumn: 31,
            })),
        };
        const codeEditor = {
            getSelection: jest.fn(() => ({
                startLineNumber: 1,
                startColumn: 1,
                endLineNumber: 1,
                endColumn: 1,
            })),
            getModel: jest.fn(() => model),
            focus: jest.fn(),
        };

        virtualFS.getLatestContent.mockReturnValue({
            "/index.ts": "export default class Plugin {}",
        });
        virtualFS.build.getHistory.mockImplementation((_, kind) => {
            if (kind === "test") {
                return [{
                    error: true,
                    message: "/Users/alexvwan/dev/fdo/tests/unit/ai-coding-agent-plan-prompt.test.js:3: ReferenceError: describe is not defined",
                    ts: 1710000001000,
                }];
            }
            return [];
        });

        window.electron.aiCodingAgent.smartMode.mockImplementation(async ({ requestId }) => {
            const content = "Diagnostic response";
            Promise.resolve().then(() => {
                streamHandlers.done?.({ requestId, fullContent: content });
            });
            return { success: true, requestId, content };
        });

        render(<TestHarness codeEditor={codeEditor} />);

        await waitFor(() => {
            expect(window.electron.settings.ai.getAssistants).toHaveBeenCalled();
        });

        fireEvent.change(screen.getByLabelText(/Action/i), { target: { value: "fix" } });
        fireEvent.change(screen.getByLabelText(/Describe the error/i), {
            target: { value: "I need you to run tests and fix them.. I also see blank screen when open plugin's page" },
        });
        fireEvent.click(screen.getByRole("button", { name: /Submit/i }));

        await waitFor(() => {
            expect(window.electron.aiCodingAgent.smartMode).toHaveBeenCalled();
        });

        expect(window.electron.aiCodingAgent.fixCode).not.toHaveBeenCalled();
        expect(await screen.findByText("Diagnostic response")).toBeTruthy();
    });

    test("diagnostic smart fallback does not auto-apply into the current file even when auto-apply is enabled", async () => {
        let currentValue = "export default class Plugin {}";
        const model = {
            getLanguageId: jest.fn(() => "typescript"),
            getValue: jest.fn(() => currentValue),
            getValueInRange: jest.fn(() => ""),
            getFullModelRange: jest.fn(() => ({
                startLineNumber: 1,
                startColumn: 1,
                endLineNumber: 1,
                endColumn: 31,
            })),
            pushEditOperations: jest.fn((_, edits) => {
                const [edit] = edits;
                currentValue = edit.text;
            }),
        };
        const codeEditor = {
            getSelection: jest.fn(() => ({
                startLineNumber: 1,
                startColumn: 1,
                endLineNumber: 1,
                endColumn: 1,
            })),
            getModel: jest.fn(() => model),
            focus: jest.fn(),
        };

        virtualFS.getLatestContent.mockReturnValue({
            "/index.ts": currentValue,
        });
        virtualFS.build.getHistory.mockImplementation((_, kind) => {
            if (kind === "test") {
                return [{
                    error: true,
                    message: "/Users/alexvwan/dev/fdo/tests/unit/ai-coding-agent-plan-prompt.test.js:3: ReferenceError: describe is not defined",
                    ts: 1710000001000,
                }];
            }
            return [];
        });

        window.electron.aiCodingAgent.smartMode.mockImplementation(async ({ requestId }) => {
            const content = "```ts\nexport default class Replaced {}\n```";
            Promise.resolve().then(() => {
                streamHandlers.done?.({ requestId, fullContent: content });
            });
            return { success: true, requestId, content };
        });

        render(<TestHarness codeEditor={codeEditor} />);

        await waitFor(() => {
            expect(window.electron.settings.ai.getAssistants).toHaveBeenCalled();
        });

        fireEvent.change(screen.getByLabelText("Changes"), {target: {value: "apply"}});
        fireEvent.change(screen.getByLabelText(/Action/i), { target: { value: "fix" } });
        fireEvent.change(screen.getByLabelText(/Describe the error/i), {
            target: { value: "I need you to run tests and fix them.. I also see blank screen when open plugin's page" },
        });
        fireEvent.click(screen.getByRole("button", { name: /Submit/i }));

        await waitFor(() => {
            expect(window.electron.aiCodingAgent.smartMode).toHaveBeenCalled();
        });

        expect(await screen.findByText(/Diagnostic response|Replaced/)).toBeTruthy();
        expect(model.pushEditOperations).not.toHaveBeenCalled();
        expect(currentValue).toBe("export default class Plugin {}");
        expect(screen.getByRole('button', {name: 'Apply proposed changes'})).toBeTruthy();
    });

    test("test-fix requests do not replace a non-test current file without an explicit test target", async () => {
        let currentValue = "export default class Plugin {}";
        const model = {
            getLanguageId: jest.fn(() => "typescript"),
            getValue: jest.fn(() => currentValue),
            getValueInRange: jest.fn(() => ""),
            getFullModelRange: jest.fn(() => ({
                startLineNumber: 1,
                startColumn: 1,
                endLineNumber: 1,
                endColumn: 31,
            })),
            pushEditOperations: jest.fn((_, edits) => {
                const [edit] = edits;
                currentValue = edit.text;
            }),
        };
        const codeEditor = {
            getSelection: jest.fn(() => ({
                startLineNumber: 1,
                startColumn: 1,
                endLineNumber: 1,
                endColumn: 1,
            })),
            getModel: jest.fn(() => model),
            focus: jest.fn(),
        };

        virtualFS.getLatestContent.mockReturnValue({
            "/index.ts": currentValue,
        });
        virtualFS.build.getHistory.mockImplementation((_, kind) => {
            if (kind === "test") {
                return [{
                    error: true,
                    message: "/tests/unit/plugin.test.ts:3: ReferenceError: describe is not defined",
                    ts: 1710000001000,
                }];
            }
            return [];
        });

        window.electron.aiCodingAgent.smartMode.mockImplementationOnce(async ({ requestId }) => {
            const content = "```ts\nimport PropTypes from \"prop-types\";\nexport default class Replaced {}\n```";
            Promise.resolve().then(() => {
                streamHandlers.done?.({ requestId, fullContent: content });
            });
            return { success: true, requestId, content };
        });

        render(<TestHarness codeEditor={codeEditor} />);

        await waitFor(() => {
            expect(window.electron.settings.ai.getAssistants).toHaveBeenCalled();
        });

        fireEvent.change(screen.getByLabelText("Changes"), {target: {value: "apply"}});
        fireEvent.change(screen.getByLabelText(/Action/i), { target: { value: "fix" } });
        fireEvent.change(screen.getByLabelText(/Describe the error/i), {
            target: { value: "tests are still failing" },
        });
        fireEvent.click(screen.getByRole("button", { name: /Submit/i }));

        await waitFor(() => {
            expect(window.electron.aiCodingAgent.smartMode).toHaveBeenCalled();
        });

        expect(await screen.findByText(/PropTypes/)).toBeTruthy();
        expect(model.pushEditOperations).not.toHaveBeenCalled();
        expect(currentValue).toBe("export default class Plugin {}");
    });

    test("auto-retries a partial fix response and then applies the executable retry", async () => {
        const selection = {
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: 5,
            endColumn: 2,
        };
        const fullRange = {
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: 5,
            endColumn: 2,
        };
        const selectedCode = [
            "function renderPanel() {",
            "  const brokenValue = oldThing();",
            "  const secondValue = anotherThing();",
            "  return brokenValue + secondValue;",
            "}",
        ].join("\n");
        let currentValue = selectedCode;

        const model = {
            getLanguageId: jest.fn(() => "typescript"),
            getValue: jest.fn(() => currentValue),
            getValueInRange: jest.fn(() => selectedCode),
            getFullModelRange: jest.fn(() => fullRange),
            pushEditOperations: jest.fn((_, edits) => {
                const [edit] = edits;
                if (edit.range === selection || edit.range === fullRange) {
                    currentValue = edit.text;
                }
            }),
        };
        const codeEditor = {
            getSelection: jest.fn(() => selection),
            getModel: jest.fn(() => model),
            focus: jest.fn(),
        };

        window.electron.aiCodingAgent.fixCode
            .mockImplementationOnce(async ({ requestId }) => {
                const partialResponse = "```ts\nconst safeValue = fallback();\n```";
                Promise.resolve().then(() => {
                    streamHandlers.done?.({ requestId, fullContent: partialResponse });
                });
                return { success: true, requestId, content: partialResponse };
            })
            .mockImplementationOnce(async ({ requestId }) => {
                const retryResponse = [
                    "```patch",
                    "File: /index.ts",
                    "<<<<<<< SEARCH",
                    "const brokenValue = oldThing();",
                    "=======",
                    "const brokenValue = safeThing();",
                    ">>>>>>> REPLACE",
                    "```",
                ].join("\n");
                Promise.resolve().then(() => {
                    streamHandlers.done?.({ requestId, fullContent: retryResponse });
                });
                return { success: true, requestId, content: retryResponse };
            });

        render(<TestHarness codeEditor={codeEditor} />);

        await waitFor(() => {
            expect(window.electron.settings.ai.getAssistants).toHaveBeenCalled();
        });

        fireEvent.change(screen.getByLabelText("Changes"), {target: {value: "apply"}});
        fireEvent.change(screen.getByLabelText(/Action/i), { target: { value: "fix" } });
        fireEvent.change(screen.getByLabelText(/Describe the error/i), {
            target: { value: "please fix current problems in code" },
        });
        fireEvent.click(screen.getByRole("button", { name: /Submit/i }));

        await waitFor(() => {
            expect(window.electron.aiCodingAgent.fixCode).toHaveBeenCalled();
        });

        await waitFor(() => {
            expect(currentValue).toContain("const brokenValue = safeThing();");
        });

        expect(currentValue).toContain("const secondValue = anotherThing();");
        expect(await screen.findByText(/Applied the generated single-file change/i)).toBeTruthy();
    });

    test("auto-retries partial generated file updates without requiring a selection", async () => {
        const initialFile = [
            "private readonly _metadata: PluginMetadata = {",
            '  name: "undefined",',
            '  version: "1.0.0",',
            "};",
        ].join("\n");
        const rewrittenFile = [
            "private readonly _metadata: PluginMetadata = {",
            '  name: "Test6 Plugin",',
            '  version: "1.0.0",',
            "};",
        ].join("\n");
        let currentValue = initialFile;

        const fullRange = {
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: 4,
            endColumn: 3,
        };
        const model = {
            getLanguageId: jest.fn(() => "typescript"),
            getValue: jest.fn(() => currentValue),
            getValueInRange: jest.fn(() => ""),
            getFullModelRange: jest.fn(() => fullRange),
            pushEditOperations: jest.fn((_, edits) => {
                const [edit] = edits;
                if (edit.range === fullRange) {
                    currentValue = edit.text;
                }
            }),
        };
        const codeEditor = {
            getSelection: jest.fn(() => null),
            getModel: jest.fn(() => model),
            focus: jest.fn(),
        };

        window.electron.aiCodingAgent.generateCode
            .mockImplementationOnce(async ({ requestId }) => {
                const partialResponse = '```ts\nname: "Test6 Plugin"\n```';
                Promise.resolve().then(() => {
                    streamHandlers.done?.({ requestId, fullContent: partialResponse });
                });
                return { success: true, requestId, content: partialResponse };
            })
            .mockImplementationOnce(async ({ requestId }) => {
                const retryResponse = `\`\`\`ts\n${rewrittenFile}\n\`\`\``;
                Promise.resolve().then(() => {
                    streamHandlers.done?.({ requestId, fullContent: retryResponse });
                });
                return { success: true, requestId, content: retryResponse };
            });

        render(<TestHarness codeEditor={codeEditor} />);

        await waitFor(() => {
            expect(window.electron.settings.ai.getAssistants).toHaveBeenCalled();
        });

        fireEvent.change(screen.getByLabelText("Changes"), {target: {value: "apply"}});
        fireEvent.change(screen.getByLabelText(/Action/i), { target: { value: "generate" } });
        fireEvent.change(screen.getByRole("textbox"), {
            target: { value: "can you please make name of plugin from undefined to a better name?" },
        });
        fireEvent.click(screen.getByRole("button", { name: /Submit/i }));

        await waitFor(() => {
            expect(window.electron.aiCodingAgent.generateCode.mock.calls.length).toBeGreaterThanOrEqual(2);
        });

        await waitFor(() => {
            expect(currentValue).toBe(rewrittenFile);
        });

        expect(await screen.findByText(/Applied to \/index\.ts/i)).toBeTruthy();
    });

    test("does not replace the active file with prose-only rename guidance", async () => {
        let currentValue = [
            "export default class Test6 {",
            "  metadata = { name: 'undefined' };",
            "}",
        ].join("\n");

        const fullRange = {
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: 3,
            endColumn: 2,
        };
        const model = {
            getLanguageId: jest.fn(() => "typescript"),
            getValue: jest.fn(() => currentValue),
            getValueInRange: jest.fn(() => ""),
            getFullModelRange: jest.fn(() => fullRange),
            pushEditOperations: jest.fn((_, edits) => {
                const [edit] = edits;
                currentValue = edit.text;
            }),
        };
        const codeEditor = {
            getSelection: jest.fn(() => null),
            getModel: jest.fn(() => model),
            focus: jest.fn(),
        };

        window.electron.aiCodingAgent.generateCode.mockImplementationOnce(async ({ requestId }) => {
            const proseOnly = [
                "I couldn’t make the rename yet because the provided workspace context does not include the plugin’s own source file or metadata file.",
                "",
                "What I found:",
                "- The repo context contains host app files, tests, and SDK docs/examples.",
            ].join("\n");
            Promise.resolve().then(() => {
                streamHandlers.done?.({
                    requestId,
                    fullContent: proseOnly,
                });
            });
            return {
                success: true,
                requestId,
                content: proseOnly,
            };
        });

        render(<TestHarness codeEditor={codeEditor} />);

        await waitFor(() => {
            expect(window.electron.settings.ai.getAssistants).toHaveBeenCalled();
        });

        fireEvent.change(screen.getByLabelText("Changes"), {target: {value: "apply"}});
        fireEvent.change(screen.getByLabelText(/Describe what you want to do/i), {
            target: { value: "please change plugin's name in metadata from undefined to something more useful and meaningful" },
        });
        fireEvent.click(screen.getByRole("button", { name: /Submit/i }));

        await waitFor(() => {
            expect(window.electron.aiCodingAgent.generateCode).toHaveBeenCalled();
        });

        expect(currentValue).toContain("name: 'undefined'");
        expect(screen.queryByText(/Applied to \/index\.ts/i)).toBeNull();
    });

    test("auto-applies metadata getter replacement blocks for plugin rename requests", async () => {
        let currentValue = [
            "export default class Test6 extends FDO_SDK {",
            "    public get metadata(): PluginMetadata {",
            "        return {",
            '            name: "undefined",',
            '            version: "1.0.0",',
            '            author: "AleXvWaN",',
            '            description: "A sample FDO plugin",',
            '            icon: "cog",',
            "        };",
            "    }",
            "}",
        ].join("\n");

        const fullRange = {
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: 11,
            endColumn: 2,
        };
        const model = {
            getLanguageId: jest.fn(() => "typescript"),
            getValue: jest.fn(() => currentValue),
            getValueInRange: jest.fn(() => ""),
            getFullModelRange: jest.fn(() => fullRange),
            pushEditOperations: jest.fn((_, edits) => {
                const [edit] = edits;
                currentValue = edit.text;
            }),
        };
        const codeEditor = {
            getSelection: jest.fn(() => null),
            getModel: jest.fn(() => model),
            focus: jest.fn(),
        };

        window.electron.aiCodingAgent.generateCode.mockImplementationOnce(async ({ requestId }) => {
            const metadataBlockResponse = [
                'Change metadata.name in /index.ts from "undefined" to a real display name, for example "Test6 Sample Plugin".',
                "",
                "// SOLUTION READY TO APPLY",
                "public get metadata(): PluginMetadata {",
                "    return {",
                '        name: "Test6 Sample Plugin",',
                '        version: "1.0.0",',
                '        author: "AleXvWaN",',
                '        description: "A sample FDO plugin",',
                '        icon: "cog",',
                "    };",
                "}",
            ].join("\n");
            Promise.resolve().then(() => {
                streamHandlers.done?.({
                    requestId,
                    fullContent: metadataBlockResponse,
                });
            });
            return {
                success: true,
                requestId,
                content: metadataBlockResponse,
            };
        });

        render(<TestHarness codeEditor={codeEditor} />);

        await waitFor(() => {
            expect(window.electron.settings.ai.getAssistants).toHaveBeenCalled();
        });

        virtualFS.fs.create.mockClear();
        fireEvent.change(screen.getByLabelText("Changes"), {target: {value: "apply"}});
        fireEvent.change(screen.getByLabelText(/Describe what you want to do/i), {
            target: { value: "can you please rename plugin's name in metadata from undefined to something more usefull or meaningful?" },
        });
        fireEvent.click(screen.getByRole("button", { name: /Submit/i }));

        await waitFor(() => {
            expect(currentValue).toContain('name: "Test6 Sample Plugin"');
        });

        expect(currentValue).not.toContain('name: "undefined"');
        expect(virtualFS.fs.create).toHaveBeenCalledTimes(2);
        expect(virtualFS.fs.create.mock.calls[1][0]).toBe("snapshot-1");
        expect(window.electron.aiCodingAgent.routeJudge).not.toHaveBeenCalled();
        expect(window.electron.plugin.getLogTrace).not.toHaveBeenCalled();
        expect(await screen.findByText(/Applied to \/index\.ts/i)).toBeTruthy();
        expect(screen.getByText(/Updated metadata\.name from "undefined" to "Test6 Sample Plugin"/i)).toBeTruthy();
        expect(screen.getByText(/Saved a restore point and persisted this result as the current workspace state/i)).toBeTruthy();
    });

    test("auto-retries as executable workspace files when AI claims multiple file changes", async () => {
        let finishPlan;
        const planCompletion = new Promise(resolve => { finishPlan = resolve; });
        let currentValue = [
            "export default class Test6 extends FDO_SDK {",
            "    public get metadata(): PluginMetadata {",
            "        return {",
            '            name: "Aurora Anvil",',
            '            version: "1.0.0",',
            '            author: "AleXvWaN",',
            '            description: "A sample FDO plugin",',
            '            icon: "cog",',
            "        };",
            "    }",
            "}",
        ].join("\n");

        const fullRange = {
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: 11,
            endColumn: 2,
        };
        const model = {
            getLanguageId: jest.fn(() => "typescript"),
            getValue: jest.fn(() => currentValue),
            getValueInRange: jest.fn(() => ""),
            getFullModelRange: jest.fn(() => fullRange),
            pushEditOperations: jest.fn((_, edits) => {
                const [edit] = edits;
                currentValue = edit.text;
            }),
        };
        const codeEditor = {
            getSelection: jest.fn(() => null),
            getModel: jest.fn(() => model),
            focus: jest.fn(),
        };

        virtualFS.getLatestContent.mockReturnValue({
            "/index.ts": currentValue,
            "/render.tsx": "export default function Render() { return <h1>My Plugin</h1>; }",
        });
        virtualFS.createFile = jest.fn();
        virtualFS.createFolder = jest.fn();

        window.electron.aiCodingAgent.smartMode.mockImplementationOnce(async ({ requestId }) => {
            const responseText = [
                "Changed the plugin branding from Aurora Anvil to a more distinctive name: Quasar Quill.",
                "",
                "What changed:",
                "",
                "In /index.ts, metadata.name now uses Quasar Quill.",
                "In /render.tsx, the visible heading now matches the new plugin name instead of My Plugin.",
                "",
                "// SOLUTION READY TO APPLY",
                "public get metadata(): PluginMetadata {",
                "    return {",
                '        name: "Quasar Quill",',
                '        version: "1.0.0",',
                '        author: "AleXvWaN",',
                '        description: "A sample FDO plugin",',
                '        icon: "cog",',
                "    };",
                "}",
            ].join("\n");
            Promise.resolve().then(() => {
                streamHandlers.done?.({
                    requestId,
                    fullContent: responseText,
                });
            });
            return {
                success: true,
                requestId,
                content: responseText,
            };
        });
        window.electron.aiCodingAgent.planCode.mockImplementationOnce(async ({ requestId, prompt }) => {
            expect(prompt).toContain("/index.ts, /render.tsx");
            const responseText = [
                "### File: /index.ts",
                "```typescript",
                "export default class Test6 extends FDO_SDK {",
                "    public get metadata(): PluginMetadata {",
                "        return {",
                '            name: "Quasar Quill",',
                '            version: "1.0.0",',
                '            author: "AleXvWaN",',
                '            description: "A sample FDO plugin",',
                '            icon: "cog",',
                "        };",
                "    }",
                "}",
                "new Test6();",
                "```",
                "",
                "### File: /render.tsx",
                "```tsx",
                "export default function Render() {",
                "  return <h1>Quasar Quill</h1>;",
                "}",
                "```",
            ].join("\n");
            Promise.resolve().then(() => {
                streamHandlers.done?.({
                    requestId,
                    fullContent: responseText,
                });
            });
            await planCompletion;
            return {
                success: true,
                requestId,
                content: responseText,
            };
        });

        render(<TestHarness codeEditor={codeEditor} />);

        await waitFor(() => {
            expect(window.electron.settings.ai.getAssistants).toHaveBeenCalled();
        });

        fireEvent.change(screen.getByLabelText("Changes"), {target: {value: "apply"}});
        fireEvent.change(screen.getByLabelText(/Describe what you want to do/i), {
            target: { value: "please change plugin's name to something more creative" },
        });
        fireEvent.click(screen.getByRole("button", { name: /Submit/i }));

        await waitFor(() => {
            expect(window.electron.aiCodingAgent.planCode).toHaveBeenCalledTimes(1);
        });
        expect(screen.getByRole("button", {name: /Stop/i})).toBeTruthy();
        expect(screen.getByTestId("ai-coding-request-progress")).toHaveTextContent("Correcting generated code · attempt 2");
        expect(screen.getByTestId("ai-coding-request-progress")).toHaveTextContent(/elapsed/);
        expect(window.electron.plugin.getRuntimeStatus).not.toHaveBeenCalled();
        expect(window.electron.plugin.init).not.toHaveBeenCalled();
        expect(window.electron.plugin.render).not.toHaveBeenCalled();
        finishPlan();

        await waitFor(() => {
            expect(currentValue).toContain('name: "Quasar Quill"');
        });

        await waitFor(() => {
            expect(window.electron.aiCodingAgent.planCode).toHaveBeenCalledTimes(1);
        });
        expect(virtualFS.createFile).toHaveBeenCalledWith("/render.tsx", expect.anything(), undefined);
        expect(await screen.findByText(/Workspace Updated/i)).toBeTruthy();
        expect(screen.getByText(/Applied 2 workspace file\(s\) automatically/i)).toBeTruthy();
    });

    test("auto-apply helper text explains restore point and saved current state", async () => {
        const model = {
            getLanguageId: jest.fn(() => "typescript"),
            getValue: jest.fn(() => "export default class Plugin {}"),
            getValueInRange: jest.fn(() => ""),
            getFullModelRange: jest.fn(() => ({
                startLineNumber: 1,
                startColumn: 1,
                endLineNumber: 1,
                endColumn: 31,
            })),
            pushEditOperations: jest.fn(),
        };

        const codeEditor = {
            getSelection: jest.fn(() => null),
            getModel: jest.fn(() => model),
            focus: jest.fn(),
        };

        render(<TestHarness codeEditor={codeEditor} />);

        await waitFor(() => {
            expect(window.electron.settings.ai.getAssistants).toHaveBeenCalled();
        });

        expect(screen.getByLabelText("Changes").value).toBe("apply");
        fireEvent.change(screen.getByLabelText("Changes"), {target: {value: "apply"}});

        expect(screen.getByText(/applied and saved with a restore point/i)).toBeTruthy();
        fireEvent.change(screen.getByLabelText("Changes"), {target: {value: "review"}});
        expect(screen.getByText(/workspace stays unchanged until you apply/i)).toBeTruthy();
    });

    test("routes metadata rename smart prompts to /index.ts as the target file", async () => {
        const indexSource = [
            "export default class Test6 extends FDO_SDK {",
            "    public get metadata(): PluginMetadata {",
            "        return {",
            '            name: "undefined",',
            '            version: "1.0.0",',
            '            author: "AleXvWaN",',
            '            description: "A sample FDO plugin",',
            '            icon: "cog",',
            "        };",
            "    }",
            "}",
        ].join("\n");
        const model = {
            getLanguageId: jest.fn(() => "typescript"),
            getValue: jest.fn(() => "export const render = () => null;"),
            getValueInRange: jest.fn(() => ""),
            getFullModelRange: jest.fn(() => ({
                startLineNumber: 1,
                startColumn: 1,
                endLineNumber: 1,
                endColumn: 34,
            })),
            pushEditOperations: jest.fn(),
        };
        const codeEditor = {
            getSelection: jest.fn(() => null),
            getModel: jest.fn(() => model),
            focus: jest.fn(),
        };

        virtualFS.getFileName = jest.fn(() => "/render.tsx");
        virtualFS.getLatestContent.mockReturnValue({
            "/index.ts": indexSource,
            "/render.tsx": "export const render = () => null;",
        });

        window.electron.aiCodingAgent.generateCode.mockImplementationOnce(async ({ requestId }) => {
            const metadataBlockResponse = [
                'Update /index.ts so metadata.name is no longer "undefined".',
                "",
                "// SOLUTION READY TO APPLY",
                "public get metadata(): PluginMetadata {",
                "    return {",
                '        name: "Test 6",',
                '        version: "1.0.0",',
                '        author: "AleXvWaN",',
                '        description: "A sample FDO plugin",',
                '        icon: "cog",',
                "    };",
                "}",
            ].join("\n");
            Promise.resolve().then(() => {
                streamHandlers.done?.({
                    requestId,
                    fullContent: metadataBlockResponse,
                });
            });
            return {
                success: true,
                requestId,
                content: metadataBlockResponse,
            };
        });

        render(<TestHarness codeEditor={codeEditor} />);

        await waitFor(() => {
            expect(window.electron.settings.ai.getAssistants).toHaveBeenCalled();
        });

        fireEvent.change(screen.getByLabelText("Changes"), {target: {value: "apply"}});
        fireEvent.change(screen.getByLabelText(/Describe what you want to do/i), {
            target: { value: "can you please rename plugin's name in metadata from undefined to something more usefull or meaningful?" },
        });
        fireEvent.click(screen.getByRole("button", { name: /Submit/i }));

        await waitFor(() => {
            expect(window.electron.aiCodingAgent.generateCode).toHaveBeenCalled();
        });

        expect(virtualFS.setFileContent).toHaveBeenCalledWith(
            "/index.ts",
            expect.stringContaining('name: "Test 6"'),
        );
        expect(model.pushEditOperations).not.toHaveBeenCalled();
    });

    test("does not silently over-apply ambiguous test patches", async () => {
        const selection = {
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: 8,
            endColumn: 2,
        };
        const fullRange = {
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: 8,
            endColumn: 2,
        };
        const initialFile = [
            'describe("suite", () => {',
            '  test("one", () => {',
            '    expect(true).toBe(true);',
            '  });',
            '  test("two", () => {',
            '    expect(true).toBe(true);',
            '  });',
            '});',
        ].join("\n");
        let currentValue = initialFile;

        const model = {
            uri: { path: "/tests/unit/plugin.test.ts" },
            getLanguageId: jest.fn(() => "typescript"),
            getValue: jest.fn(() => currentValue),
            getValueInRange: jest.fn(() => initialFile),
            getFullModelRange: jest.fn(() => fullRange),
            pushEditOperations: jest.fn((_, edits) => {
                const [edit] = edits;
                if (edit.range === selection || edit.range === fullRange) {
                    currentValue = edit.text;
                }
            }),
        };
        const codeEditor = {
            getSelection: jest.fn(() => selection),
            getModel: jest.fn(() => model),
            focus: jest.fn(),
        };
        virtualFS.getFileName = jest.fn(() => "/tests/unit/plugin.test.ts");
        virtualFS.getLatestContent.mockReturnValue({
            "/tests/unit/plugin.test.ts": initialFile,
        });

        window.electron.aiCodingAgent.fixCode.mockImplementationOnce(async ({ requestId }) => {
            const ambiguousPatch = [
                "```patch",
                "File: /tests/unit/plugin.test.ts",
                "<<<<<<< SEARCH",
                "expect(true).toBe(true);",
                "=======",
                "assert.equal(true, true);",
                ">>>>>>> REPLACE",
                "```",
            ].join("\n");
            Promise.resolve().then(() => {
                streamHandlers.done?.({ requestId, fullContent: ambiguousPatch });
            });
            return { success: true, requestId, content: ambiguousPatch };
        });

        render(<TestHarness codeEditor={codeEditor} />);

        await waitFor(() => {
            expect(window.electron.settings.ai.getAssistants).toHaveBeenCalled();
        });

        fireEvent.change(screen.getByLabelText("Changes"), {target: {value: "apply"}});
        fireEvent.change(screen.getByLabelText(/Action/i), { target: { value: "fix" } });
        fireEvent.change(screen.getByLabelText(/Describe the error/i), {
            target: { value: "please fix tests issue" },
        });
        fireEvent.click(screen.getByRole("button", { name: /Submit/i }));

        await waitFor(() => {
            expect(window.electron.aiCodingAgent.fixCode).toHaveBeenCalledTimes(2);
        });

        expect(currentValue).toBe(initialFile);
        expect(screen.queryByText(/Applied the generated single-file change/i)).toBeNull();
    });

    test("uses the failing test file as the fix target when no code is selected", async () => {
        const failingTestFile = "/tests/unit/plugin.test.ts";
        const failingTestSource = [
            'describe("plugin", () => {',
            '  test("works", () => {',
            '    expect(true).toBe(true);',
            '  });',
            '});',
        ].join("\n");

        virtualFS.getLatestContent.mockReturnValue({
            [failingTestFile]: failingTestSource,
        });
        virtualFS.build.getHistory
            .mockImplementation((_, kind) => kind === "test"
                ? [{ error: true, ts: Date.now(), message: "ReferenceError in /tests/unit/plugin.test.ts: describe is not defined" }]
                : []);

        const codeEditor = {
            getSelection: jest.fn(() => null),
            getModel: jest.fn(() => ({
                getLanguageId: jest.fn(() => "typescript"),
                getValue: jest.fn(() => "export {};"),
                getValueInRange: jest.fn(() => ""),
                getFullModelRange: jest.fn(() => ({
                    startLineNumber: 1,
                    startColumn: 1,
                    endLineNumber: 1,
                    endColumn: 10,
                })),
            })),
            focus: jest.fn(),
        };

        window.electron.aiCodingAgent.fixCode.mockImplementationOnce(async ({ requestId, code }) => {
            expect(code).toBe(failingTestSource);
            const rewrittenFile = [
                'import { describe, test } from "node:test";',
                'import assert from "node:assert/strict";',
                '',
                'describe("plugin", () => {',
                '  test("works", () => {',
                '    assert.equal(true, true);',
                '  });',
                '});',
            ].join("\n");
            const response = `\`\`\`ts\n${rewrittenFile}\n\`\`\``;
            Promise.resolve().then(() => {
                streamHandlers.done?.({ requestId, fullContent: response });
            });
            return { success: true, requestId, content: response };
        });

        render(<TestHarness codeEditor={codeEditor} />);

        await waitFor(() => {
            expect(window.electron.settings.ai.getAssistants).toHaveBeenCalled();
        });

        fireEvent.change(screen.getByLabelText("Changes"), {target: {value: "apply"}});
        fireEvent.change(screen.getByLabelText(/Action/i), { target: { value: "fix" } });
        fireEvent.change(screen.getByLabelText(/Describe the error/i), {
            target: { value: "please fix tests issue" },
        });
        fireEvent.click(screen.getByRole("button", { name: /Submit/i }));

        await waitFor(() => {
            expect(window.electron.aiCodingAgent.fixCode).toHaveBeenCalledTimes(1);
        });

        expect(screen.queryByText(/Please select code to fix/i)).toBeNull();
    });

    test("runs tests first, applies a fix, and reruns tests until they pass", async () => {
        const failingTestFile = "/tests/unit/plugin.test.ts";
        const failingTestSource = [
            'describe("plugin", () => {',
            '  test("works", () => {',
            '    expect(true).toBe(true);',
            '  });',
            '});',
        ].join("\n");

        virtualFS.getLatestContent.mockReturnValue({
            [failingTestFile]: failingTestSource,
        });
        virtualFS.build.getHistory.mockImplementation((_, kind) => kind === "test"
            ? [{ error: true, ts: Date.now(), message: "ReferenceError in /tests/unit/plugin.test.ts: describe is not defined" }]
            : []);
        runPluginTests
            .mockResolvedValueOnce({
                success: false,
                skipped: false,
                error: "Plugin tests failed with exit code 1.",
                output: "ReferenceError in /tests/unit/plugin.test.ts: describe is not defined",
            })
            .mockResolvedValueOnce({
                success: true,
                skipped: false,
                output: "Plugin tests passed.",
            });
        runPluginTests
            .mockResolvedValueOnce({
                success: false,
                skipped: false,
                error: "Plugin tests failed with exit code 1.",
                output: "ReferenceError in /tests/unit/plugin.test.ts: describe is not defined",
            })
            .mockResolvedValueOnce({
                success: true,
                skipped: false,
                output: "Plugin tests passed.",
            });

        const codeEditor = {
            getSelection: jest.fn(() => null),
            getModel: jest.fn(() => ({
                getLanguageId: jest.fn(() => "typescript"),
                getValue: jest.fn(() => "export {};"),
                getValueInRange: jest.fn(() => ""),
                getFullModelRange: jest.fn(() => ({
                    startLineNumber: 1,
                    startColumn: 1,
                    endLineNumber: 1,
                    endColumn: 10,
                })),
            })),
            focus: jest.fn(),
        };

        window.electron.aiCodingAgent.fixCode.mockImplementationOnce(async ({ requestId, code }) => {
            expect(code).toBe(failingTestSource);
            const rewrittenFile = [
                'import { describe, test } from "node:test";',
                'import assert from "node:assert/strict";',
                '',
                'describe("plugin", () => {',
                '  test("works", () => {',
                '    assert.equal(true, true);',
                '  });',
                '});',
            ].join("\n");
            const response = `\`\`\`ts\n${rewrittenFile}\n\`\`\``;
            Promise.resolve().then(() => {
                streamHandlers.done?.({ requestId, fullContent: response });
            });
            return { success: true, requestId, content: response };
        });

        render(<TestHarness codeEditor={codeEditor} />);

        await waitFor(() => {
            expect(window.electron.settings.ai.getAssistants).toHaveBeenCalled();
        });

        fireEvent.change(screen.getByLabelText("Changes"), {target: {value: "apply"}});
        fireEvent.change(screen.getByLabelText(/Action/i), { target: { value: "smart" } });
        fireEvent.change(screen.getByLabelText(/Describe what you want to do/i), {
            target: { value: "please run tests and investigate errors" },
        });
        fireEvent.click(screen.getByRole("button", { name: /Submit/i }));

        await waitFor(() => {
            expect(runPluginTests).toHaveBeenCalledTimes(2);
        });

        await waitFor(() => {
            expect(window.electron.aiCodingAgent.fixCode).toHaveBeenCalledTimes(1);
        });

        await waitFor(() => {
            expect(screen.getByText(/Plugin tests passed after 1 repair attempt/i)).toBeTruthy();
        });

        expect(screen.queryByText(/Please select code to fix/i)).toBeNull();
    });

    test("keeps iterating test repairs across multiple attempts until tests pass", async () => {
        const failingTestFile = "/tests/unit/plugin.test.ts";
        const firstFailingSource = [
            'describe("plugin", () => {',
            '  test("works", () => {',
            '    expect(true).toBe(true);',
            '  });',
            '});',
        ].join("\n");
        const secondFailingSource = [
            'import { describe, test } from "node:test";',
            '',
            'describe("plugin", () => {',
            '  test("works", () => {',
            '    expect(true).toBe(true);',
            '  });',
            '});',
        ].join("\n");

        let workspaceContent = {
            [failingTestFile]: firstFailingSource,
        };

        virtualFS.getLatestContent.mockImplementation(() => workspaceContent);
        virtualFS.setFileContent.mockImplementation((path, content) => {
            workspaceContent = {
                ...workspaceContent,
                [path]: content,
            };
        });
        virtualFS.build.getHistory.mockImplementation((_, kind) => kind === "test"
            ? [{ error: true, ts: Date.now(), message: "ReferenceError in /tests/unit/plugin.test.ts: describe is not defined" }]
            : []);
        runPluginTests
            .mockResolvedValueOnce({
                success: false,
                skipped: false,
                error: "Plugin tests failed with exit code 1.",
                output: "ReferenceError in /tests/unit/plugin.test.ts: describe is not defined",
            })
            .mockResolvedValueOnce({
                success: false,
                skipped: false,
                error: "Plugin tests failed with exit code 1.",
                output: "AssertionError in /tests/unit/plugin.test.ts: expect is not defined",
            })
            .mockResolvedValueOnce({
                success: true,
                skipped: false,
                output: "Plugin tests passed.",
            });

        const codeEditor = {
            getSelection: jest.fn(() => null),
            getModel: jest.fn(() => ({
                getLanguageId: jest.fn(() => "typescript"),
                getValue: jest.fn(() => "export {};"),
                getValueInRange: jest.fn(() => ""),
                getFullModelRange: jest.fn(() => ({
                    startLineNumber: 1,
                    startColumn: 1,
                    endLineNumber: 1,
                    endColumn: 10,
                })),
            })),
            focus: jest.fn(),
        };

        window.electron.aiCodingAgent.fixCode
            .mockImplementationOnce(async ({ requestId, code, targetFilePath }) => {
                expect(code).toBe(firstFailingSource);
                expect(targetFilePath).toBe(failingTestFile);
                const response = [
                    "```ts",
                    'import { describe, test } from "node:test";',
                    '',
                    'describe("plugin", () => {',
                    '  test("works", () => {',
                    '    expect(true).toBe(true);',
                    '  });',
                    '});',
                    "```",
                ].join("\n");
                Promise.resolve().then(() => {
                    streamHandlers.done?.({ requestId, fullContent: response });
                });
                return { success: true, requestId, content: response };
            })
            .mockImplementationOnce(async ({ requestId, code, targetFilePath }) => {
                expect(code).toBe(secondFailingSource);
                expect(targetFilePath).toBe(failingTestFile);
                const response = [
                    "```ts",
                    'import { describe, test } from "node:test";',
                    'import assert from "node:assert/strict";',
                    '',
                    'describe("plugin", () => {',
                    '  test("works", () => {',
                    '    assert.equal(true, true);',
                    '  });',
                    '});',
                    "```",
                ].join("\n");
                Promise.resolve().then(() => {
                    streamHandlers.done?.({ requestId, fullContent: response });
                });
                return { success: true, requestId, content: response };
            });

        render(<TestHarness codeEditor={codeEditor} />);

        await waitFor(() => {
            expect(window.electron.settings.ai.getAssistants).toHaveBeenCalled();
        });

        fireEvent.change(screen.getByLabelText("Changes"), {target: {value: "apply"}});
        fireEvent.change(screen.getByLabelText(/Action/i), { target: { value: "smart" } });
        fireEvent.change(screen.getByLabelText(/Describe what you want to do/i), {
            target: { value: "please run tests and fix errors if any exists" },
        });
        fireEvent.click(screen.getByRole("button", { name: /Submit/i }));

        await waitFor(() => {
            expect(runPluginTests).toHaveBeenCalledTimes(3);
        });

        await waitFor(() => {
            expect(window.electron.aiCodingAgent.fixCode.mock.calls.length).toBeGreaterThanOrEqual(1);
        });

        await waitFor(() => {
            expect(virtualFS.setFileContent).toHaveBeenCalledWith(
                failingTestFile,
                expect.stringContaining('import assert from "node:assert/strict";'),
            );
        });
    });

    test("retries test-driven fix requests when the first patch does not match the failing file", async () => {
        const failingTestFile = "/tests/unit/plugin.test.ts";
        const failingTestSource = [
            'describe("plugin", () => {',
            '  test("works", () => {',
            '    expect(true).toBe(true);',
            '  });',
            '});',
        ].join("\n");
        const rewrittenFile = [
            'import { describe, test } from "node:test";',
            'import assert from "node:assert/strict";',
            '',
            'describe("plugin", () => {',
            '  test("works", () => {',
            '    assert.equal(true, true);',
            '  });',
            '});',
        ].join("\n");

        virtualFS.getLatestContent.mockReturnValue({
            [failingTestFile]: failingTestSource,
            "/index.ts": "export {};",
        });
        virtualFS.setFileContent.mockClear();
        virtualFS.build.getHistory.mockImplementation((_, kind) => kind === "test"
            ? [{ error: true, ts: Date.now(), message: "ReferenceError in /tests/unit/plugin.test.ts: describe is not defined" }]
            : []);

        const codeEditor = {
            getSelection: jest.fn(() => null),
            getModel: jest.fn(() => ({
                getLanguageId: jest.fn(() => "typescript"),
                getValue: jest.fn(() => "export {};"),
                getValueInRange: jest.fn(() => ""),
                getFullModelRange: jest.fn(() => ({
                    startLineNumber: 1,
                    startColumn: 1,
                    endLineNumber: 1,
                    endColumn: 10,
                })),
            })),
            focus: jest.fn(),
        };
        virtualFS.getFileName = jest.fn(() => "/index.ts");

        window.electron.aiCodingAgent.fixCode
            .mockImplementationOnce(async ({ requestId, code }) => {
                expect(code).toBe(failingTestSource);
                const badPatch = [
                    "```patch",
                    `File: ${failingTestFile}`,
                    "<<<<<<< SEARCH",
                    "expect(false).toBe(false);",
                    "=======",
                    "assert.equal(true, true);",
                    ">>>>>>> REPLACE",
                    "```",
                ].join("\n");
                Promise.resolve().then(() => {
                    streamHandlers.done?.({ requestId, fullContent: badPatch });
                });
                return { success: true, requestId, content: badPatch };
            })
            .mockImplementationOnce(async ({ requestId, error }) => {
                expect(error).toMatch(/did not apply cleanly|did not match/i);
                const response = `\`\`\`ts\n${rewrittenFile}\n\`\`\``;
                Promise.resolve().then(() => {
                    streamHandlers.done?.({ requestId, fullContent: response });
                });
                return { success: true, requestId, content: response };
            });

        render(<TestHarness codeEditor={codeEditor} />);

        await waitFor(() => {
            expect(window.electron.settings.ai.getAssistants).toHaveBeenCalled();
        });

        fireEvent.change(screen.getByLabelText("Changes"), {target: {value: "apply"}});
        fireEvent.change(screen.getByLabelText(/Action/i), { target: { value: "smart" } });
        fireEvent.change(screen.getByLabelText(/Describe what you want to do/i), {
            target: { value: "please run tests and fix errors if any exists" },
        });
        fireEvent.click(screen.getByRole("button", { name: /Submit/i }));

        await waitFor(() => {
            expect(window.electron.aiCodingAgent.fixCode.mock.calls.length).toBeGreaterThanOrEqual(2);
        });

        await waitFor(() => {
            expect(virtualFS.setFileContent).toHaveBeenCalledWith(failingTestFile, rewrittenFile);
        });
    });

    test("applies file-targeted patch blocks to the referenced workspace file", async () => {
        const failingTestFile = "/tests/unit/plugin.test.ts";
        const failingTestSource = [
            'describe("plugin", () => {',
            '  test("works", () => {',
            '    expect(true).toBe(true);',
            '  });',
            '});',
        ].join("\n");

        virtualFS.getLatestContent.mockReturnValue({
            [failingTestFile]: failingTestSource,
            "/index.ts": "export {};",
        });
        virtualFS.setFileContent.mockClear();

        const model = {
            getLanguageId: jest.fn(() => "typescript"),
            getValue: jest.fn(() => "export {};"),
            getValueInRange: jest.fn(() => ""),
            getFullModelRange: jest.fn(() => ({
                startLineNumber: 1,
                startColumn: 1,
                endLineNumber: 1,
                endColumn: 10,
            })),
            pushEditOperations: jest.fn(),
        };
        const codeEditor = {
            getSelection: jest.fn(() => null),
            getModel: jest.fn(() => model),
            focus: jest.fn(),
        };
        virtualFS.getFileName = jest.fn(() => "/index.ts");

        window.electron.aiCodingAgent.fixCode.mockImplementationOnce(async ({ requestId }) => {
            const patchResponse = [
                "```patch",
                `File: ${failingTestFile}`,
                "<<<<<<< SEARCH",
                "expect(true).toBe(true);",
                "=======",
                "assert.equal(true, true);",
                ">>>>>>> REPLACE",
                "```",
            ].join("\n");
            Promise.resolve().then(() => {
                streamHandlers.done?.({ requestId, fullContent: patchResponse });
            });
            return { success: true, requestId, content: patchResponse };
        });

        render(<TestHarness codeEditor={codeEditor} />);

        await waitFor(() => {
            expect(window.electron.settings.ai.getAssistants).toHaveBeenCalled();
        });

        fireEvent.change(screen.getByLabelText("Changes"), {target: {value: "apply"}});
        fireEvent.change(screen.getByLabelText(/Action/i), { target: { value: "fix" } });
        fireEvent.change(screen.getByLabelText(/Describe the error/i), {
            target: { value: "please fix tests issue" },
        });
        fireEvent.click(screen.getByRole("button", { name: /Submit/i }));

        await waitFor(() => {
            expect(virtualFS.setFileContent).toHaveBeenCalledWith(
                failingTestFile,
                [
                    'describe("plugin", () => {',
                    '  test("works", () => {',
                    '    assert.equal(true, true);',
                    '  });',
                    '});',
                ].join("\n")
            );
        });

        expect(model.pushEditOperations).not.toHaveBeenCalled();
    });

    test("supports keyboard shortcuts for submit and auto-apply toggle", async () => {
        const isMacPlatform = navigator.platform?.toLowerCase?.().includes("mac");
        const codeEditor = {
            getSelection: jest.fn(() => ({
                startLineNumber: 1,
                startColumn: 1,
                endLineNumber: 1,
                endColumn: 17,
            })),
            getModel: jest.fn(() => ({
                getLanguageId: jest.fn(() => "typescript"),
                getValue: jest.fn(() => "const value = 1;"),
                getValueInRange: jest.fn(() => "const value = 1;"),
                getFullModelRange: jest.fn(() => ({
                    startLineNumber: 1,
                    startColumn: 1,
                    endLineNumber: 1,
                    endColumn: 17,
                })),
                pushEditOperations: jest.fn(),
                uri: { toString: () => "file:///index.ts", toString: () => "file:///index.ts" },
            })),
            focus: jest.fn(),
        };

        render(<TestHarness codeEditor={codeEditor} />);

        await waitFor(() => {
            expect(window.electron.settings.ai.getAssistants).toHaveBeenCalled();
        });

        fireEvent.change(screen.getByLabelText(/Action/i), { target: { value: "fix" } });
        const promptInput = screen.getByLabelText(/Describe the error/i);
        fireEvent.change(promptInput, { target: { value: "please fix current problems in code" } });

        fireEvent.keyDown(promptInput, isMacPlatform
            ? { key: "A", metaKey: true, shiftKey: true }
            : { key: "a", altKey: true });
        expect(screen.getByLabelText("Changes").value).toBe("review");

        fireEvent.keyDown(promptInput, isMacPlatform
            ? { key: "Enter", metaKey: true }
            : { key: "Enter", ctrlKey: true });

        await waitFor(() => {
            expect(window.electron.aiCodingAgent.fixCode).toHaveBeenCalled();
        });
    });

    test("shows @workspace suggestions and inserts the selected file path", async () => {
        virtualFS.getLatestContent.mockReturnValue({
            "/README.md": "# Readme",
            "/src/index.ts": "export {};",
        });

        const codeEditor = {
            getSelection: jest.fn(() => null),
            getModel: jest.fn(() => ({
                getLanguageId: jest.fn(() => "typescript"),
                getValue: jest.fn(() => "export {};"),
                getValueInRange: jest.fn(() => ""),
            })),
            focus: jest.fn(),
        };

        render(<TestHarness codeEditor={codeEditor} />);

        await waitFor(() => {
            expect(window.electron.settings.ai.getAssistants).toHaveBeenCalled();
        });

        const promptInput = screen.getByLabelText(/Describe what you want to do/i);
        fireEvent.change(promptInput, { target: { value: "please inspect @rea", selectionStart: 19 } });

        expect(await screen.findByRole("listbox", { name: /Workspace file suggestions/i })).toBeTruthy();
        expect(screen.getByRole("option", { name: /README\.md/i })).toBeTruthy();

        fireEvent.keyDown(promptInput, { key: "Enter" });

        await waitFor(() => {
            expect(promptInput.value).toBe("please inspect @README.md ");
        });
    });

    test("shows synthetic @thisFile suggestions for the current editor file", async () => {
        virtualFS.getLatestContent.mockReturnValue({
            "/README.md": "# Readme",
            "/src/index.ts": "export {};",
        });

        const currentModel = {
            getLanguageId: jest.fn(() => "typescript"),
            getValue: jest.fn(() => "export {};"),
            getValueInRange: jest.fn(() => ""),
        };
        const codeEditor = {
            getSelection: jest.fn(() => null),
            getModel: jest.fn(() => currentModel),
            focus: jest.fn(),
        };
        virtualFS.getFileName = jest.fn(() => "/src/index.ts");

        render(<TestHarness codeEditor={codeEditor} />);

        await waitFor(() => {
            expect(window.electron.settings.ai.getAssistants).toHaveBeenCalled();
        });

        const promptInput = screen.getByLabelText(/Describe what you want to do/i);
        fireEvent.change(promptInput, { target: { value: "check @fi", selectionStart: 9 } });

        expect(await screen.findByRole("option", { name: /@file:/i })).toBeTruthy();
        expect(screen.getByRole("option", { name: /@thisFile/i })).toBeTruthy();
    });

    test("workspace suggestions do not leak host app source paths", async () => {
        virtualFS.getLatestContent.mockReturnValue({
            "/index.ts": "export {};",
            "/tests/unit/plugin.test.ts": "test();",
        });

        const codeEditor = {
            getSelection: jest.fn(() => null),
            getModel: jest.fn(() => ({
                getLanguageId: jest.fn(() => "typescript"),
                getValue: jest.fn(() => "export {};"),
                getValueInRange: jest.fn(() => ""),
            })),
            focus: jest.fn(),
        };

        render(<TestHarness codeEditor={codeEditor} />);

        await waitFor(() => {
            expect(window.electron.settings.ai.getAssistants).toHaveBeenCalled();
        });

        const promptInput = screen.getByLabelText(/Describe what you want to do/i);
        fireEvent.change(promptInput, { target: { value: "fix @te", selectionStart: 7 } });

        expect(await screen.findByRole("option", { name: /plugin\.test\.ts/i })).toBeTruthy();
        expect(screen.queryByRole("option", { name: /src\/components/i })).toBeNull();
    });

    test("refine response focuses the prompt for immediate follow-up", async () => {
        const codeEditor = {
            getSelection: jest.fn(() => null),
            getModel: jest.fn(() => ({
                getLanguageId: jest.fn(() => "typescript"),
                getValue: jest.fn(() => "export {};"),
                getValueInRange: jest.fn(() => ""),
            })),
            focus: jest.fn(),
        };

        render(<TestHarness codeEditor={codeEditor} />);

        await waitFor(() => {
            expect(window.electron.settings.ai.getAssistants).toHaveBeenCalled();
        });

        window.electron.aiCodingAgent.smartMode.mockImplementationOnce(async ({ requestId }) => {
            const content = "Update /index.ts to improve plugin metadata naming.";
            Promise.resolve().then(() => {
                streamHandlers.done?.({
                    requestId,
                    fullContent: content,
                });
            });
            return {
                success: true,
                requestId,
                content,
            };
        });

        fireEvent.change(screen.getByLabelText(/Describe what you want to do/i), {
            target: { value: "please improve plugin metadata name" },
        });
        fireEvent.click(screen.getByRole("button", { name: /Submit/i }));

        await screen.findByText(/Update \/index\.ts to improve plugin metadata naming/i);

        const promptInput = screen.getByRole("textbox");
        fireEvent.blur(promptInput);
        fireEvent.click(screen.getByRole("button", { name: /Refine Response/i }));

        await waitFor(() => {
            expect(document.activeElement).toBe(promptInput);
        });
        expect(screen.getByLabelText(/Continue or refine the current AI coding thread/i)).toBe(promptInput);
    });

    test("keeps a truncated reply and prepares a complete retry instead of applying partial code", async () => {
        const codeEditor = {
            getSelection: jest.fn(() => null),
            getModel: jest.fn(() => ({
                getLanguageId: jest.fn(() => "typescript"),
                getValue: jest.fn(() => "export {};"),
                getValueInRange: jest.fn(() => ""),
            })),
        };
        const providerError = "Assistant stream response.incomplete: max_output_tokens";

        window.electron.aiCodingAgent.smartMode.mockImplementationOnce(async ({requestId}) => {
            Promise.resolve().then(() => {
                streamHandlers.delta?.({requestId, content: "File: /index.ts\nexport default class JsonInspector"});
                streamHandlers.error?.({requestId, error: providerError});
            });
            return {success: false, requestId, error: providerError};
        });

        render(<TestHarness codeEditor={codeEditor} />);
        await waitFor(() => {
            expect(window.electron.settings.ai.getAssistants).toHaveBeenCalled();
        });

        fireEvent.change(screen.getByLabelText(/Describe what you want to do/i), {
            target: {value: "Build a JSON Inspector plugin"},
        });
        fireEvent.click(screen.getByRole("button", {name: /Submit/i}));

        expect(await screen.findByText(/assistant reached its response limit/i)).toBeTruthy();
        expect(screen.getByTestId("ai-coding-response")).toHaveTextContent("JsonInspector");
        expect(virtualFS.createFile).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole("button", {name: /Retry as complete response/i}));
        const promptInput = screen.getByLabelText(/Continue or refine the current AI coding thread/i);
        await waitFor(() => {
            expect(promptInput.value).toContain("complete, self-contained response");
            expect(document.activeElement).toBe(promptInput);
        });
        expect(promptInput.value).toContain("Include every required plugin workspace file section");
    });

    test("discards buffered partial output when the backend restarts a limited response", async () => {
        const codeEditor = {
            getSelection: jest.fn(() => null),
            getModel: jest.fn(() => ({
                getLanguageId: jest.fn(() => "typescript"),
                getValue: jest.fn(() => "export {};"),
                getValueInRange: jest.fn(() => ""),
            })),
        };
        const providerError = "Assistant stream response.incomplete: max_output_tokens";
        window.electron.aiCodingAgent.smartMode.mockImplementationOnce(async ({requestId}) => {
            Promise.resolve().then(() => {
                streamHandlers.delta?.({requestId, content: "DiscardedPartialClass"});
                streamHandlers.delta?.({requestId: "stale-request", type: "reset"});
                streamHandlers.delta?.({requestId, type: "reset"});
                streamHandlers.delta?.({requestId, content: "ReplacementPartialClass"});
                streamHandlers.error?.({requestId, error: providerError});
            });
            return {success: false, requestId, error: providerError};
        });
        render(<TestHarness codeEditor={codeEditor} />);
        await waitFor(() => expect(window.electron.settings.ai.getAssistants).toHaveBeenCalled());
        fireEvent.change(screen.getByLabelText(/Describe what you want to do/i), {
            target: {value: "Build a JSON Inspector plugin"},
        });
        fireEvent.click(screen.getByRole("button", {name: /Submit/i}));
        expect(await screen.findByText(/assistant reached its response limit/i)).toBeTruthy();
        expect(screen.getByTestId("ai-coding-response")).toHaveTextContent("ReplacementPartialClass");
        expect(screen.getByTestId("ai-coding-response")).not.toHaveTextContent("DiscardedPartialClass");
        expect(virtualFS.createFile).not.toHaveBeenCalled();
    });

    test.each(["openai", "anthropic"].flatMap(provider => [
        "Assistant stream ended before completion; no changes were applied.",
        "Assistant stream error: Rate limit exceeded",
        `Assistant stream response.incomplete: ${provider === "openai" ? "max_output_tokens" : "max_tokens"}`,
    ].map(error => [provider, error])))("%s preserves workspace files after %s and ignores late stream completion", async (provider, error) => {
        window.electron.settings.ai.getAssistants.mockResolvedValue([
            {id: "assistant-1", name: "Safety test", provider, model: "test-model", purpose: "coding", default: true},
        ]);
        const files = {"/index.ts": "export const preserved = true;", "/notes.txt": "User notes"};
        virtualFS.getLatestContent.mockImplementation(() => ({...files}));
        const model = {
            getLanguageId: () => "typescript", getValue: () => files["/index.ts"], getValueInRange: () => "",
            pushEditOperations: jest.fn(),
        };
        let failedRequestId;
        const content = '```typescript\n// SOLUTION READY TO APPLY\nexport const overwritten = true;\n```';
        window.electron.aiCodingAgent.generateCode.mockImplementation(async ({requestId}) => {
            failedRequestId = requestId;
            streamHandlers.delta?.({requestId, content});
            streamHandlers.error?.({requestId, error});
            return {success: false, requestId, error};
        });
        render(<TestHarness codeEditor={{getSelection: () => null, getModel: () => model}} />);
        await waitFor(() => expect(window.electron.settings.ai.getAssistants).toHaveBeenCalled());
        fireEvent.change(screen.getByLabelText("Changes"), {target: {value: "apply"}});
        fireEvent.change(screen.getByLabelText(/Action/i, {selector: "select"}), {target: {value: "generate"}});
        fireEvent.change(document.querySelector("#prompt-input"), {target: {value: "Update the value in /index.ts"}});
        fireEvent.click(screen.getByRole("button", {name: /Submit/i}));
        await waitFor(() => expect(screen.getByTestId("ai-coding-error")).toBeTruthy());
        await act(async () => { streamHandlers.done?.({requestId: failedRequestId, fullContent: content}); });
        expect(model.pushEditOperations).not.toHaveBeenCalled();
        expect(virtualFS.createFile).not.toHaveBeenCalled();
        expect(virtualFS.setFileContent).not.toHaveBeenCalled();
        expect(virtualFS.fs.create).not.toHaveBeenCalled();
        expect(virtualFS.getLatestContent()).toEqual({"/index.ts": "export const preserved = true;", "/notes.txt": "User notes"});
    });

    test("recognizes the provider output-limit signal", () => {
        expect(isAiCodingOutputLimitError("Assistant stream response.incomplete: max_output_tokens")).toBe(true);
        expect(isAiCodingOutputLimitError("network timeout")).toBe(false);
    });

    test("refine response prefills an inferred plugin-local next step when available", async () => {
        const codeEditor = {
            getSelection: jest.fn(() => null),
            getModel: jest.fn(() => ({
                getLanguageId: jest.fn(() => "typescript"),
                getValue: jest.fn(() => "export {};"),
                getValueInRange: jest.fn(() => ""),
            })),
            focus: jest.fn(),
        };

        window.electron.aiCodingAgent.smartMode.mockImplementationOnce(async ({ requestId }) => {
            const content = [
                'Update /index.ts so metadata.name becomes "Test 6 Demo Plugin".',
                "",
                "If you want, I can also align the UI heading in /render.tsx so it shows the same plugin name.",
            ].join("\n");
            Promise.resolve().then(() => {
                streamHandlers.done?.({
                    requestId,
                    fullContent: content,
                });
            });
            return {
                success: true,
                requestId,
                content,
            };
        });

        render(<TestHarness codeEditor={codeEditor} />);

        await waitFor(() => {
            expect(window.electron.settings.ai.getAssistants).toHaveBeenCalled();
        });

        fireEvent.change(screen.getByLabelText(/Describe what you want to do/i), {
            target: { value: "please change plugin's name in metadata from undefined to something meaningful" },
        });
        fireEvent.click(screen.getByRole("button", { name: /Submit/i }));

        await screen.findByText(/align the UI heading in \/render\.tsx/i);

        const promptInput = screen.getByRole("textbox");
        fireEvent.click(screen.getByRole("button", { name: /Refine Response/i }));

        await waitFor(() => {
            expect(promptInput.value).toContain("Please continue with this plugin-local next step:");
        });
        expect(promptInput.value).toContain("align the UI heading in /render.tsx so it shows the same plugin name");
    });

    test("reads plugin logs when editor route carries plugin data in hash query", async () => {
        const exactLogLine = "Terraform preview completed with exitCode=0";
        const payload = encodeURIComponent(JSON.stringify({
            name: "hash-plugin-id",
            template: "basic",
            dir: "/tmp/hash-plugin-id",
        }));
        window.location.hash = `#/editor?data=${payload}`;

        window.electron.plugin.getLogTrace = jest.fn().mockResolvedValue({
            success: true,
            combined: [
                'Runtime status for "hash-plugin-id":',
                "loading=false; loaded=false; ready=false; inited=false",
                "lastUnload=none",
                "",
                "Plugin runtime logs:",
                `Log file: runtime.log\n\`\`\`\n${exactLogLine}\n\`\`\``,
            ].join("\n"),
        });

        const codeEditor = {
            getSelection: jest.fn(() => null),
            getModel: jest.fn(() => ({
                getLanguageId: jest.fn(() => "typescript"),
                getValue: jest.fn(() => "export {};"),
                getValueInRange: jest.fn(() => ""),
            })),
            focus: jest.fn(),
        };

        window.electron.aiCodingAgent.smartMode.mockImplementation(async ({ requestId }) => {
            const content = "diagnostics";
            Promise.resolve().then(() => {
                streamHandlers.done?.({ requestId, fullContent: content });
            });
            return { success: true, requestId, content };
        });

        render(<TestHarness codeEditor={codeEditor} />);

        await waitFor(() => {
            expect(window.electron.settings.ai.getAssistants).toHaveBeenCalled();
        });

        fireEvent.change(screen.getByLabelText(/Action/i), { target: { value: "smart" } });
        fireEvent.change(screen.getByLabelText(/Describe what you want to do/i), {
            target: { value: "check logs and diagnose failure" },
        });
        fireEvent.click(screen.getByRole("button", { name: /Submit/i }));

        await waitFor(() => {
            expect(window.electron.plugin.getLogTrace).toHaveBeenCalledWith("hash-plugin-id", expect.any(Object));
        });
        await waitFor(() => {
            expect(window.electron.aiCodingAgent.smartMode).toHaveBeenCalled();
        });

        const call = window.electron.aiCodingAgent.smartMode.mock.calls.at(-1)?.[0] || {};
        const serializedPayload = JSON.stringify(call);
        expect(serializedPayload).toContain("runtime.log");
        expect(serializedPayload).toContain(exactLogLine);
    });

    test("uses runtime verification guidance for quoted log confirmation prompts", async () => {
        const exactLogLine = "Terraform operator fixture initialized";
        const payload = encodeURIComponent(JSON.stringify({
            name: "hash-plugin-id",
            template: "basic",
            dir: "/tmp/hash-plugin-id",
        }));
        window.location.hash = `#/editor?data=${payload}`;

        window.electron.plugin.getLogTrace = jest.fn().mockResolvedValue({
            success: true,
            combined: [
                'Runtime status for "hash-plugin-id":',
                "loading=false; loaded=true; ready=true; inited=true",
                "lastUnload=none",
                "",
                "Plugin runtime logs:",
                `Log file: info-2026-04-06.log\n\`\`\`\n${exactLogLine}\n\`\`\``,
            ].join("\n"),
        });

        const codeEditor = {
            getSelection: jest.fn(() => null),
            getModel: jest.fn(() => ({
                getLanguageId: jest.fn(() => "typescript"),
                getValue: jest.fn(() => "export {};"),
                getValueInRange: jest.fn(() => ""),
            })),
            focus: jest.fn(),
        };

        window.electron.aiCodingAgent.smartMode.mockImplementation(async ({ requestId }) => {
            const content = "Confirmed from logs.";
            Promise.resolve().then(() => {
                streamHandlers.done?.({ requestId, fullContent: content });
            });
            return { success: true, requestId, content };
        });

        render(<TestHarness codeEditor={codeEditor} />);

        await waitFor(() => {
            expect(window.electron.settings.ai.getAssistants).toHaveBeenCalled();
        });

        fireEvent.change(screen.getByLabelText(/Action/i), { target: { value: "smart" } });
        fireEvent.change(screen.getByLabelText(/Describe what you want to do/i), {
            target: { value: 'check logs of this plugin to confirm that "Terraform operator fixture initialized" exists' },
        });
        fireEvent.click(screen.getByRole("button", { name: /Submit/i }));

        await waitFor(() => {
            expect(window.electron.plugin.getLogTrace).toHaveBeenCalledWith("hash-plugin-id", expect.any(Object));
            expect(window.electron.aiCodingAgent.smartMode).toHaveBeenCalled();
        });

        const call = window.electron.aiCodingAgent.smartMode.mock.calls.at(-1)?.[0] || {};
        const serializedPayload = JSON.stringify(call);
        expect(serializedPayload).toContain(exactLogLine);
        expect(serializedPayload).toContain("Runtime verification instructions:");
        expect(serializedPayload).toContain("Do not respond with file patches, scaffolds, or documentation");
    });

    test("resolves quoted plugin name in prompt before fetching logs", async () => {
        window.electron.plugin.getAll = jest.fn().mockResolvedValue({
            plugins: [
                {
                    id: "terraform-fixture-id",
                    metadata: { name: "Fixture: Terraform Operator" },
                },
            ],
        });
        window.electron.plugin.getRuntimeStatus.mockResolvedValue({
            success: true,
            statuses: [{ id: "terraform-fixture-id", loading: false, loaded: true, ready: true, inited: true }],
        });
        window.electron.plugin.getLogTrace = jest.fn().mockResolvedValue({
            success: true,
            combined: 'Runtime status for "terraform-fixture-id":\nloading=false; loaded=true; ready=true; inited=true\n',
        });

        const codeEditor = {
            getSelection: jest.fn(() => null),
            getModel: jest.fn(() => ({
                getLanguageId: jest.fn(() => "typescript"),
                getValue: jest.fn(() => "export {};"),
                getValueInRange: jest.fn(() => ""),
            })),
            focus: jest.fn(),
        };

        window.electron.aiCodingAgent.smartMode.mockImplementation(async ({ requestId }) => {
            const content = "log summary";
            Promise.resolve().then(() => {
                streamHandlers.done?.({ requestId, fullContent: content });
            });
            return { success: true, requestId, content };
        });

        render(<TestHarness codeEditor={codeEditor} />);

        await waitFor(() => {
            expect(window.electron.settings.ai.getAssistants).toHaveBeenCalled();
        });

        fireEvent.change(screen.getByLabelText(/Action/i), { target: { value: "smart" } });
        fireEvent.change(screen.getByLabelText(/Describe what you want to do/i), {
            target: { value: 'please checkout logs of "Fixture: Terraform Operator" plugin' },
        });
        fireEvent.click(screen.getByRole("button", { name: /Submit/i }));

        await waitFor(() => {
            expect(window.electron.plugin.getAll).toHaveBeenCalled();
            expect(window.electron.plugin.getLogTrace).toHaveBeenCalledWith("terraform-fixture-id", expect.any(Object));
            expect(window.electron.aiCodingAgent.smartMode).toHaveBeenCalled();
        });
    });

    test("shows native toaster warning when plugin trace fetch fails", async () => {
        const payload = encodeURIComponent(JSON.stringify({
            name: "broken-plugin-id",
            template: "basic",
            dir: "/tmp/broken-plugin-id",
        }));
        window.location.hash = `#/editor?data=${payload}`;
        window.electron.plugin.getLogTrace = jest.fn().mockResolvedValue({
            success: false,
            error: "No plugin runtime logs found",
            combined: "",
        });

        const codeEditor = {
            getSelection: jest.fn(() => null),
            getModel: jest.fn(() => ({
                getLanguageId: jest.fn(() => "typescript"),
                getValue: jest.fn(() => "export {};"),
                getValueInRange: jest.fn(() => ""),
            })),
            focus: jest.fn(),
        };

        window.electron.aiCodingAgent.smartMode.mockImplementation(async ({ requestId }) => {
            const content = "diagnostics";
            Promise.resolve().then(() => {
                streamHandlers.done?.({ requestId, fullContent: content });
            });
            return { success: true, requestId, content };
        });

        render(<TestHarness codeEditor={codeEditor} />);

        await waitFor(() => {
            expect(window.electron.settings.ai.getAssistants).toHaveBeenCalled();
        });

        fireEvent.change(screen.getByLabelText(/Action/i), { target: { value: "smart" } });
        fireEvent.change(screen.getByLabelText(/Describe what you want to do/i), {
            target: { value: "check logs and diagnose failure" },
        });
        fireEvent.click(screen.getByRole("button", { name: /Submit/i }));

        await waitFor(() => {
            expect(mockAppToasterShow).toHaveBeenCalledWith(expect.objectContaining({
                message: 'Plugin trace unavailable for "broken-plugin-id".',
                intent: "warning",
            }));
        });
    });

    test.each(["openai", "anthropic", "codex-cli"])("stops a %s request and blocks late auto-apply", async (provider) => {
        window.electron.settings.ai.getAssistants.mockResolvedValue([
            {id: "assistant-1", name: "Safety test", provider, model: "test-model", purpose: "coding", default: true},
        ]);
        const selection = {
            startLineNumber: 2,
            startColumn: 1,
            endLineNumber: 2,
            endColumn: 31,
        };
        const fullRange = {
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: 3,
            endColumn: 1,
        };
        const selectedCode = "const brokenValue = oldThing();";
        let currentValue = [
            "function keepThis() {}",
            selectedCode,
            "console.log(brokenValue);",
        ].join("\n");

        const model = {
            getLanguageId: jest.fn(() => "typescript"),
            getValue: jest.fn(() => currentValue),
            getValueInRange: jest.fn((range) => range === selection ? selectedCode : currentValue),
            getFullModelRange: jest.fn(() => fullRange),
            pushEditOperations: jest.fn((_, edits) => {
                const [edit] = edits;
                currentValue = edit.text;
            }),
        };

        const codeEditor = {
            getSelection: jest.fn(() => selection),
            getModel: jest.fn(() => model),
            focus: jest.fn(),
        };

        let pendingRequestId = null;
        let resolveLateResponse = null;
        window.electron.aiCodingAgent.fixCode.mockImplementation(async ({ requestId }) => {
            pendingRequestId = requestId;
            return new Promise((resolve) => {
                resolveLateResponse = () => {
                    const patchResponse = [
                        "```patch",
                        "<<<<<<< SEARCH",
                        "const brokenValue = oldThing();",
                        "=======",
                        "const brokenValue = safeThing();",
                        ">>>>>>> REPLACE",
                        "```",
                    ].join("\n");
                    streamHandlers.done?.({
                        requestId,
                        fullContent: patchResponse,
                    });
                    resolve({ success: true, requestId, content: patchResponse });
                };
            });
        });

        render(<TestHarness codeEditor={codeEditor} />);

        await waitFor(() => {
            expect(window.electron.settings.ai.getAssistants).toHaveBeenCalled();
        });

        fireEvent.change(screen.getByLabelText("Changes"), {target: {value: "apply"}});
        fireEvent.change(screen.getByLabelText(/Action/i), { target: { value: "fix" } });
        fireEvent.change(screen.getByLabelText(/Describe the error/i), {
            target: { value: "please fix current problems in code" },
        });
        fireEvent.click(screen.getByRole("button", { name: /Submit/i }));

        await waitFor(() => {
            expect(window.electron.aiCodingAgent.fixCode).toHaveBeenCalledTimes(1);
            expect(pendingRequestId).toBeTruthy();
        });

        fireEvent.click(screen.getByRole("button", { name: /Stop/i }));

        await waitFor(() => {
            expect(window.electron.aiCodingAgent.cancelRequest).toHaveBeenCalledWith({ requestId: pendingRequestId });
        });
        // Deliver the provider result only after Stop. This proves a late
        // response cannot mutate the workspace and avoids timing-dependent
        // assumptions about a real event loop.
        resolveLateResponse?.();

        await waitFor(() => {
            expect(screen.getByText(/AI Request Stopped/i)).toBeTruthy();
        });
        expect(virtualFS.createFile).not.toHaveBeenCalled();
        expect(virtualFS.setFileContent).not.toHaveBeenCalled();
        expect(virtualFS.fs.create).not.toHaveBeenCalled();

        expect(currentValue).toContain("const brokenValue = oldThing();");
        expect(currentValue).not.toContain("const brokenValue = safeThing();");
        expect(model.pushEditOperations).not.toHaveBeenCalled();
    });

    test.each(["openai", "anthropic", "codex-cli"])("aborts an idle %s request and rejects a late successful reply", async (provider) => {
        window.electron.settings.ai.getAssistants.mockResolvedValue([
            {id: "assistant-1", name: "Safety test", provider, model: "test-model", purpose: "coding", default: true},
        ]);
        jest.useFakeTimers();
        try {
            let completeLate;
            const pending = new Promise(resolve => { completeLate = resolve; });
            let pendingRequestId = "";
            window.electron.aiCodingAgent.generateCode.mockImplementation(({requestId}) => {
                pendingRequestId = requestId;
                return pending;
            });
            const model = {
                getLanguageId: () => "typescript",
                getValue: () => "export const ready = true;",
                getValueInRange: () => "",
                pushEditOperations: jest.fn(),
            };

            render(<TestHarness codeEditor={{getSelection: () => null, getModel: () => model}} />);
            await act(async () => { await Promise.resolve(); });
            fireEvent.change(screen.getByLabelText("Changes"), {target: {value: "apply"}});
            fireEvent.change(screen.getByLabelText(/Action/i, {selector: "select"}), {target: {value: "generate"}});
            fireEvent.change(document.querySelector("#prompt-input"), {target: {value: "Generate a status card"}});
            fireEvent.click(screen.getByRole("button", {name: /Submit/i}));
            await act(async () => { await Promise.resolve(); });
            expect(pendingRequestId).toBeTruthy();

            await act(async () => {
                await jest.advanceTimersByTimeAsync(180001);
            });

            expect(window.electron.aiCodingAgent.cancelRequest).toHaveBeenCalledWith({requestId: pendingRequestId});
            expect(screen.getByText("Request timed out. The AI service may be unavailable. Please try again.")).toBeTruthy();
            expect(screen.queryByRole("button", {name: /Stop/i})).toBeNull();
            await act(async () => {
                const content = '```typescript\n// SOLUTION READY TO APPLY\nexport const ready = false;\n```';
                streamHandlers.done?.({requestId: pendingRequestId, fullContent: content});
                completeLate({requestId: pendingRequestId, success: true, content});
            });
            expect(model.pushEditOperations).not.toHaveBeenCalled();
            expect(virtualFS.createFile).not.toHaveBeenCalled();
            expect(virtualFS.setFileContent).not.toHaveBeenCalled();
            expect(virtualFS.fs.create).not.toHaveBeenCalled();
        } finally {
            jest.useRealTimers();
        }
    });

    test("routes scaffold-style smart prompts to /index.ts even when /render.tsx is active", async () => {
        let indexContent = "export const indexValue = 1;";
        const renderContent = "export const render = () => null;";
        virtualFS.getLatestContent = jest.fn(() => ({
            "/index.ts": indexContent,
            "/render.tsx": renderContent,
        }));
        virtualFS.getFileName = jest.fn(() => "/render.tsx");
        virtualFS.setFileContent = jest.fn((filePath, content) => {
            if (filePath === "/index.ts") {
                indexContent = content;
            }
        });

        const renderModel = {
            getLanguageId: jest.fn(() => "typescript"),
            getValue: jest.fn(() => renderContent),
            getValueInRange: jest.fn(() => ""),
            getFullModelRange: jest.fn(() => ({
                startLineNumber: 1,
                startColumn: 1,
                endLineNumber: 1,
                endColumn: renderContent.length + 1,
            })),
            pushEditOperations: jest.fn(),
        };
        const codeEditor = {
            getSelection: jest.fn(() => null),
            getModel: jest.fn(() => renderModel),
            focus: jest.fn(),
        };

        window.electron.aiCodingAgent.smartMode.mockImplementation(async ({ requestId }) => {
            const content = "```ts\nexport default class GeneratedPlugin {}\n```";
            Promise.resolve().then(() => {
                streamHandlers.done?.({ requestId, fullContent: content });
            });
            return { success: true, requestId, content };
        });

        render(<TestHarness codeEditor={codeEditor} />);

        await waitFor(() => {
            expect(window.electron.settings.ai.getAssistants).toHaveBeenCalled();
        });

        fireEvent.change(screen.getByLabelText("Changes"), {target: {value: "apply"}});
        fireEvent.change(screen.getByLabelText(/Action/i), { target: { value: "smart" } });
        fireEvent.change(screen.getByLabelText(/Describe what you want to do/i), {
            target: { value: "I want a plugin like https://switchhosts.app with dry-run, tests, and clear error toasts." },
        });
        const runPluginTestsCallsBeforeSubmit = runPluginTests.mock.calls.length;
        fireEvent.click(screen.getByRole("button", { name: /Submit/i }));

        await waitFor(() => {
            expect(virtualFS.setFileContent).toHaveBeenCalledWith(
                "/index.ts",
                expect.stringContaining("GeneratedPlugin")
            );
        });
        expect(runPluginTests.mock.calls.length).toBe(runPluginTestsCallsBeforeSubmit);
        expect(screen.queryByText(/No plugin tests were found/i)).toBeNull();
        expect(renderModel.pushEditOperations).not.toHaveBeenCalled();
    });

    test("does not auto-apply informational SDK answers even when auto-apply is enabled", async () => {
        const initialContent = "export const keep = true;";
        const model = {
            getLanguageId: jest.fn(() => "typescript"),
            getValue: jest.fn(() => initialContent),
            getValueInRange: jest.fn(() => ""),
            getFullModelRange: jest.fn(() => ({
                startLineNumber: 1,
                startColumn: 1,
                endLineNumber: 1,
                endColumn: initialContent.length + 1,
            })),
            pushEditOperations: jest.fn(),
        };
        const codeEditor = {
            getSelection: jest.fn(() => null),
            getModel: jest.fn(() => model),
            focus: jest.fn(),
        };
        virtualFS.getLatestContent = jest.fn(() => ({
            "/index.ts": initialContent,
        }));
        virtualFS.getFileName = jest.fn(() => "/index.ts");

        window.electron.aiCodingAgent.smartMode.mockImplementation(async ({ requestId }) => {
            const content = "SDK answer:\\n```ts\\nconst infoOnly = true;\\n```";
            Promise.resolve().then(() => {
                streamHandlers.done?.({ requestId, fullContent: content });
            });
            return { success: true, requestId, content };
        });

        render(<TestHarness codeEditor={codeEditor} />);

        await waitFor(() => {
            expect(window.electron.settings.ai.getAssistants).toHaveBeenCalled();
        });

        fireEvent.change(screen.getByLabelText("Changes"), {target: {value: "apply"}});
        fireEvent.change(screen.getByLabelText(/Action/i), { target: { value: "smart" } });
        fireEvent.change(screen.getByLabelText(/Describe what you want to do/i), {
            target: { value: "What is the difference between system.hosts.write and system.fs.scope.<scope-id> capabilities in latest SDK?" },
        });
        const setFileCallsBeforeSubmit = virtualFS.setFileContent.mock.calls.length;
        fireEvent.click(screen.getByRole("button", { name: /Submit/i }));

        await waitFor(() => {
            expect(window.electron.aiCodingAgent.smartMode).toHaveBeenCalled();
        });

        expect(virtualFS.setFileContent.mock.calls.length).toBe(setFileCallsBeforeSubmit);
        expect(model.pushEditOperations).not.toHaveBeenCalled();
    });

    test("routes informational log-check prompts to smart mode instead of fix mode", async () => {
        const model = {
            getLanguageId: jest.fn(() => "typescript"),
            getValue: jest.fn(() => "export const keep = true;"),
            getValueInRange: jest.fn(() => "public init(): void { this.log('x'); }"),
            getFullModelRange: jest.fn(() => ({
                startLineNumber: 1,
                startColumn: 1,
                endLineNumber: 1,
                endColumn: 10,
            })),
            pushEditOperations: jest.fn(),
        };
        const codeEditor = {
            getSelection: jest.fn(() => ({
                startLineNumber: 1,
                startColumn: 1,
                endLineNumber: 1,
                endColumn: 10,
            })),
            getModel: jest.fn(() => model),
            focus: jest.fn(),
        };
        virtualFS.getLatestContent = jest.fn(() => ({ "/index.ts": "export const keep = true;" }));
        virtualFS.getFileName = jest.fn(() => "/index.ts");

        window.electron.aiCodingAgent.smartMode.mockImplementation(async ({ requestId }) => {
            const content = "Checked plugin logs context. No persisted runtime log sink found yet.";
            Promise.resolve().then(() => {
                streamHandlers.done?.({ requestId, fullContent: content });
            });
            return { success: true, requestId, content };
        });

        render(<TestHarness codeEditor={codeEditor} />);
        await waitFor(() => {
            expect(window.electron.settings.ai.getAssistants).toHaveBeenCalled();
        });

        fireEvent.change(screen.getByLabelText("Changes"), {target: {value: "apply"}});
        fireEvent.change(screen.getByLabelText(/Action/i), { target: { value: "fix" } });
        fireEvent.change(screen.getByLabelText(/Describe the error|Describe what you want to do/i), {
            target: { value: "but can you please checkout plugin logs to confirm?" },
        });
        const setFileCallsBeforeSubmit = virtualFS.setFileContent.mock.calls.length;
        fireEvent.click(screen.getByRole("button", { name: /Submit/i }));

        await waitFor(() => {
            expect(window.electron.aiCodingAgent.smartMode).toHaveBeenCalled();
        });
        expect(window.electron.aiCodingAgent.routeJudge).not.toHaveBeenCalled();
        expect(window.electron.aiCodingAgent.fixCode).not.toHaveBeenCalled();
        expect(virtualFS.setFileContent.mock.calls.length).toBe(setFileCallsBeforeSubmit);
    });

    test("route judge confirms ambiguous confirmation stays in smart mode", async () => {
        const model = {
            getLanguageId: jest.fn(() => "typescript"),
            getValue: jest.fn(() => "export const keep = true;"),
            getValueInRange: jest.fn(() => ""),
            getFullModelRange: jest.fn(() => ({
                startLineNumber: 1,
                startColumn: 1,
                endLineNumber: 1,
                endColumn: 1,
            })),
            pushEditOperations: jest.fn(),
        };
        const codeEditor = {
            getSelection: jest.fn(() => ({
                startLineNumber: 1,
                startColumn: 1,
                endLineNumber: 1,
                endColumn: 1,
            })),
            getModel: jest.fn(() => model),
            focus: jest.fn(),
        };

        window.electron.aiCodingAgent.routeJudge.mockResolvedValue({
            success: true,
            judge: {
                available: true,
                route: "smart",
                confidence: 0.95,
                intent: {
                    isQuestion: true,
                    asksForCodeChange: false,
                    asksForFileCreation: false,
                    asksForPlanExecution: false,
                    isFollowupConfirmation: true,
                },
                reasons: ["verification-request"],
            },
        });
        window.electron.aiCodingAgent.smartMode.mockImplementation(async ({ requestId }) => {
            const content = "Analysis only.";
            Promise.resolve().then(() => {
                streamHandlers.done?.({ requestId, fullContent: content });
            });
            return { success: true, requestId, content };
        });

        render(<TestHarness codeEditor={codeEditor} />);
        await waitFor(() => {
            expect(window.electron.settings.ai.getAssistants).toHaveBeenCalled();
        });

        fireEvent.change(screen.getByLabelText(/Action/i), { target: { value: "smart" } });
        fireEvent.change(screen.getByLabelText(/Describe what you want to do/i), {
            target: { value: "yes, please make those changes" },
        });
        fireEvent.click(screen.getByRole("button", { name: /Submit/i }));

        await waitFor(() => {
            expect(window.electron.aiCodingAgent.routeJudge).toHaveBeenCalled();
        });
        await waitFor(() => {
            expect(window.electron.aiCodingAgent.smartMode).toHaveBeenCalled();
        });
        expect(window.electron.aiCodingAgent.planCode).not.toHaveBeenCalled();
        expect(window.electron.aiCodingAgent.fixCode).not.toHaveBeenCalled();
    });

    test("runs plugin lifecycle utilities before log-verification smart response", async () => {
        window.location.hash = `#/editor?data=${encodeURIComponent(JSON.stringify({ name: "demo-plugin" }))}`;
        window.electron.plugin.getRuntimeStatus.mockResolvedValue({
            success: true,
            statuses: [{ id: "demo-plugin", loading: false, loaded: true, ready: true, inited: true }],
        });
        window.electron.plugin.getLogTrace.mockResolvedValue({
            success: true,
            combined: "Runtime status for demo-plugin",
        });
        window.electron.aiCodingAgent.smartMode.mockImplementation(async ({ requestId }) => {
            const content = "Not confirmed from available logs.";
            Promise.resolve().then(() => {
                streamHandlers.done?.({ requestId, fullContent: content });
            });
            return { success: true, requestId, content };
        });

        const model = {
            getLanguageId: jest.fn(() => "typescript"),
            getValue: jest.fn(() => "export const keep = true;"),
            getValueInRange: jest.fn(() => ""),
            getFullModelRange: jest.fn(() => ({
                startLineNumber: 1,
                startColumn: 1,
                endLineNumber: 1,
                endColumn: 1,
            })),
            pushEditOperations: jest.fn(),
        };
        const codeEditor = {
            getSelection: jest.fn(() => ({
                startLineNumber: 1,
                startColumn: 1,
                endLineNumber: 1,
                endColumn: 1,
            })),
            getModel: jest.fn(() => model),
            focus: jest.fn(),
        };

        render(<TestHarness codeEditor={codeEditor} />);
        await waitFor(() => {
            expect(window.electron.settings.ai.getAssistants).toHaveBeenCalled();
        });

        fireEvent.change(screen.getByLabelText(/Action/i), { target: { value: "fix" } });
        fireEvent.change(screen.getByLabelText(/Describe the error|Describe what you want to do/i), {
            target: { value: "run plugin and verify logs before answering" },
        });
        fireEvent.click(screen.getByRole("button", { name: /Submit/i }));

        await waitFor(() => {
            expect(window.electron.plugin.activate).toHaveBeenCalledWith("demo-plugin");
        });
        await waitFor(() => {
            expect(window.electron.plugin.getRuntimeStatus).toHaveBeenCalled();
            expect(window.electron.plugin.getLogTrace).toHaveBeenCalledWith(
                "demo-plugin",
                expect.objectContaining({ maxFiles: 4, maxChars: 12000, maxNotifications: 10 }),
            );
        });
        expect(window.electron.aiCodingAgent.smartMode).toHaveBeenCalled();
        expect(window.electron.aiCodingAgent.fixCode).not.toHaveBeenCalled();
    });
});

describe("AiCodingAgentPanel selection guidance", () => {
    test("does not recommend selecting code while creating a new plugin", () => {
        expect(buildSelectionGuidance({
            action: "smart",
            effectiveAction: "smart",
            prompt: "Create a JSON Inspector plugin with a styled interface and tests",
            selectedCode: "",
        })).toMatchObject({
            intent: "success",
            title: "Selection not required",
            message: expect.stringContaining("plugin workspace"),
        });
        expect(isNewPluginCreationRequest("я хочу такий плагін для моніторингу")).toBe(true);
    });

    test("recognizes the complete JSON Inspector authoring scenario as a new plugin request", () => {
        const prompt = selectPluginAuthoringScenario("json-inspector-v1").prompt;
        expect(isNewPluginCreationRequest(prompt)).toBe(true);
        expect(resolveAiCodingAgentAction({requestedAction: "smart", prompt})).toBe("smart");
        expect(buildSelectionGuidance({
            action: "smart",
            effectiveAction: "smart",
            prompt,
            selectedCode: "",
        })).toMatchObject({title: "Selection not required"});
    });

    test("warns that edit requests need a selection", () => {
        expect(buildSelectionGuidance({
            action: "edit",
            effectiveAction: "edit",
            prompt: "rename this function",
            selectedCode: "",
        })).toMatchObject({
            intent: "warning",
            title: "Select code before editing",
        });
    });

    test("marks explain questions as not requiring a selection", () => {
        expect(buildSelectionGuidance({
            action: "smart",
            effectiveAction: "smart",
            prompt: "can you explain why this plugin is not loading?",
            selectedCode: "",
        })).toMatchObject({
            intent: "success",
            title: "Selection not required",
        });
    });

    test("does not recommend a selection when Smart Mode internally chooses diagnostics", () => {
        expect(buildSelectionGuidance({
            action: "smart",
            effectiveAction: "fix",
            prompt: "Create a JSON Inspector plugin with an invalid JSON error state",
            selectedCode: "",
        })).toMatchObject({
            title: "Selection not required",
        });
    });

    test("treats selected code as optional context for verification questions", () => {
        expect(buildSelectionGuidance({
            action: "fix",
            effectiveAction: "smart",
            prompt: "but can you please checkout plugin logs to confirm?",
            selectedCode: "public init(): void { this.log('x'); }",
        })).toMatchObject({
            intent: "primary",
            title: "Selection optional",
        });
    });

    test("renders selection guidance in the panel before submit", async () => {
        const codeEditor = {
            getSelection: jest.fn(() => ({
                startLineNumber: 1,
                startColumn: 1,
                endLineNumber: 1,
                endColumn: 1,
            })),
            getModel: jest.fn(() => ({
                getLanguageId: jest.fn(() => "typescript"),
                getValue: jest.fn(() => "export default class Plugin {}"),
                getValueInRange: jest.fn(() => ""),
                getFullModelRange: jest.fn(() => ({
                    startLineNumber: 1,
                    startColumn: 1,
                    endLineNumber: 1,
                    endColumn: 31,
                })),
            })),
            focus: jest.fn(),
        };

        render(<TestHarness codeEditor={codeEditor} />);

        await waitFor(() => {
            expect(window.electron.settings.ai.getAssistants).toHaveBeenCalled();
        });

        fireEvent.change(screen.getByLabelText(/Action/i), { target: { value: "edit" } });

        expect(screen.getByText("Select code before editing")).toBeTruthy();
        expect(screen.getByText(/Edit Code works best with an explicit selection/i)).toBeTruthy();
    });
});

describe("AiCodingAgentPanel smart mode guidance", () => {
    test("uses workspace-first guidance for a new plugin request", () => {
        expect(buildSmartModeGuidance({
            prompt: "Create a JSON Inspector plugin with a styled interface and tests",
            effectiveAction: "smart",
            selectedCode: "",
        })).toMatchObject({
            predictedIntent: "Create a plugin from the workspace",
            selectionMode: "No selection is required. Smart Mode starts from the plugin workspace.",
        });
    });

    test("renders workspace-first guidance while drafting a new plugin", async () => {
        const codeEditor = {
            getSelection: jest.fn(() => null),
            getModel: jest.fn(() => ({
                getLanguageId: jest.fn(() => "typescript"),
                getValue: jest.fn(() => "export default class Plugin {}"),
                getValueInRange: jest.fn(() => ""),
            })),
        };

        render(<TestHarness codeEditor={codeEditor} />);
        await waitFor(() => {
            expect(window.electron.settings.ai.getAssistants).toHaveBeenCalled();
        });

        fireEvent.change(screen.getByLabelText(/Describe what you want to do/i), {
            target: {value: "Create a JSON Inspector plugin with a styled interface and tests"},
        });

        expect(screen.getByText("Create a plugin from the workspace")).toBeTruthy();
        expect(screen.getByText("No selection is required. Smart Mode starts from the plugin workspace.")).toBeTruthy();
        expect(screen.queryByText(/select code if you want smart mode/i)).toBeNull();
    });

    test("explains that smart mode questions do not require a selection", () => {
        expect(buildSmartModeGuidance({
            prompt: "can you explain why the plugin ui is not visible?",
            effectiveAction: "smart",
            selectedCode: "",
        })).toMatchObject({
            title: "Smart Mode preview",
            predictedIntent: "Answer or explain",
        });
    });

    test("explains that selected code becomes high-priority context in smart mode", () => {
        expect(buildSmartModeGuidance({
            prompt: "please improve this implementation",
            effectiveAction: "smart",
            selectedCode: "function demo() {}",
        })).toMatchObject({
            selectionMode: "Current selection will be treated as high-priority context.",
        });
    });

    test("renders a smart mode preview card", async () => {
        const codeEditor = {
            getSelection: jest.fn(() => ({
                startLineNumber: 1,
                startColumn: 1,
                endLineNumber: 1,
                endColumn: 1,
            })),
            getModel: jest.fn(() => ({
                getLanguageId: jest.fn(() => "typescript"),
                getValue: jest.fn(() => "export default class Plugin {}"),
                getValueInRange: jest.fn(() => ""),
                getFullModelRange: jest.fn(() => ({
                    startLineNumber: 1,
                    startColumn: 1,
                    endLineNumber: 1,
                    endColumn: 31,
                })),
            })),
            focus: jest.fn(),
        };

        render(<TestHarness codeEditor={codeEditor} />);

        await waitFor(() => {
            expect(window.electron.settings.ai.getAssistants).toHaveBeenCalled();
        });

        expect(screen.getByText("Smart Mode preview")).toBeTruthy();
        expect(screen.getByText("Likely behavior")).toBeTruthy();
        expect(screen.getByText("Selection")).toBeTruthy();
        expect(screen.getByText("Expected result")).toBeTruthy();
    });
});

describe("AiCodingAgentPanel plugin scope enforcement", () => {
    test("applies newly generated nested test files without restarting workspace generation", async () => {
        const {BLANK_TEMPLATE_MAIN} = require("../../../src/components/editor/utils/virtualTemplates");
        const initialEntry = BLANK_TEMPLATE_MAIN("Workbench");
        const model = {
            getValue: () => initialEntry,
            getLanguageId: () => "typescript",
            getValueInRange: () => "",
            getFullModelRange: () => ({startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1}),
            pushEditOperations: jest.fn(),
        };
        virtualFS.getLatestContent.mockReturnValue({"/index.ts": initialEntry,
            "/render.tsx": require("../../../src/components/editor/utils/virtualTemplates").BLANK_TEMPLATE_RENDER("Workbench")});
        const files = {
            "/logic.ts": "export const format = (value: unknown) => JSON.stringify(value);",
            "/tests/tools.test.ts": [
                "import test from 'node:test';",
                "import assert from 'node:assert/strict';",
                "import {format} from '../logic';",
                "test('format', () => assert.equal(format({}), '{}'));",
            ].join("\n"),
        };
        const content = Object.entries(files)
            .map(([path, source]) => `### File: ${path}\n\`\`\`typescript\n${source}\n\`\`\``).join("\n\n");
        window.electron.aiCodingAgent.planCode.mockImplementationOnce(async ({requestId}) => {
            streamHandlers.done?.({requestId, fullContent: content});
            return {success: true, requestId, content};
        });
        render(<TestHarness codeEditor={{
            getSelection: () => null,
            getModel: () => model,
            focus: jest.fn(),
        }} />);
        await waitFor(() => expect(window.electron.settings.ai.getAssistants).toHaveBeenCalled());
        fireEvent.change(screen.getByLabelText("Changes"), {target: {value: "apply"}});
        fireEvent.change(screen.getByLabelText(/Describe what you want to do/i), {
            target: {value: "Create a plugin with JSON formatting logic and a node:test suite in separate workspace files."},
        });
        fireEvent.change(screen.getByLabelText("Action"), {target: {value: "plan"}});
        fireEvent.click(screen.getByRole("button", {name: /Submit/i}));
        expect(await screen.findByText("Applied as snapshot snapshot-1")).toBeTruthy();
        expect(window.electron.aiCodingAgent.planCode).toHaveBeenCalledTimes(1);
        expect(window.electron.aiCodingAgent.generateCode).not.toHaveBeenCalled();
        expect(window.electron.aiCodingAgent.smartMode).not.toHaveBeenCalled();
        const applied = Object.fromEntries(virtualFS.createFile.mock.calls.map(([path, model]) => [path, model.getValue()]));
        expect(applied).toEqual(files);
        expect(screen.queryByText(/Plugin Scope Enforced/i)).toBeNull();
    });

    test("blocks prompt requests that target FDO host files", async () => {
        const codeEditor = {
            getSelection: jest.fn(() => ({
                startLineNumber: 1,
                startColumn: 1,
                endLineNumber: 1,
                endColumn: 1,
            })),
            getModel: jest.fn(() => ({
                getLanguageId: jest.fn(() => "typescript"),
                getValue: jest.fn(() => "export default class Plugin {}"),
                getValueInRange: jest.fn(() => ""),
                getFullModelRange: jest.fn(() => ({
                    startLineNumber: 1,
                    startColumn: 1,
                    endLineNumber: 1,
                    endColumn: 31,
                })),
            })),
            focus: jest.fn(),
        };

        render(<TestHarness codeEditor={codeEditor} />);

        await waitFor(() => {
            expect(window.electron.settings.ai.getAssistants).toHaveBeenCalled();
        });

        fireEvent.change(screen.getByLabelText(/Describe what you want to do/i), {
            target: { value: "please fix src/Home.jsx and src/components/NavigationPluginsButton.jsx" },
        });
        fireEvent.click(screen.getByRole("button", { name: /Submit/i }));

        await waitFor(() => {
            expect(screen.getByText(/AI Coding Assistant is restricted to the current plugin workspace/i)).toBeTruthy();
        });
        expect(window.electron.aiCodingAgent.smartMode).not.toHaveBeenCalled();
    });

    test("suppresses responses that drift into FDO host file advice", async () => {
        const codeEditor = {
            getSelection: jest.fn(() => ({
                startLineNumber: 1,
                startColumn: 1,
                endLineNumber: 1,
                endColumn: 1,
            })),
            getModel: jest.fn(() => ({
                getLanguageId: jest.fn(() => "typescript"),
                getValue: jest.fn(() => "export default class Plugin {}"),
                getValueInRange: jest.fn(() => ""),
                getFullModelRange: jest.fn(() => ({
                    startLineNumber: 1,
                    startColumn: 1,
                    endLineNumber: 1,
                    endColumn: 31,
                })),
            })),
            focus: jest.fn(),
        };

        const content = "Fix src/Home.jsx by changing state.activePlugins.some(item => item.id === id).name";
        window.electron.aiCodingAgent.smartMode.mockResolvedValue({
            success: true,
            requestId: "scope-violation-response",
            content,
        });

        render(<TestHarness codeEditor={codeEditor} />);

        await waitFor(() => {
            expect(window.electron.settings.ai.getAssistants).toHaveBeenCalled();
        });

        fireEvent.change(screen.getByLabelText(/Describe what you want to do/i), {
            target: { value: "why is plugin name showing undefined?" },
        });
        fireEvent.click(screen.getByRole("button", { name: /Submit/i }));

        await waitFor(() => {
            expect(screen.getByText(/Plugin Scope Enforced/i)).toBeTruthy();
        });
        expect(screen.getAllByText(/response was suppressed/i).length).toBeGreaterThan(0);
        expect(screen.queryByText(/Fix src\/Home\.jsx/i)).toBeNull();
    });

    test("retries once with plugin-only instructions when the first response drifts to host files", async () => {
        const codeEditor = {
            getSelection: jest.fn(() => ({
                startLineNumber: 1,
                startColumn: 1,
                endLineNumber: 1,
                endColumn: 1,
            })),
            getModel: jest.fn(() => ({
                getLanguageId: jest.fn(() => "typescript"),
                getValue: jest.fn(() => "export default class Plugin {}"),
                getValueInRange: jest.fn(() => ""),
                getFullModelRange: jest.fn(() => ({
                    startLineNumber: 1,
                    startColumn: 1,
                    endLineNumber: 1,
                    endColumn: 31,
                })),
            })),
            focus: jest.fn(),
        };

        const hostDriftContent = "Update src/components/editor/utils/setupVirtualWorkspace.js to forward displayName.";
        const pluginScopedContent = [
            "Update /fdo.meta.json so the plugin has a concrete display name.",
            "",
            "```json",
            "{",
            "  \"name\": \"Useful Plugin Name\"",
            "}",
            "```",
        ].join("\n");

        window.electron.aiCodingAgent.generateCode
            .mockImplementationOnce(async ({ requestId }) => {
                Promise.resolve().then(() => {
                    streamHandlers.done?.({
                        requestId,
                        fullContent: hostDriftContent,
                    });
                });
                return {
                    success: true,
                    requestId,
                    content: hostDriftContent,
                };
            })
            .mockImplementationOnce(async ({ requestId }) => {
                Promise.resolve().then(() => {
                    streamHandlers.done?.({
                        requestId,
                        fullContent: pluginScopedContent,
                    });
                });
                return {
                    success: true,
                    requestId,
                    content: pluginScopedContent,
                };
            });

        render(<TestHarness codeEditor={codeEditor} />);

        await waitFor(() => {
            expect(window.electron.settings.ai.getAssistants).toHaveBeenCalled();
        });

        fireEvent.change(screen.getByLabelText(/Describe what you want to do/i), {
            target: { value: "please change plugin's name in metadata from undefined to something more useful and meaningful" },
        });
        fireEvent.click(screen.getByRole("button", { name: /Submit/i }));

        await waitFor(() => {
            expect(window.electron.aiCodingAgent.generateCode).toHaveBeenCalledTimes(2);
        });
        await waitFor(() => {
            expect(screen.queryByText(/Plugin Scope Enforced/i)).toBeNull();
        });
        expect(screen.getByText(/Update \/fdo\.meta\.json so the plugin has a concrete display name/i)).toBeTruthy();
    });

    test("follow-up render request stays inside plugin workspace after metadata rename", async () => {
        const codeEditor = {
            getSelection: jest.fn(() => null),
            getModel: jest.fn(() => ({
                getLanguageId: jest.fn(() => "typescript"),
                getValue: jest.fn(() => "export default class Plugin {}"),
                getValueInRange: jest.fn(() => ""),
                getFullModelRange: jest.fn(() => ({
                    startLineNumber: 1,
                    startColumn: 1,
                    endLineNumber: 1,
                    endColumn: 31,
                })),
            })),
            focus: jest.fn(),
        };

        virtualFS.getLatestContent.mockReturnValue({
            "/index.ts": "export default class Plugin {}",
            "/render.tsx": "export default function Render() { return <h1>My Plugin</h1>; }",
        });

        const firstResponse = [
            'Update /index.ts so metadata.name becomes "Test 6 Demo Plugin".',
            "",
            "If you want, I can also align the UI heading in /render.tsx so it shows the same plugin name.",
        ].join("\n");
        const secondResponse = [
            "Update /render.tsx so the visible heading matches the plugin metadata name.",
            "",
            "```tsx",
            "export default function Render() {",
            "  return <h1>Test 6 Demo Plugin</h1>;",
            "}",
            "```",
        ].join("\n");

        window.electron.aiCodingAgent.smartMode
            .mockImplementationOnce(async ({ requestId }) => {
                Promise.resolve().then(() => {
                    streamHandlers.done?.({
                        requestId,
                        fullContent: firstResponse,
                    });
                });
                return {
                    success: true,
                    requestId,
                    content: firstResponse,
                };
            })
            .mockImplementationOnce(async ({ requestId, prompt, context }) => {
                expect(prompt).toContain("Continue the previously suggested plugin-local next step.");
                expect(prompt).toContain("/render.tsx");
                expect(prompt).toContain("Previously suggested next step:");
                expect(context).toContain("File: /render.tsx");
                Promise.resolve().then(() => {
                    streamHandlers.done?.({
                        requestId,
                        fullContent: secondResponse,
                    });
                });
                return {
                    success: true,
                    requestId,
                    content: secondResponse,
                };
            });

        render(<TestHarness codeEditor={codeEditor} />);

        await waitFor(() => {
            expect(window.electron.settings.ai.getAssistants).toHaveBeenCalled();
        });

        fireEvent.change(screen.getByLabelText(/Describe what you want to do/i), {
            target: { value: "please change plugin's name in metadata from undefined to something meaningful" },
        });
        fireEvent.click(screen.getByRole("button", { name: /Submit/i }));

        await waitFor(() => {
            expect(screen.getByText(/align the UI heading in \/render\.tsx/i)).toBeTruthy();
        });

        fireEvent.click(screen.getByRole("button", { name: /Refine Response/i }));
        fireEvent.change(screen.getByRole("textbox"), {
            target: { value: "yes, please do with render too" },
        });
        fireEvent.click(screen.getByRole("button", { name: /Continue Thread/i }));

        await waitFor(() => {
            expect(window.electron.aiCodingAgent.smartMode).toHaveBeenCalledTimes(2);
        });
        expect(screen.queryByText(/Plugin Scope Enforced/i)).toBeNull();
        expect(await screen.findByText(/Update \/render\.tsx so the visible heading matches the plugin metadata name/i)).toBeTruthy();
    });

    test("refine render follow-up does not route into plugin scaffold planning", async () => {
        const codeEditor = {
            getSelection: jest.fn(() => null),
            getModel: jest.fn(() => ({
                getLanguageId: jest.fn(() => "typescript"),
                getValue: jest.fn(() => "export default class Plugin {}"),
                getValueInRange: jest.fn(() => ""),
                getFullModelRange: jest.fn(() => ({
                    startLineNumber: 1,
                    startColumn: 1,
                    endLineNumber: 1,
                    endColumn: 31,
                })),
            })),
            focus: jest.fn(),
        };

        virtualFS.getLatestContent.mockReturnValue({
            "/index.ts": "export default class Plugin {}",
            "/render.tsx": "export default function Render() { return <h1>My Plugin</h1>; }",
        });

        const firstResponse = [
            'Update /index.ts so metadata.name becomes "Test 6 Demo Plugin".',
            "",
            "If you want, I can also align the UI heading in /render.tsx so it shows the same plugin name.",
        ].join("\n");
        const secondResponse = "Update /render.tsx so the visible heading matches the plugin metadata name.";

        window.electron.aiCodingAgent.smartMode
            .mockImplementationOnce(async ({ requestId }) => {
                Promise.resolve().then(() => {
                    streamHandlers.done?.({
                        requestId,
                        fullContent: firstResponse,
                    });
                });
                return {
                    success: true,
                    requestId,
                    content: firstResponse,
                };
            })
            .mockImplementationOnce(async ({ requestId, prompt }) => {
                expect(prompt).toContain("Update existing plugin files only.");
                expect(prompt).toContain("Follow-up request: and can you please also change name in render?");
                Promise.resolve().then(() => {
                    streamHandlers.done?.({
                        requestId,
                        fullContent: secondResponse,
                    });
                });
                return {
                    success: true,
                    requestId,
                    content: secondResponse,
                };
            });

        render(<TestHarness codeEditor={codeEditor} />);

        await waitFor(() => {
            expect(window.electron.settings.ai.getAssistants).toHaveBeenCalled();
        });

        fireEvent.change(screen.getByLabelText(/Describe what you want to do/i), {
            target: { value: "please change plugin's name in metadata from undefined to something meaningful" },
        });
        fireEvent.click(screen.getByRole("button", { name: /Submit/i }));

        await waitFor(() => {
            expect(screen.getByText(/align the UI heading in \/render\.tsx/i)).toBeTruthy();
        });

        fireEvent.click(screen.getByRole("button", { name: /Refine Response/i }));
        fireEvent.change(screen.getByRole("textbox"), {
            target: { value: "and can you please also change name in render?" },
        });
        fireEvent.click(screen.getByRole("button", { name: /Continue Thread/i }));

        await waitFor(() => {
            expect(window.electron.aiCodingAgent.smartMode).toHaveBeenCalledTimes(2);
        });
        expect(window.electron.aiCodingAgent.planCode).not.toHaveBeenCalled();
        expect(await screen.findByText(/Update \/render\.tsx so the visible heading matches the plugin metadata name/i)).toBeTruthy();
    });

    test("suppresses the response after a second scope-violating retry", async () => {
        const codeEditor = {
            getSelection: jest.fn(() => ({
                startLineNumber: 1,
                startColumn: 1,
                endLineNumber: 1,
                endColumn: 1,
            })),
            getModel: jest.fn(() => ({
                getLanguageId: jest.fn(() => "typescript"),
                getValue: jest.fn(() => "export default class Plugin {}"),
                getValueInRange: jest.fn(() => ""),
                getFullModelRange: jest.fn(() => ({
                    startLineNumber: 1,
                    startColumn: 1,
                    endLineNumber: 1,
                    endColumn: 31,
                })),
            })),
            focus: jest.fn(),
        };

        const firstInvalid = "Change src/components/editor/utils/createVirtualFile.js to populate metadata.name.";
        const secondInvalid = "File: /Users/alexvwan/dev/fdo/src/components/editor/utils/virtualTemplates.js";

        window.electron.aiCodingAgent.generateCode
            .mockImplementationOnce(async ({ requestId }) => {
                Promise.resolve().then(() => {
                    streamHandlers.done?.({
                        requestId,
                        fullContent: firstInvalid,
                    });
                });
                return {
                    success: true,
                    requestId,
                    content: firstInvalid,
                };
            })
            .mockImplementationOnce(async ({ requestId }) => {
                Promise.resolve().then(() => {
                    streamHandlers.done?.({
                        requestId,
                        fullContent: secondInvalid,
                    });
                });
                return {
                    success: true,
                    requestId,
                    content: secondInvalid,
                };
            });

        render(<TestHarness codeEditor={codeEditor} />);

        await waitFor(() => {
            expect(window.electron.settings.ai.getAssistants).toHaveBeenCalled();
        });

        fireEvent.change(screen.getByLabelText(/Describe what you want to do/i), {
            target: { value: "please change plugin's name in metadata from undefined to something more useful and meaningful" },
        });
        fireEvent.click(screen.getByRole("button", { name: /Submit/i }));

        await waitFor(() => {
            expect(window.electron.aiCodingAgent.generateCode).toHaveBeenCalledTimes(2);
        });
        await waitFor(() => {
            expect(screen.getByText(/Plugin Scope Enforced/i)).toBeTruthy();
        });
        expect(screen.getAllByText(/response was suppressed/i).length).toBeGreaterThan(0);
    });
});

describe("shouldAutoApplySingleFileResponse", () => {
    test("recognizes the Ukrainian plugin creation request", () => {
        expect(shouldAutoApplySingleFileResponse({action: "smart", prompt: "я хочу такий плагін для моніторингу Azure через az cli"})).toBe(true);
    });

    test("does not auto-apply smart mode for informational confirmation prompts", () => {
        const shouldApply = shouldAutoApplySingleFileResponse({
            action: "smart",
            prompt: "I want to confirm that init() logging is working correctly",
            selectedCode: "public init(): void { this.log('x'); }",
            targetFilePath: "/index.ts",
        });
        expect(shouldApply).toBe(false);
    });

    test("does not auto-apply fix mode for informational log-check prompts", () => {
        const shouldApply = shouldAutoApplySingleFileResponse({
            action: "fix",
            prompt: "but can you please checkout plugin logs to confirm?",
            selectedCode: "public init(): void { this.log('x'); }",
            targetFilePath: "/index.ts",
        });
        expect(shouldApply).toBe(false);
    });

    test("auto-applies smart mode when prompt explicitly asks for implementation changes", () => {
        const shouldApply = shouldAutoApplySingleFileResponse({
            action: "smart",
            prompt: "Please fix init() logging and update the code",
            selectedCode: "",
            targetFilePath: "/index.ts",
        });
        expect(shouldApply).toBe(true);
    });

    test("treats polite mutation questions as explicit change intent", () => {
        const shouldApply = shouldAutoApplySingleFileResponse({
            action: "smart",
            prompt: "can you please make name of plugin from undefined to a better name?",
            selectedCode: "",
            targetFilePath: "/index.ts",
        });
        expect(shouldApply).toBe(true);
    });
});

describe("isInformationalOnlyPrompt", () => {
    test("detects informational verification-style prompt", () => {
        expect(isInformationalOnlyPrompt("but can you please checkout plugin logs to confirm?")).toBe(true);
    });

    test("does not classify implementation request as informational", () => {
        expect(isInformationalOnlyPrompt("please fix init logging and update code")).toBe(false);
    });

    test("does not classify polite mutation questions as informational", () => {
        expect(isInformationalOnlyPrompt("can you please make name of plugin from undefined to a better name?")).toBe(false);
    });
});

test('keeps one elapsed clock across statuses and stream completion, freezes it at completion, and resets for a new submission', async () => {
    jest.useFakeTimers();
    let unmount;
    try {
        let requestId, finish;
        window.electron.aiCodingAgent.smartMode.mockImplementation(request => {
            requestId = request.requestId;
            return new Promise(resolve => { finish = resolve; });
        });
        const activity = jest.fn();
        ({unmount} = render(<TestHarness onActivityChange={activity}/>));
        await screen.findByLabelText(/Describe what you want to do/i);
        const submit = () => {
            fireEvent.change(screen.getByLabelText(/Describe what you want to do/i), {target: {value: 'Explain this plugin'}});
            fireEvent.click(screen.getByRole('button', {name: /Submit/i}));
        };
        submit();
        await waitFor(() => expect(requestId).toBeTruthy());
        await act(async () => { await jest.advanceTimersByTimeAsync(5000); });
        const elapsed = activity.mock.lastCall[0].elapsedMs;
        expect(elapsed).toBeGreaterThanOrEqual(5000);
        expect(activity.mock.lastCall[0].stageElapsedMs).toBeGreaterThanOrEqual(5000);
        for (const phase of ['generation', 'provider-retry', 'plan-retry-validation']) {
            await act(async () => {
                streamHandlers.delta({requestId, type: 'status', message: phase, metadata: {phase}});
                streamHandlers.delta({requestId, type: 'reset'});
            });
            expect(activity.mock.lastCall[0].elapsedMs).toBe(elapsed);
        }
        await act(async () => {
            streamHandlers.delta({requestId, type: 'stage', label: 'Generating file 2 of 12: /render.tsx', content: 'Pending first file'});
            streamHandlers.delta({requestId, type: 'status', message: 'Waiting for response', metadata: {phase: 'waiting-for-first-content'}});
        });
        expect(activity.mock.lastCall[0].stage).toBe('Generating file 2 of 12: /render.tsx');
        expect(activity.mock.lastCall[0].elapsedMs).toBe(elapsed);
        expect(activity.mock.lastCall[0].stageElapsedMs).toBe(0);
        await act(async () => { await jest.advanceTimersByTimeAsync(2000); });
        const stageElapsed = activity.mock.lastCall[0].stageElapsedMs;
        expect(stageElapsed).toBeGreaterThanOrEqual(2000);
        await act(async () => {
            streamHandlers.delta({requestId, type: 'status', message: 'Still receiving this file', metadata: {phase: 'waiting-for-first-content'}});
        });
        expect(activity.mock.lastCall[0].stageElapsedMs).toBe(stageElapsed);
        expect(activity.mock.lastCall[0].elapsedMs).toBeGreaterThanOrEqual(elapsed + 2000);
        await act(async () => { streamHandlers.done({requestId, fullContent: 'This plugin displays a greeting.'}); });
        expect(activity.mock.lastCall[0].isLoading).toBe(true);
        await act(async () => { await jest.advanceTimersByTimeAsync(3000); });
        expect(activity.mock.lastCall[0].elapsedMs).toBeGreaterThanOrEqual(elapsed + 3000);
        await act(async () => { finish({success: true, requestId, content: 'This plugin displays a greeting.'}); });
        expect(activity.mock.lastCall[0].isLoading).toBe(false);
        const finalElapsed = activity.mock.lastCall[0].elapsedMs;
        const finalStageElapsed = activity.mock.lastCall[0].stageElapsedMs;
        expect(finalElapsed).toBeGreaterThanOrEqual(elapsed + 3000);
        await act(async () => { await jest.advanceTimersByTimeAsync(3000); });
        expect(activity.mock.lastCall[0].elapsedMs).toBe(finalElapsed);
        expect(activity.mock.lastCall[0].stageElapsedMs).toBe(finalStageElapsed);
        requestId = null;
        submit();
        await waitFor(() => expect(requestId).toBeTruthy());
        expect(activity.mock.lastCall[0].elapsedMs).toBeLessThan(1000);
        expect(activity.mock.lastCall[0].stageElapsedMs).toBeLessThan(1000);
        await act(async () => { finish({success: true, requestId, content: 'Another explanation.'}); });
    } finally { unmount?.(); jest.useRealTimers(); }
});

test.each(['openai', 'anthropic', 'gemini', 'cloudflare', 'ollama', 'opencode', 'openrouter', 'codex-cli'])(
    '%s applies a self-forwarding export correction without regenerating the workspace', async provider => {
        const fixture = require('../../fixtures/ai/workspace-self-forwarder.cjs').scenario();
        window.electron.settings.ai.getAssistants.mockResolvedValue([{
            id: 'assistant-1', name: 'Test assistant', provider, model: 'test-model', purpose: 'coding', default: true,
        }]);
        virtualFS.getLatestContent.mockReturnValue({'/styles.css': '.retained { color: teal; }'});
        const content = `### File: ${fixture.path}\n\`\`\`typescript\n${fixture.source}\n\`\`\``;
        window.electron.aiCodingAgent.planCode.mockImplementationOnce(async ({requestId}) => {
            streamHandlers.done?.({requestId, fullContent: content});
            return {success: true, requestId, content};
        });
        render(<TestHarness />);
        await waitFor(() => expect(window.electron.settings.ai.getAssistants).toHaveBeenCalled());
        fireEvent.change(screen.getByLabelText('Changes'), {target: {value: 'apply'}});
        fireEvent.change(screen.getByLabelText(/Describe what you want to do/i), {
            target: {value: 'Create a dashboard renderer in /ui/render.ts.'},
        });
        fireEvent.change(screen.getByLabelText('Action'), {target: {value: 'plan'}});
        fireEvent.click(screen.getByRole('button', {name: /Submit/i}));
        expect(await screen.findByText('Applied as snapshot snapshot-1')).toBeTruthy();
        expect(window.electron.aiCodingAgent.planCode).toHaveBeenCalledTimes(1);
        expect(virtualFS.createFile).toHaveBeenCalledTimes(1);
        const [path, model] = virtualFS.createFile.mock.calls[0];
        expect(path).toBe(fixture.path);
        expect(model.getValue().trim()).toBe(fixture.corrected.trim());
        expect(screen.queryByTestId('ai-coding-error')).toBeNull();
    },
);

test.each(['success', 'stop', 'edit', 'scoped'])('candidate compilation keeps the editor busy and handles %s before applying', async outcome => {
    let finishBuild;
    let workspace = {'/logic.ts': 'export const value = 1;'};
    virtualFS.getLatestContent.mockImplementation(() => workspace);
    const content = '### File: /logic.ts\n```typescript\nexport const value = 2;\n```';
    window.electron.aiCodingAgent.planCode.mockImplementation(async ({requestId}) => {
        streamHandlers.done?.({requestId, fullContent: content});
        return {success: true, requestId, content};
    });
    window.electron.plugin.build.mockImplementation(() => new Promise(resolve => { finishBuild = resolve; }));
    render(<TestHarness />);
    await waitFor(() => expect(window.electron.settings.ai.getAssistants).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('Changes'), {target: {value: 'apply'}});
    fireEvent.change(screen.getByLabelText(/Describe what you want to do/i), {target: {value: (outcome === 'scoped' ? 'WORKSPACE_REPAIR_PATHS: ["/logic.ts"]\n' : '') + 'Update /logic.ts to export value = 2. Apply the complete workspace file.'}});
    if (outcome !== 'scoped') fireEvent.change(screen.getByLabelText('Action'), {target: {value: 'plan'}});
    fireEvent.click(screen.getByRole('button', {name: /Submit/i}));
    await waitFor(() => expect(finishBuild).toBeDefined());
    expect(window.electron.aiCodingAgent.setActivity).toHaveBeenLastCalledWith(true, expect.objectContaining({stage: expect.stringContaining('Checking'), estimate: expect.any(String)}));
    expect(virtualFS.createFile).not.toHaveBeenCalled();
    expect(screen.getByRole('button', {name: /Processing/i}).disabled).toBe(true);
    if (outcome === 'stop') fireEvent.click(screen.getByRole('button', {name: /Stop/i}));
    if (outcome === 'edit') workspace = {'/logic.ts': 'export const value = 99;'};
    await act(async () => finishBuild({success: true}));
    await waitFor(() => expect(screen.queryByRole('button', {name: /Processing/i})).toBeNull());
    expect(window.electron.aiCodingAgent.setActivity).toHaveBeenLastCalledWith(false);
    if (outcome === 'success' || outcome === 'scoped') expect(virtualFS.createFile).toHaveBeenCalledTimes(1);
    else {
        expect(virtualFS.createFile).not.toHaveBeenCalled();
        expect(screen.getByTestId('ai-coding-error').textContent).toMatch(/stopped|Workspace changed/);
    }
    if (outcome === 'scoped') expect(window.electron.aiCodingAgent.planCode).toHaveBeenCalledWith(expect.objectContaining({repairPaths: ['/logic.ts']}));
});

test.each(['codex-cli', 'gemini-cli'])('%s workspace options errors are repaired before editor application', async provider => {
    window.electron.settings.ai.getAssistants.mockResolvedValue([{id: 'assistant-1', name: provider, provider, model: 'test-model', purpose: 'coding', default: true}]);
    const helper = 'export interface Options {dom: object; css: object} export function render(opts: Options) {return opts;}';
    const original = 'import {render} from "./helper"; export const run = () => render({dom: {}, css: {}});';
    virtualFS.getLatestContent.mockReturnValue({'/helper.ts': helper, '/caller.ts': original});
    const broken = original.replace('dom: {}, css: {}', 'dom: {}');
    let calls = 0;
    window.electron.aiCodingAgent.planCode.mockImplementation(async ({requestId}) => {
        const content = '### File: /caller.ts\n```typescript\n' + (++calls === 1 ? broken : original) + '\n```';
        streamHandlers.done?.({requestId, fullContent: content});
        return {success: true, requestId, content};
    });
    render(<TestHarness />);
    await waitFor(() => expect(window.electron.settings.ai.getAssistants).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('Changes'), {target: {value: 'apply'}});
    fireEvent.change(screen.getByLabelText(/Describe what you want to do/i), {target: {value: 'Update /caller.ts while preserving its helper. Return the complete file.'}});
    fireEvent.change(screen.getByLabelText('Action'), {target: {value: 'plan'}});
    fireEvent.click(screen.getByRole('button', {name: /Submit/i}));
    await waitFor(() => expect(virtualFS.createFile).toHaveBeenCalledTimes(1));
    expect(window.electron.aiCodingAgent.planCode).toHaveBeenCalledTimes(2);
    expect(window.electron.aiCodingAgent.planCode.mock.calls[1][0].prompt).toContain('required option fields: css');
    expect(window.electron.aiCodingAgent.planCode.mock.calls[1][0].repairPaths).toEqual(['/caller.ts']);
    expect(screen.getByTestId('ai-coding-repair-notice')).toHaveTextContent('Repairing 1 of 1 generated files');
    expect(screen.getByTestId('ai-coding-repair-notice')).toHaveTextContent('required option fields: css');
    expect(window.electron.plugin.build).toHaveBeenCalledTimes(1);
    expect(window.electron.plugin.build.mock.calls[0][0].latestContent['/caller.ts']).toBe(original);
});

test.each([false, true])('validation can repair a retained caller while respecting explicit scope (%s)', async scoped => {
    const retainedTest = 'import {test} from "node:test"; import assert from "node:assert/strict"; import {Render} from "./render"; test("renders UI", () => { assert.ok(Render({title: "Starter"})); });';
    const repairedTest = 'import {test} from "node:test"; import assert from "node:assert/strict"; import {Render} from "./render"; test("renders workbench", () => { assert.match(Render(), /Workbench/); });';
    const generated = 'export function Render() { return "<h1>Workbench</h1>"; }';
    virtualFS.getLatestContent.mockReturnValue({
        '/render.tsx': 'export function Render(props: {title: string}) { return props.title; }',
        '/render.test.ts': retainedTest,
        '/retained.ts': 'export const untouched = true;',
    });
    let calls = 0;
    window.electron.aiCodingAgent.planCode.mockImplementation(async ({requestId}) => {
        const content = ++calls === 1 ? `### File: /render.tsx\n\`\`\`typescript\n${generated}\n\`\`\``
            : `### File: /render.test.ts\n\`\`\`typescript\n${repairedTest}\n\`\`\``;
        streamHandlers.done?.({requestId, fullContent: content});
        return {success: true, requestId, content};
    });
    render(<TestHarness />);
    await screen.findByLabelText(/Describe what you want to do/i);
    fireEvent.change(screen.getByLabelText('Changes'), {target: {value: 'apply'}});
    fireEvent.change(screen.getByLabelText(/Describe what you want to do/i), {target: {value:
        (scoped ? 'WORKSPACE_REPAIR_PATHS: ["/render.tsx"]\n' : '') + 'Replace the starter UI with a Workbench in /render.tsx. Return the complete workspace file.'}});
    fireEvent.change(screen.getByLabelText('Action'), {target: {value: 'plan'}});
    fireEvent.click(screen.getByRole('button', {name: /Submit/i}));
    if (scoped) {
        await waitFor(() => expect(screen.getByTestId('ai-coding-error')).toHaveTextContent('outside your explicit repair scope'));
        expect(window.electron.aiCodingAgent.planCode).toHaveBeenCalledTimes(1);
        expect(virtualFS.createFile).not.toHaveBeenCalled();
    } else {
        await waitFor(() => expect(virtualFS.createFile).toHaveBeenCalledTimes(2));
        expect(window.electron.aiCodingAgent.planCode).toHaveBeenCalledTimes(2);
        const repair = window.electron.aiCodingAgent.planCode.mock.calls[1][0];
        expect(repair.repairPaths).toEqual(['/render.test.ts']);
        expect(repair.workspaceFiles).toContainEqual(expect.objectContaining({path: '/render.tsx', content: generated}));
        expect(repair.workspaceFiles).toContainEqual(expect.objectContaining({path: '/render.test.ts', content: retainedTest}));
        expect(window.electron.plugin.build.mock.calls[0][0].latestContent).toMatchObject({
            '/render.tsx': generated, '/render.test.ts': repairedTest, '/retained.ts': 'export const untouched = true;',
        });
        expect(screen.getByTestId('ai-coding-repair-notice')).toHaveTextContent('Repairing 1 existing workspace file');
    }
});

test('unscoped compiler failure stops without spending tokens on another workspace plan', async () => {
    virtualFS.getLatestContent.mockReturnValue({'/logic.ts': 'export const value = 1;'});
    const content = '### File: /logic.ts\n```typescript\nexport const value = 2;\n```';
    window.electron.aiCodingAgent.planCode.mockImplementation(async ({requestId}) => {
        streamHandlers.done?.({requestId, fullContent: content});
        return {success: true, requestId, content};
    });
    window.electron.plugin.build.mockResolvedValue({success: false, error: 'Unresolved compiler entry point'});
    render(<TestHarness />);
    await screen.findByLabelText(/Describe what you want to do/i);
    fireEvent.change(screen.getByLabelText('Changes'), {target: {value: 'apply'}});
    fireEvent.change(screen.getByLabelText(/Describe what you want to do/i), {target: {value: 'Update /logic.ts to export value = 2. Apply the complete workspace file.'}});
    fireEvent.change(screen.getByLabelText('Action'), {target: {value: 'plan'}});
    fireEvent.click(screen.getByRole('button', {name: /Submit/i}));
    await waitFor(() => expect(screen.getByTestId('ai-coding-error')).toHaveTextContent('Automatic repair stopped'));
    expect(screen.getByTestId('ai-coding-error')).toHaveTextContent('Unresolved compiler entry point');
    expect(window.electron.aiCodingAgent.planCode).toHaveBeenCalledTimes(1);
    expect(virtualFS.createFile).not.toHaveBeenCalled();
});

test('removes the unused theme import before applying without another AI request', async () => {
    virtualFS.getLatestContent.mockReturnValue({'/theme.ts': 'export const getToolIcon = () => "icon"; export const getCategoryColor = () => "blue";'});
    const content = '### File: /render.tsx\n```typescript\nimport {getToolIcon, getCategoryColor} from "./theme"; export const render = () => getToolIcon();\n```';
    window.electron.aiCodingAgent.planCode.mockImplementationOnce(async ({requestId}) => {
        streamHandlers.done?.({requestId, fullContent: content});
        return {success: true, requestId, content};
    });
    render(<TestHarness />);
    await waitFor(() => expect(window.electron.settings.ai.getAssistants).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('Changes'), {target: {value: 'apply'}});
    fireEvent.change(screen.getByLabelText(/Describe what you want to do/i), {target: {value: 'Create /render.tsx using the theme icon.'}});
    fireEvent.change(screen.getByLabelText('Action'), {target: {value: 'plan'}});
    fireEvent.click(screen.getByRole('button', {name: /Submit/i}));
    expect(await screen.findByText('Applied as snapshot snapshot-1')).toBeTruthy();
    expect(window.electron.aiCodingAgent.planCode).toHaveBeenCalledTimes(1);
    const [path, model] = virtualFS.createFile.mock.calls[0];
    expect(path).toBe('/render.tsx');
    expect(model.getValue()).not.toContain('getCategoryColor');
    expect(model.getValue()).toContain('getToolIcon()');
});

test('failed candidate validation can be repaired repeatedly using the latest candidate until checks pass', async () => {
    virtualFS.getLatestContent.mockReturnValue({'/retained.ts': 'export const untouched = true;'});
    const testSource = 'import {value} from "./logic"; export const actual = value;';
    const response = value => `### File: /logic.ts\n\`\`\`typescript\nexport const value = ${value};\n\`\`\`\n\n### File: /logic.test.ts\n\`\`\`typescript\n${testSource}\n\`\`\``;
    let calls = 0;
    window.electron.aiCodingAgent.planCode.mockImplementation(async ({requestId}) => {
        const content = response(++calls);
        streamHandlers.done?.({requestId, fullContent: content});
        return {success: true, requestId, content};
    });
    const failure = value => ({success: false, output: `\ntest at logic.test.js:1:1\nAssertionError: received ${value}`});
    window.electron.plugin.runTests.mockResolvedValueOnce(failure(1)).mockResolvedValueOnce(failure(2))
        .mockResolvedValueOnce(failure(3)).mockResolvedValueOnce(failure(4)).mockResolvedValue({success: true});
    render(<TestHarness/>);
    fireEvent.change(await screen.findByLabelText(/Describe what you want to do/i), {target: {value: 'Create /logic.ts and its tests.'}});
    fireEvent.change(screen.getByLabelText('Action'), {target: {value: 'plan'}});
    fireEvent.click(screen.getByRole('button', {name: /Submit/i}));
    const repair = await screen.findByRole('button', {name: 'Repair failed validation'});
    await waitFor(() => expect(repair).toBeEnabled());
    expect(virtualFS.createFile).not.toHaveBeenCalled();
    for (const previous of [2, 3, 4]) {
        const before = window.electron.aiCodingAgent.planCode.mock.calls.length;
        fireEvent.click(repair);
        await waitFor(() => expect(window.electron.aiCodingAgent.planCode).toHaveBeenCalledTimes(before + 1));
        const request = window.electron.aiCodingAgent.planCode.mock.lastCall[0];
        expect(request.workspaceFiles.find(file => file.path === '/logic.ts').content).toContain(`= ${previous}`);
        expect(request.workspaceFiles.find(file => file.path === '/retained.ts').content).toBe('export const untouched = true;');
        if (previous < 4) {
            await waitFor(() => expect(repair).toBeEnabled());
            expect(virtualFS.createFile).not.toHaveBeenCalled();
        }
    }
    await waitFor(() => expect(screen.queryByTestId('validation-recovery')).toBeNull());
    expect(virtualFS.createFile).toHaveBeenCalled();
    expect(window.electron.aiCodingAgent.planCode).toHaveBeenCalledTimes(5);
});

test('stopping a manual validation repair retains recovery and ignores a late provider response', async () => {
    virtualFS.getLatestContent.mockReturnValue({'/retained.ts': 'export const untouched = true;'});
    const content = '### File: /logic.ts\n```typescript\nexport const value = 1;\n```\n### File: /logic.test.ts\n```typescript\nimport {value} from "./logic"; export const actual = value;\n```';
    window.electron.aiCodingAgent.planCode.mockImplementation(async ({requestId}) => {
        streamHandlers.done?.({requestId, fullContent: content});
        return {success: true, requestId, content};
    });
    window.electron.plugin.runTests.mockResolvedValue({success: false, output: '\ntest at logic.test.js:1:1\nAssertionError: wrong value'});
    render(<TestHarness/>);
    fireEvent.change(await screen.findByLabelText(/Describe what you want to do/i), {target: {value: 'Create /logic.ts and its tests.'}});
    fireEvent.change(screen.getByLabelText('Action'), {target: {value: 'plan'}});
    fireEvent.click(screen.getByRole('button', {name: /Submit/i}));
    const repair = await screen.findByRole('button', {name: 'Repair failed validation'});
    await waitFor(() => expect(repair).toBeEnabled());
    let finish, retryId;
    window.electron.aiCodingAgent.planCode.mockImplementationOnce(({requestId}) => {
        retryId = requestId;
        return new Promise(resolve => {finish = resolve;});
    });
    fireEvent.click(repair);
    await waitFor(() => expect(retryId).toBeTruthy());
    fireEvent.click(screen.getByRole('button', {name: 'Stop', exact: true}));
    await act(async () => {finish({success: true, requestId: retryId, content});});
    await waitFor(() => expect(repair).toBeEnabled());
    expect(virtualFS.createFile).not.toHaveBeenCalled();
    expect(screen.getByTestId('validation-recovery')).toBeTruthy();
});

test.each([true, false])('candidate tests allow one scoped repair and apply only on success (%s)', async passes => {
    virtualFS.getLatestContent.mockReturnValue({'/retained.ts': 'export const untouched = true;'});
    const testSource = 'import {value} from "./logic"; export const actual = value;';
    const response = value => `### File: /logic.ts\n\`\`\`typescript\nexport const value = ${value};\n\`\`\`\n\n### File: /logic.test.ts\n\`\`\`typescript\n${testSource}\n\`\`\``;
    let calls = 0;
    window.electron.aiCodingAgent.planCode.mockImplementation(async ({requestId}) => {
        const content = response(++calls);
        streamHandlers.done?.({requestId, fullContent: content});
        return {success: true, requestId, content};
    });
    const failure = {success: false, output: '\ntest at logic.test.js:1:1\nAssertionError: expected 2, received 1'};
    window.electron.plugin.runTests.mockResolvedValueOnce(failure).mockResolvedValue(passes ? {success: true} : failure);
    render(<TestHarness />);
    await screen.findByLabelText(/Describe what you want to do/i);
    fireEvent.change(screen.getByLabelText('Changes'), {target: {value: 'apply'}});
    fireEvent.change(screen.getByLabelText(/Describe what you want to do/i), {target: {value: 'Create /logic.ts and its tests.'}});
    fireEvent.change(screen.getByLabelText('Action'), {target: {value: 'plan'}});
    fireEvent.click(screen.getByRole('button', {name: /Submit/i}));
    if (passes) expect(await screen.findByText('Applied as snapshot snapshot-1')).toBeTruthy();
    else {
        await waitFor(() => expect(screen.getByTestId('ai-coding-error')).toHaveTextContent('Generated tests failed'));
        expect(virtualFS.createFile).not.toHaveBeenCalled();
    }
    expect(window.electron.plugin.runTests).toHaveBeenCalledTimes(2);
    expect(window.electron.aiCodingAgent.planCode).toHaveBeenCalledTimes(2);
    expect(window.electron.aiCodingAgent.planCode.mock.calls[1][0].repairPaths.sort()).toEqual(['/logic.test.ts', '/logic.ts']);
    expect(window.electron.plugin.runTests.mock.calls[1][0].latestContent['/retained.ts']).toBe('export const untouched = true;');
    expect(screen.getByLabelText('Verification attempt 1')).toHaveTextContent('failed');
    expect(screen.getByLabelText('Verification attempt 2')).toHaveTextContent(passes ? 'Candidate tests: passed' : 'Candidate tests: failed');
    expect(screen.getByTestId('workspace-verification-report')).toHaveTextContent('not-run');
});

test.each([true, false])('test repair remains available after source validation repair (passes: %s)', async passes => {
    virtualFS.getLatestContent.mockReturnValue({'/retained.ts': 'export const untouched = true;'});
    const section = (path, content) => `### File: ${path}\n\`\`\`typescript\n${content}\n\`\`\``;
    const source = value => `export const value = () => ${value};`;
    const initialTest = 'import {value} from "./logic"; export const actual = value(1);';
    const fixedTest = 'import {value} from "./logic"; export const actual = value();';
    const replies = [section('/logic.ts', source(1)) + '\n' + section('/logic.test.ts', initialTest),
        section('/logic.test.ts', fixedTest),
        section('/logic.test.ts', fixedTest) + '\n' + section('/logic.ts', source(2))];
    let call = 0;
    window.electron.aiCodingAgent.planCode.mockImplementation(async ({requestId}) => {
        const content = replies[call++];
        streamHandlers.done?.({requestId, fullContent: content});
        return {success: true, requestId, content};
    });
    const failure = {success: false, output: '\ntest at logic.test.js:1:1\nAssertionError: expected 2, received 1'};
    window.electron.plugin.runTests.mockResolvedValueOnce(failure).mockResolvedValue(passes ? {success: true} : failure);
    render(<TestHarness />);
    await screen.findByLabelText(/Describe what you want to do/i);
    fireEvent.change(screen.getByLabelText('Changes'), {target: {value: 'apply'}});
    fireEvent.change(screen.getByLabelText(/Describe what you want to do/i), {target: {value: 'Create /logic.ts and its tests.'}});
    fireEvent.change(screen.getByLabelText('Action'), {target: {value: 'plan'}});
    fireEvent.click(screen.getByRole('button', {name: /Submit/i}));
    if (passes) expect(await screen.findByText('Applied as snapshot snapshot-1')).toBeTruthy();
    else {
        await waitFor(() => expect(screen.getByTestId('ai-coding-error')).toHaveTextContent('Generated tests failed'));
        expect(virtualFS.createFile).not.toHaveBeenCalled();
    }
    expect(window.electron.aiCodingAgent.planCode).toHaveBeenCalledTimes(3);
    expect(window.electron.aiCodingAgent.planCode.mock.calls[1][0].repairPaths).toEqual(['/logic.test.ts']);
    expect(window.electron.aiCodingAgent.planCode.mock.calls[2][0].repairPaths.sort()).toEqual(['/logic.test.ts', '/logic.ts']);
    expect(window.electron.plugin.runTests).toHaveBeenCalledTimes(2);
});

test('plugin guide review keeps validation errors visible and submits edited approval', async () => {
    let requestId, finish;
    window.electron.aiCodingAgent.smartMode.mockImplementationOnce(request => {
        requestId = request.requestId;
        return new Promise(resolve => { finish = resolve; });
    });
    window.electron.aiCodingAgent.reviewSkill = jest.fn()
        .mockResolvedValueOnce({success: true, report: {source: '/installed/sdk.js', unchecked: 'Guidance remains unverified.', findings: []}})
        .mockResolvedValueOnce({success: false, error: 'Unsupported SDK export'})
        .mockResolvedValueOnce({success: true});
    const activity = jest.fn();
    render(<TestHarness onActivityChange={activity}/>);
    fireEvent.change(await screen.findByLabelText(/Describe what you want to do/i), {target: {value: 'Explain plugin'}});
    fireEvent.click(screen.getByRole('button', {name: /Submit/i}));
    await waitFor(() => expect(requestId).toBeTruthy());
    act(() => streamHandlers.delta({requestId, type: 'skill-review', content: '# Proposed', report: {
        source: '/installed/sdk.js', unchecked: 'Project guidance is not verified.', findings: [
            {status: 'verified', reference: 'DOMText.createSpanText', message: 'API member exists.'},
        ],
    }}));
    expect(await screen.findByLabelText('Guide compatibility report')).toHaveTextContent('API exists');
    expect(activity.mock.lastCall[0].guideReviewPending).toBe(true);
    expect(screen.getByLabelText('Guide compatibility report')).toHaveTextContent('/installed/sdk.js');
    fireEvent.change(await screen.findByLabelText('Plugin guide'), {target: {value: '# Edited'}});
    expect(screen.queryByLabelText('Guide compatibility report')).toBeNull();
    fireEvent.click(screen.getByRole('button', {name: 'Check compatibility'}));
    expect(await screen.findByLabelText('Guide compatibility report')).toHaveTextContent('Guidance remains unverified.');
    expect(window.electron.aiCodingAgent.reviewSkill).toHaveBeenCalledWith({requestId, content: '# Edited', checkOnly: true});
    expect(screen.getByLabelText('Plugin guide')).toBeTruthy();
    fireEvent.click(screen.getByTestId('approve-plugin-guide'));
    expect(await screen.findByText('Unsupported SDK export')).toBeTruthy();
    expect(window.electron.aiCodingAgent.reviewSkill).toHaveBeenCalledWith({requestId, content: '# Edited'});
    fireEvent.click(screen.getByTestId('approve-plugin-guide'));
    await waitFor(() => expect(screen.queryByLabelText('Plugin guide')).toBeNull());
    expect(activity.mock.lastCall[0].guideReviewPending).toBe(false);
    await act(async () => finish({success: true, content: 'Finished'}));
});

test('one repair includes retained import failures and independent TypeScript owners', async () => {
    const section = (path, content) => `### File: ${path}\n\`\`\`typescript\n${content}\n\`\`\``;
    virtualFS.getLatestContent.mockReturnValue({'/render.test.ts': 'import {Render} from "./render"; export const html = Render();'});
    window.electron.plugin.typecheck.mockResolvedValueOnce({success: false, diagnostics: [
        {path: '/actions.ts', line: 1, column: 1, code: 2339, message: 'Property dataset does not exist on Element'},
    ]}).mockResolvedValue({success: true});
    let calls = 0;
    window.electron.aiCodingAgent.planCode.mockImplementation(async ({requestId, repairPaths}) => {
        if (calls) {
            expect(repairPaths).toEqual(['/render.test.ts', '/actions.ts']);
            expect(window.electron.plugin.build).not.toHaveBeenCalled();
            expect(virtualFS.createFile).not.toHaveBeenCalled();
        }
        const content = ++calls === 1
            ? section('/render.ts', 'export const render = () => "Workbench";') + '\n' + section('/actions.ts', 'export const bad = document.querySelector("div")?.dataset;')
            : section('/render.test.ts', 'import {render} from "./render"; export const html = render();') + '\n' + section('/actions.ts', 'export const data = document.querySelector<HTMLElement>("div")?.dataset;');
        streamHandlers.done?.({requestId, fullContent: content});
        return {success: true, requestId, content};
    });
    render(<TestHarness />);
    await screen.findByLabelText(/Describe what you want to do/i);
    fireEvent.change(screen.getByLabelText('Changes'), {target: {value: 'apply'}});
    fireEvent.change(screen.getByLabelText(/Describe what you want to do/i), {target: {value: 'Build the Workbench workspace and actions. Return complete files.'}});
    fireEvent.change(screen.getByLabelText('Action'), {target: {value: 'plan'}});
    fireEvent.click(screen.getByRole('button', {name: /Submit/i}));
    await waitFor(() => expect(virtualFS.createFile).toHaveBeenCalledTimes(3));
    expect(window.electron.aiCodingAgent.planCode).toHaveBeenCalledTimes(2);
});

test.each([true, false])('test progress permits exactly one final repair with application only on success (%s)', async passes => {
    virtualFS.getLatestContent.mockReturnValue({});
    const response = value => `### File: /logic.ts\n\`\`\`typescript\nexport const value = ${value};\n\`\`\`\n\n### File: /logic.test.ts\n\`\`\`typescript\nimport {value} from "./logic"; export const actual = value;\n\`\`\``;
    let calls = 0;
    window.electron.aiCodingAgent.planCode.mockImplementation(async ({requestId}) => {
        expect(virtualFS.createFile).not.toHaveBeenCalled();
        const content = response(++calls);
        streamHandlers.done?.({requestId, fullContent: content});
        return {success: true, requestId, content};
    });
    const outcome = failedCount => ({success: failedCount === 0,
        output: '\ntest at logic.test.js:1:1\nAssertionError: remaining assertion failed',
        results: ['format', 'url', 'image'].map((name, index) => ({file: '/logic.test.ts', name, passed: index >= failedCount}))});
    window.electron.plugin.runTests.mockResolvedValueOnce(outcome(3)).mockResolvedValueOnce(outcome(2)).mockResolvedValue(outcome(passes ? 0 : 1));
    render(<TestHarness />);
    await screen.findByLabelText(/Describe what you want to do/i);
    fireEvent.change(screen.getByLabelText('Changes'), {target: {value: 'apply'}});
    fireEvent.change(screen.getByLabelText(/Describe what you want to do/i), {target: {value: 'Create /logic.ts and its tests.'}});
    fireEvent.change(screen.getByLabelText('Action'), {target: {value: 'plan'}});
    fireEvent.click(screen.getByRole('button', {name: /Submit/i}));
    if (passes) expect(await screen.findByText('Applied as snapshot snapshot-1')).toBeTruthy();
    else {
        await waitFor(() => expect(screen.getByTestId('ai-coding-error')).toHaveTextContent('Generated tests failed'));
        expect(virtualFS.createFile).not.toHaveBeenCalled();
    }
    expect(window.electron.aiCodingAgent.planCode).toHaveBeenCalledTimes(3);
    expect(window.electron.plugin.runTests).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId('ai-coding-repair-notice')).toHaveTextContent('One final scoped repair');
});

test.each(['retry', 'edit'])('guide proposal recovery supports %s without approving the guide', async action => {
    let requestId, finish;
    window.electron.aiCodingAgent.smartMode.mockImplementationOnce(request => {
        requestId = request.requestId;
        return new Promise(resolve => { finish = resolve; });
    });
    window.electron.aiCodingAgent.reviewSkill = jest.fn().mockResolvedValue({success: true});
    render(<TestHarness />);
    fireEvent.change(await screen.findByLabelText(/Describe what you want to do/i), {target: {value: 'Explain plugin'}});
    fireEvent.click(screen.getByRole('button', {name: /Submit/i}));
    await waitFor(() => expect(requestId).toBeTruthy());
    act(() => streamHandlers.delta({requestId, type: 'skill-review', proposal: true,
        content: '{"purpose":"Retained"}', errors: {acceptance: 'Missing requirement quote'}}));
    expect(await screen.findByText('Fix plugin guide draft')).toBeTruthy();
    expect(screen.getByText(/This JSON is an intermediate format, not SKILL.md/)).toBeTruthy();
    expect(screen.queryByText('Your approval is needed')).toBeNull();
    expect(screen.getByLabelText('Plugin guide')).toHaveValue('{"purpose":"Retained"}');
    expect(screen.queryByRole('button', {name: 'Approve and continue'})).toBeNull();
    if (action === 'retry') {
        fireEvent.click(screen.getByRole('button', {name: 'Retry failed step'}));
        await waitFor(() => expect(window.electron.aiCodingAgent.reviewSkill).toHaveBeenCalledWith({requestId, action: 'retry'}));
    } else {
        fireEvent.change(screen.getByLabelText('Plugin guide'), {target: {value: '{"purpose":"Edited"}'}});
        fireEvent.click(screen.getByRole('button', {name: 'Validate edited proposal'}));
        await waitFor(() => expect(window.electron.aiCodingAgent.reviewSkill).toHaveBeenCalledWith({requestId, content: '{"purpose":"Edited"}'}));
    }
    await waitFor(() => expect(screen.queryByLabelText('Plugin guide')).toBeNull());
    await act(async () => finish({success: false, error: 'Stopped for test'}));
});

test.each([false, true])('guide compatibility check shows progress and explicit success (proposal=%s)', async proposal => {
    let requestId, finish, resolveCheck;
    window.electron.aiCodingAgent.smartMode.mockImplementationOnce(request => {
        requestId = request.requestId;
        return new Promise(resolve => { finish = resolve; });
    });
    window.electron.aiCodingAgent.reviewSkill = jest.fn(() => new Promise(resolve => { resolveCheck = resolve; }));
    render(<TestHarness />);
    fireEvent.change(await screen.findByLabelText(/Describe what you want to do/i), {target: {value: 'Explain plugin'}});
    fireEvent.click(screen.getByRole('button', {name: /Submit/i}));
    await waitFor(() => expect(requestId).toBeTruthy());
    act(() => streamHandlers.delta({requestId, type: 'skill-review', proposal, content: proposal ? '{}' : '# Guide'}));
    const checkLabel = proposal ? 'Check draft' : 'Check compatibility';
    fireEvent.click(await screen.findByRole('button', {name: checkLabel}));
    expect(screen.getByRole('button', {name: checkLabel})).toBeDisabled();
    expect(screen.getByTestId('approve-plugin-guide')).toBeDisabled();
    expect(screen.getByLabelText('Plugin guide')).toBeDisabled();
    await act(async () => resolveCheck({success: true}));
    expect(await screen.findByText(proposal ? /Proposal check passed/ : /Compatibility check passed/)).toBeTruthy();
    expect(screen.getByLabelText('Plugin guide')).toBeEnabled();
    expect(window.electron.aiCodingAgent.reviewSkill).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText('Plugin guide'), {target: {value: '# New edits'}});
    expect(screen.queryByText(/check passed/)).toBeNull();
    window.electron.aiCodingAgent.reviewSkill.mockRejectedValueOnce(new Error('Connection interrupted'));
    fireEvent.click(screen.getByRole('button', {name: checkLabel}));
    expect(await screen.findByText('Connection interrupted')).toBeTruthy();
    expect(screen.getByRole('button', {name: checkLabel})).toBeEnabled();
    fireEvent.click(screen.getByRole('button', {name: 'Stop and revise request'}));
    await waitFor(() => expect(screen.queryByLabelText('Plugin guide')).toBeNull());
    expect(window.electron.aiCodingAgent.cancelRequest).toHaveBeenCalledWith({requestId});
    await act(async () => finish({success: false, error: 'Cancelled'}));
});

test('stopping a pending guide check prevents its late response from reopening review', async () => {
    let requestId, finish, resolveCheck;
    window.electron.aiCodingAgent.smartMode.mockImplementationOnce(request => {
        requestId = request.requestId;
        return new Promise(resolve => { finish = resolve; });
    });
    window.electron.aiCodingAgent.reviewSkill = jest.fn(() => new Promise(resolve => { resolveCheck = resolve; }));
    render(<TestHarness />);
    fireEvent.change(await screen.findByLabelText(/Describe what you want to do/i), {target: {value: 'Explain plugin'}});
    fireEvent.click(screen.getByRole('button', {name: /Submit/i}));
    await waitFor(() => expect(requestId).toBeTruthy());
    act(() => streamHandlers.delta({requestId, type: 'skill-review', content: '# Guide'}));
    fireEvent.click(await screen.findByRole('button', {name: 'Check compatibility'}));
    expect(screen.getByText('Checking compatibility…')).toBeTruthy();
    const stop = screen.getByRole('button', {name: 'Stop and revise request'});
    expect(stop).toBeEnabled();
    fireEvent.click(stop);
    await waitFor(() => expect(screen.queryByLabelText('Plugin guide')).toBeNull());
    expect(window.electron.aiCodingAgent.cancelRequest).toHaveBeenCalledWith({requestId});
    await act(async () => resolveCheck({success: false, error: 'Late validation error'}));
    expect(screen.queryByText('Late validation error')).toBeNull();
    expect(screen.queryByLabelText('Plugin guide')).toBeNull();
    await act(async () => finish({success: false, error: 'Cancelled'}));
});

test.each(['done', 'error'])('budget recovery submits directly without exposing technical instructions or applying partial output (%s)', async completion => {
    const partial = '### File: /index.ts\n```typescript\nexport const unfinished = true;\n```';
    window.electron.aiCodingAgent.planCode.mockImplementationOnce(async ({requestId}) => {
        if (completion === 'done') streamHandlers.done?.({requestId, fullContent: partial});
        else {
            streamHandlers.delta({requestId, content: partial});
            streamHandlers.error({requestId, error: 'Generation could not finish.'});
        }
        return {success: false, requestId, error: 'Generation could not finish.', failure: {schemaVersion: '1.0.0', code: 'WORKSPACE_GENERATION_BUDGET_EXHAUSTED', stage: 'file-generation', path: '/plugin/lifecycle-styles.ts', workspaceChanged: false, resumable: false, recoveryActions: ['smaller-scope']}};
    });
    let finishRetry;
    window.electron.aiCodingAgent.planCode.mockImplementationOnce(() => new Promise(resolve => {finishRetry = resolve;}));
    render(<><TestHarness/><AiPendingFiles/></>);
    const input = await screen.findByLabelText(/Describe what you want to do/i);
    fireEvent.change(input, {target: {value: 'Build a JSON inspector with nested values.'}});
    fireEvent.change(screen.getByLabelText('Action'), {target: {value: 'plan'}});
    fireEvent.click(screen.getByRole('button', {name: /Submit/i}));
    expect(await screen.findByText('Generation stopped before changes were applied')).toBeTruthy();
    expect(screen.getByTestId('ai-coding-error')).toHaveTextContent('no resumable checkpoint');
    expect(screen.queryByRole('button', {name: 'Apply proposed changes'})).toBeNull();
    expect(virtualFS.createFile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', {name: 'Retry with smaller scope'}));
    expect(input.value).toContain('Build a JSON inspector with nested values.');
    expect(input.value).not.toContain('Smaller-scope generation request');
    expect(input.value).toContain('For this retry, build a smaller working version');
    expect(getPendingFiles().previousFiles).toContainEqual({path: '/index.ts', ready: true, content: 'export const unfinished = true;'});
    expect(screen.getByRole('button', {name: 'Preview previous /index.ts'})).toBeVisible();
    expect(screen.getByLabelText('Action')).toHaveValue('plan');
    await waitFor(() => expect(window.electron.aiCodingAgent.planCode).toHaveBeenCalledTimes(2));
    expect(window.electron.aiCodingAgent.planCode.mock.lastCall[0]).toMatchObject({
        userRequirements: expect.stringContaining('For this retry, build a smaller working version'), recoveryMode: 'smaller-scope', recoveryPath: '/plugin/lifecycle-styles.ts',
    });
    expect(screen.getByTestId('generation-recovery-state')).toHaveTextContent('Generating the smaller-scope retry');
    expect(screen.queryByRole('button', {name: 'Apply proposed changes'})).toBeNull();
    expect(virtualFS.createFile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', {name: 'Stop', exact: true}));
    await act(async () => finishRetry({success: false, error: 'Cancelled'}));
});

test('structured recovery submits once, preserves previews and ignores failure after stopping', async () => {
    const metadata = {schemaVersion: '1.0.0', code: 'WORKSPACE_GENERATION_BUDGET_EXHAUSTED', stage: 'file-generation', path: '/plugin/lifecycle-styles.ts', workspaceChanged: false, resumable: false, recoveryActions: ['smaller-scope']};
    let finish, retryId;
    window.electron.aiCodingAgent.planCode.mockImplementationOnce(async ({requestId}) => ({success: false, requestId, error: 'A different message', failure: metadata}));
    window.electron.aiCodingAgent.planCode.mockImplementationOnce(request => {
        retryId = request.requestId;
        return new Promise(resolve => {finish = resolve;});
    });
    render(<TestHarness/>);
    const input = await screen.findByLabelText(/Describe what you want to do/i);
    fireEvent.change(input, {target: {value: 'Build a JSON inspector.'}});
    fireEvent.change(screen.getByLabelText('Action'), {target: {value: 'plan'}});
    fireEvent.click(screen.getByRole('button', {name: /Submit/i}));
    const retry = await screen.findByRole('button', {name: 'Retry with smaller scope'});
    act(() => stagePendingFiles('### File: /saved-helper.ts\n```ts\nexport const saved = true;\n```'));
    fireEvent.click(retry);
    fireEvent.click(retry);
    await waitFor(() => expect(retryId).toBeTruthy());
    expect(getPendingFiles().previousFiles).toContainEqual({path: '/saved-helper.ts', ready: true, content: 'export const saved = true;'});
    expect(getPendingFiles().files).toEqual([]);
    expect(screen.getByTestId('generation-recovery-state')).toHaveTextContent('Generating the smaller-scope retry');
    expect(window.electron.aiCodingAgent.planCode).toHaveBeenCalledTimes(2);
    expect(window.electron.aiCodingAgent.planCode.mock.lastCall[0].userRequirements).toContain('Build a JSON inspector.');
    expect(window.electron.aiCodingAgent.planCode.mock.lastCall[0].userRequirements).toContain('For this retry, build a smaller working version');
    fireEvent.click(screen.getByRole('button', {name: 'Stop', exact: true}));
    expect(screen.queryByTestId('generation-recovery-state')).toBeNull();
    await act(async () => finish({success: false, requestId: retryId, error: 'Late failure', failure: metadata}));
    expect(screen.queryByRole('button', {name: 'Retry with smaller scope'})).toBeNull();
    expect(virtualFS.createFile).not.toHaveBeenCalled();
});

test.each(['resume', 'smaller-scope'])('saved checkpoints discovered after reopening recover with %s', async mode => {
    virtualFS.sandboxName = 'saved-checkpoint-plugin';
    window.electron.settings.ai.getAssistants.mockResolvedValue([{id: 'assistant-1', provider: 'openrouter', model: 'coding-model', name: 'API', purpose: 'coding', default: true}]);
    const checkpoint = {id: '12345678-1234-1234-1234-123456789abc', requirements: 'Build a JSON inspector.', path: '/a.ts', completedFileCount: 2, pendingFileCount: 1, canResume: true};
    window.electron.aiCodingAgent.getGenerationCheckpoint = jest.fn().mockResolvedValue({success: true, checkpoint});
    window.electron.aiCodingAgent.discardGenerationCheckpoint = jest.fn().mockResolvedValue({success: true});
    window.electron.aiCodingAgent.planCode.mockImplementationOnce(async request => ({success: false, requestId: request.requestId, error: 'Stopped for this test'}));
    render(<TestHarness/>);
    expect(await screen.findByTestId('saved-generation-checkpoint')).toHaveTextContent('2 validated files saved');
    fireEvent.click(screen.getByRole('button', {name: mode === 'resume' ? 'Resume unfinished generation' : 'Retry with smaller scope using saved helpers'}));
    const input = document.querySelector('#prompt-input');
    expect(input.value).toContain(checkpoint.requirements);
    if (mode === 'resume') {
        expect(window.electron.aiCodingAgent.planCode).not.toHaveBeenCalled();
        expect(screen.getByTestId('generation-recovery-state')).toHaveTextContent('No provider request has been sent');
        fireEvent.click(screen.getByRole('button', {name: /Submit/i}));
    }
    await waitFor(() => expect(window.electron.aiCodingAgent.planCode).toHaveBeenCalled());
    expect(window.electron.aiCodingAgent.planCode.mock.calls[0][0]).toMatchObject({checkpointId: checkpoint.id, recoveryMode: mode, workspaceId: virtualFS.sandboxName});
    await screen.findByTestId('ai-coding-error');
    expect(virtualFS.createFile).not.toHaveBeenCalled();
});

test('checkpoint recovery is disabled when newer workspace edits exist; explicit discard is available', async () => {
    virtualFS.sandboxName = 'saved-checkpoint-plugin';
    window.electron.settings.ai.getAssistants.mockResolvedValue([{id: 'assistant-1', provider: 'openrouter', model: 'coding-model', name: 'API', purpose: 'coding', default: true}]);
    const checkpoint = {id: '12345678-1234-1234-1234-123456789abc', requirements: 'Build tools', path: '/a.ts', completedFileCount: 1, pendingFileCount: 1, canResume: false, reason: 'The workspace changed. Preserve newer edits.'};
    window.electron.aiCodingAgent.getGenerationCheckpoint = jest.fn().mockResolvedValue({success: true, checkpoint});
    window.electron.aiCodingAgent.discardGenerationCheckpoint = jest.fn().mockResolvedValue({success: true});
    render(<TestHarness/>);
    expect(await screen.findByTestId('saved-generation-checkpoint')).toHaveTextContent('Preserve newer edits');
    expect(screen.getByRole('button', {name: 'Resume unfinished generation'})).toBeDisabled();
    expect(screen.getByRole('button', {name: 'Retry with smaller scope using saved helpers'})).toBeDisabled();
    fireEvent.click(screen.getByRole('button', {name: 'Discard saved generation work'}));
    await waitFor(() => expect(screen.queryByTestId('saved-generation-checkpoint')).toBeNull());
    expect(window.electron.aiCodingAgent.discardGenerationCheckpoint).toHaveBeenCalledWith({workspaceId: virtualFS.sandboxName, id: checkpoint.id});
    expect(window.electron.aiCodingAgent.planCode).not.toHaveBeenCalled();
});

test('saved proposal Apply rechecks the baseline and blocks overwriting newer edits', async () => {
    virtualFS.sandboxName = 'checkpoint-apply';
    const checkpoint = {id: '12345678-1234-1234-1234-123456789abc', workspaceId: virtualFS.sandboxName, requirements: 'Build helpers.', path: '/a.ts', completedFileCount: 1, pendingFileCount: 0, canResume: true};
    window.electron.settings.ai.getAssistants.mockResolvedValue([{id: 'assistant-1', provider: 'openrouter', model: 'coding-model', name: 'API', purpose: 'coding', default: true}]);
    window.electron.aiCodingAgent.getGenerationCheckpoint = jest.fn().mockResolvedValue({success: true, checkpoint: null});
    window.electron.aiCodingAgent.planCode.mockImplementationOnce(async ({requestId}) => {
        window.electron.aiCodingAgent.getGenerationCheckpoint.mockResolvedValue({success: true, checkpoint});
        streamHandlers.delta?.({requestId, type: 'generation-checkpoint', checkpoint});
        const content = '### File: /a.ts\n```typescript\nexport const a = 1;\n```';
        streamHandlers.done?.({requestId, fullContent: content});
        return {success: true, requestId, content};
    });
    render(<TestHarness/>);
    fireEvent.change(await screen.findByLabelText(/Describe what you want to do/i), {target: {value: 'Build helpers.'}});
    fireEvent.change(screen.getByLabelText('Changes'), {target: {value: 'review'}});
    fireEvent.change(screen.getByLabelText('Action'), {target: {value: 'plan'}});
    fireEvent.click(screen.getByRole('button', {name: /Submit/i}));
    const apply = await screen.findByRole('button', {name: 'Apply proposed changes'});
    await waitFor(() => expect(apply).toBeEnabled());
    await waitFor(() => expect(screen.getByTestId('saved-generation-checkpoint')).toBeTruthy());
    virtualFS.getLatestContent.mockReturnValue({'/newer.ts': 'export const newer = true;'});
    window.electron.aiCodingAgent.getGenerationCheckpoint.mockResolvedValue({success: true, checkpoint: {...checkpoint, canResume: false, reason: 'Newer workspace edits must be preserved.'}});
    fireEvent.click(apply);
    expect(await screen.findByText('Newer workspace edits must be preserved.')).toBeTruthy();
    expect(virtualFS.createFile).not.toHaveBeenCalled();
});

test('documentation lookups never auto-apply a model-produced source block', () => {
    const prompt = 'Use the configured OpenAI Docs MCP server to find documentation. Explain approvals and include links.';
    expect(isInformationalOnlyPrompt(prompt)).toBe(true);
    expect(shouldAutoApplySingleFileResponse({action: 'smart', prompt, targetFilePath: '/index.ts'})).toBe(false);
    expect(shouldAutoApplySingleFileResponse({action: 'generate', prompt, targetFilePath: '/index.ts'})).toBe(false);
});

test('Smart documentation lookup uses the informational endpoint and preserves the current file despite a SOLUTION response', async () => {
    const original = 'export const existingPlugin = true;';
    let value = original;
    const model = {getLanguageId: jest.fn(() => 'typescript'), getValue: jest.fn(() => value), getValueInRange: jest.fn(() => ''),
        getFullModelRange: jest.fn(() => ({startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: original.length + 1})),
        pushEditOperations: jest.fn((_, edits) => {value = edits[0].text;})};
    const codeEditor = {getModel: () => model, getSelection: () => ({startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1}), focus: jest.fn()};
    virtualFS.getLatestContent.mockReturnValue({'/index.ts': original});
    window.electron.aiCodingAgent.smartMode.mockImplementation(async ({requestId}) => {
        const content = '```typescript\n// SOLUTION READY TO APPLY\nexport const remoteMcpDocumentation = {};\n```';
        Promise.resolve().then(() => streamHandlers.done?.({requestId, fullContent: content}));
        return {success: true, requestId, content};
    });
    render(<TestHarness codeEditor={codeEditor}/>);
    const input = await screen.findByLabelText(/Describe what you want to do/i);
    fireEvent.change(screen.getByLabelText('Changes'), {target: {value: 'apply'}});
    fireEvent.change(input, {target: {value: 'Use the configured OpenAI Docs MCP server to find documentation. Explain approvals and include links.'}});
    fireEvent.click(screen.getByRole('button', {name: /Submit/i}));
    await waitFor(() => expect(window.electron.aiCodingAgent.smartMode).toHaveBeenCalled());
    await screen.findByText(/remoteMcpDocumentation/);
    expect(window.electron.aiCodingAgent.generateCode).not.toHaveBeenCalled();
    expect(model.pushEditOperations).not.toHaveBeenCalled();
    expect(value).toBe(original);
});

test.each(['error', 'throws', 'classification'])('failed streamed replies preserve the prompt for switching assistants and resubmitting (%s)', outcome => {
    return (async () => {
        window.electron.settings.ai.getAssistants.mockResolvedValue([
            {id: 'assistant-1', provider: 'codex-cli', name: 'Codex', purpose: 'coding', default: true},
            {id: 'another', provider: 'openrouter', name: 'Another model', purpose: 'coding'},
        ]);
        window.electron.aiCodingAgent.smartMode.mockImplementationOnce(async ({requestId}) => {
            streamHandlers.done({requestId, fullContent: 'User Safety: safe Response Safety: safe'});
            if (outcome === 'throws') throw new Error('Invalid workspace file plan');
            if (outcome === 'classification') return {success: true, requestId, content: 'User Safety: safe Response Safety: safe'};
            return {success: false, requestId, error: 'Invalid workspace file plan'};
        }).mockImplementationOnce(async ({requestId}) => ({success: false, requestId, error: 'Second request reached provider'}));
        render(<TestHarness/>);
        const input = await screen.findByLabelText(/Describe what you want to do/i);
        fireEvent.change(input, {target: {value: 'Explain this plugin'}});
        fireEvent.click(screen.getByRole('button', {name: /^Submit$/}));
        await screen.findByText(outcome === 'classification' ? /The provider returned only a safety classification, with no answer/ : 'Invalid workspace file plan');
        await waitFor(() => expect(screen.getByRole('button', {name: /^Submit$/})).toBeEnabled());
        expect(input).toHaveValue('Explain this plugin');
        fireEvent.change(screen.getByLabelText('AI Assistant'), {target: {value: 'another'}});
        fireEvent.click(screen.getByRole('button', {name: /^Submit$/}));
        await waitFor(() => expect(window.electron.aiCodingAgent.smartMode).toHaveBeenCalledTimes(2));
        expect(window.electron.aiCodingAgent.smartMode.mock.calls[1][0]).toMatchObject({assistantId: 'another'});
    })();
});

test('rechecks saved API image capabilities and enables attachments when fresh metadata advertises vision', async () => {
    window.electron.settings.ai.getAssistants.mockResolvedValue([{id: 'assistant-1', provider: 'openai', name: 'Vision assistant', model: 'vision-fixture', purpose: 'coding', default: true,
        inputCapabilities: {provider: 'openai', model: 'vision-fixture', imageSupport: 'unsupported', source: 'provider-metadata', reason: 'Old capability data'}}]);
    window.electron.settings.ai.getInputCapabilities = jest.fn().mockResolvedValue({provider: 'openai', model: 'vision-fixture', imageSupport: 'supported', source: 'provider-metadata', reason: 'Current metadata advertises images'});
    render(<TestHarness/>);
    await screen.findByLabelText(/Describe what you want to do/i);
    fireEvent.change(screen.getByLabelText('Action'), {target: {value: 'plan'}});
    await waitFor(() => expect(window.electron.settings.ai.getInputCapabilities).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('button', {name: 'Upload Image'})).toBeEnabled());
    expect(screen.getByText('Screenshots: Images supported')).toBeVisible();
});
