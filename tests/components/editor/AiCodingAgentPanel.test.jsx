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
import {selectPluginAuthoringScenario} from "../../../src/utils/pluginAuthoringScenarioCatalog.js";
import virtualFS from "../../../src/components/editor/utils/VirtualFS";
import runPluginTests from "../../../src/components/editor/utils/runTests.js";

const mockAppToasterShow = jest.fn();

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
        streamHandlers.delta({requestId, type: 'stage', label: 'Generating file 1 of 12: /types.ts', content: ''});
        streamHandlers.delta({requestId, type: 'reset'});
        streamHandlers.delta({requestId, type: 'status', message: 'Retrying the provider.', metadata: {phase: 'provider-retry'}});
    });
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
        virtualFS.getLatestContent.mockReturnValue({"/index.ts": initialEntry});
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
