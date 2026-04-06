import React from "react";
import {fireEvent, render, screen, waitFor} from "@testing-library/react";
import {HotkeysProvider} from "@blueprintjs/core";
import AiCodingAgentPanel, {
    buildSmartModeGuidance,
    buildSelectionGuidance,
    isInformationalOnlyPrompt,
    shouldAutoApplySingleFileResponse,
} from "../../../src/components/editor/AiCodingAgentPanel.jsx";
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

function TestHarness({ codeEditor }) {
    const [response, setResponse] = React.useState("");
    return (
        <HotkeysProvider>
            <AiCodingAgentPanel codeEditor={codeEditor} response={response} setResponse={setResponse} />
        </HotkeysProvider>
    );
}

let streamHandlers;

beforeEach(() => {
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

    window.electron.system.getFdoSdkKnowledge = jest.fn().mockResolvedValue({ success: true, results: [] });
    window.electron.system.getExternalReferenceKnowledge = jest.fn().mockResolvedValue({ success: true, results: [] });
    window.electron.plugin = {
        ...(window.electron.plugin || {}),
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
    virtualFS.getFileName = jest.fn(() => "/index.ts");
});

describe("AiCodingAgentPanel auto-apply patch flow", () => {
    test("auto-apply patches only the selected code for fix requests", async () => {
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
        fireEvent.click(screen.getByRole("checkbox", { name: /Auto-apply generated changes/i }));
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
            expect(window.electron.aiCodingAgent.generateCode).toHaveBeenCalled();
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

        fireEvent.click(screen.getByRole("checkbox", { name: /Auto-apply generated changes/i }));
        fireEvent.change(screen.getByLabelText(/Action/i), { target: { value: "fix" } });
        fireEvent.change(screen.getByLabelText(/Describe the error/i), {
            target: { value: "I need you to run tests and fix them.. I also see blank screen when open plugin's page" },
        });
        fireEvent.click(screen.getByRole("button", { name: /Submit/i }));

        await waitFor(() => {
            expect(window.electron.aiCodingAgent.generateCode).toHaveBeenCalled();
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

        window.electron.aiCodingAgent.generateCode.mockImplementationOnce(async ({ requestId }) => {
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

        fireEvent.click(screen.getByRole("checkbox", { name: /Auto-apply generated changes/i }));
        fireEvent.change(screen.getByLabelText(/Action/i), { target: { value: "fix" } });
        fireEvent.change(screen.getByLabelText(/Describe the error/i), {
            target: { value: "tests are still failing" },
        });
        fireEvent.click(screen.getByRole("button", { name: /Submit/i }));

        await waitFor(() => {
            expect(window.electron.aiCodingAgent.generateCode).toHaveBeenCalled();
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

        fireEvent.click(screen.getByRole("checkbox", { name: /Auto-apply generated changes/i }));
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

        fireEvent.click(screen.getByRole("checkbox", { name: /Auto-apply generated changes/i }));
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

        expect(await screen.findByText(/Applied the generated single-file change by replacing the current file/i)).toBeTruthy();
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

        fireEvent.click(screen.getByRole("checkbox", { name: /Auto-apply generated changes/i }));
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
        fireEvent.click(screen.getByRole("checkbox", { name: /Auto-apply generated changes/i }));
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

        fireEvent.click(screen.getByRole("checkbox", { name: /Auto-apply generated changes/i }));
        fireEvent.change(screen.getByLabelText(/Describe what you want to do/i), {
            target: { value: "please change plugin's name to something more creative" },
        });
        fireEvent.click(screen.getByRole("button", { name: /Submit/i }));

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

        expect(screen.getByLabelText(/Auto-apply generated changes to the editor or virtual workspace/i)).toBeTruthy();
        fireEvent.click(screen.getByRole("checkbox", { name: /Auto-apply generated changes to the editor or virtual workspace/i }));

        expect(screen.getByText(/FDO keeps a restore point before each apply and saves the updated workspace as the new current state/i)).toBeTruthy();
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

        window.electron.aiCodingAgent.smartMode.mockImplementationOnce(async ({ requestId }) => {
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

        fireEvent.click(screen.getByRole("checkbox", { name: /Auto-apply generated changes/i }));
        fireEvent.change(screen.getByLabelText(/Describe what you want to do/i), {
            target: { value: "can you please rename plugin's name in metadata from undefined to something more usefull or meaningful?" },
        });
        fireEvent.click(screen.getByRole("button", { name: /Submit/i }));

        await waitFor(() => {
            expect(window.electron.aiCodingAgent.smartMode).toHaveBeenCalled();
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

        fireEvent.click(screen.getByRole("checkbox", { name: /Auto-apply generated changes/i }));
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

        fireEvent.click(screen.getByRole("checkbox", { name: /Auto-apply generated changes/i }));
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

        fireEvent.click(screen.getByRole("checkbox", { name: /Auto-apply generated changes/i }));
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

        fireEvent.click(screen.getByRole("checkbox", { name: /Auto-apply generated changes/i }));
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

        fireEvent.click(screen.getByRole("checkbox", { name: /Auto-apply generated changes/i }));
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

        fireEvent.click(screen.getByRole("checkbox", { name: /Auto-apply generated changes/i }));
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
        expect(screen.getByRole("checkbox", { name: /Auto-apply generated changes/i })).toBeChecked();

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
                "Log file: runtime.log\n```\\nReferenceError: broken\\n```",
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

    test("stops an in-flight request and blocks late auto-apply", async () => {
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
        window.electron.aiCodingAgent.fixCode.mockImplementation(async ({ requestId }) => {
            pendingRequestId = requestId;
            return new Promise((resolve) => {
                setTimeout(() => {
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
                }, 20);
            });
        });

        render(<TestHarness codeEditor={codeEditor} />);

        await waitFor(() => {
            expect(window.electron.settings.ai.getAssistants).toHaveBeenCalled();
        });

        fireEvent.click(screen.getByRole("checkbox", { name: /Auto-apply generated changes/i }));
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

        await waitFor(() => {
            expect(screen.getByText(/AI Request Stopped/i)).toBeTruthy();
        });

        expect(currentValue).toContain("const brokenValue = oldThing();");
        expect(currentValue).not.toContain("const brokenValue = safeThing();");
        expect(model.pushEditOperations).not.toHaveBeenCalled();
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

        fireEvent.click(screen.getByRole("checkbox", { name: /Auto-apply generated changes/i }));
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

        fireEvent.click(screen.getByRole("checkbox", { name: /Auto-apply generated changes/i }));
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

        fireEvent.click(screen.getByRole("checkbox", { name: /Auto-apply generated changes/i }));
        fireEvent.change(screen.getByLabelText(/Action/i), { target: { value: "fix" } });
        fireEvent.change(screen.getByLabelText(/Describe the error|Describe what you want to do/i), {
            target: { value: "but can you please checkout plugin logs to confirm?" },
        });
        const setFileCallsBeforeSubmit = virtualFS.setFileContent.mock.calls.length;
        fireEvent.click(screen.getByRole("button", { name: /Submit/i }));

        await waitFor(() => {
            expect(window.electron.aiCodingAgent.smartMode).toHaveBeenCalled();
        });
        expect(window.electron.aiCodingAgent.routeJudge).toHaveBeenCalled();
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

        window.electron.aiCodingAgent.smartMode
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
            expect(window.electron.aiCodingAgent.smartMode).toHaveBeenCalledTimes(2);
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

        window.electron.aiCodingAgent.smartMode
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
            expect(window.electron.aiCodingAgent.smartMode).toHaveBeenCalledTimes(2);
        });
        await waitFor(() => {
            expect(screen.getByText(/Plugin Scope Enforced/i)).toBeTruthy();
        });
        expect(screen.getAllByText(/response was suppressed/i).length).toBeGreaterThan(0);
    });
});

describe("shouldAutoApplySingleFileResponse", () => {
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
