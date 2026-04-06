import {
    buildWorkspaceExecutionPlanPrompt,
    shouldExecuteWorkspacePlan,
} from "../../src/components/editor/utils/aiCodingAgentExecutionIntent.js";

describe("ai coding agent execution intent", () => {
    test("treats TODO-driven implementation as workspace execution", () => {
        expect(shouldExecuteWorkspacePlan({
            prompt: "proceed with implementation from TODO",
            previousResponse: "We created /TODO.md",
        })).toBe(true);
    });

    test("treats current plugin best-practice fix request as workspace execution", () => {
        expect(shouldExecuteWorkspacePlan({
            prompt: "please fix my current plugin implementation and make it best practice according to SDK",
            previousResponse: "",
        })).toBe(true);
    });

    test("keeps advisory test-step request out of execution mode", () => {
        expect(shouldExecuteWorkspacePlan({
            prompt: "please provide me with steps to test before marking completed",
            previousResponse: "We have a current plugin implementation",
        })).toBe(false);
    });

    test("builds an execution prompt with file-section contract", () => {
        const prompt = buildWorkspaceExecutionPlanPrompt({
            prompt: "please fix my current plugin implementation",
            previousResponse: "",
        });

        expect(prompt).toContain("EXECUTION MODE: WORKSPACE TASK IMPLEMENTATION");
        expect(prompt).toContain("### File: /path/to/file");
        expect(prompt).toContain("Do not return prose-only guidance");
    });

    test("does not enter workspace execution mode for host-app file references outside the plugin workspace", () => {
        expect(shouldExecuteWorkspacePlan({
            prompt: "please fix PluginPage.jsx",
            previousResponse: "Look at /Users/alexvwan/dev/fdo/src/components/plugin/PluginPage.jsx",
            workspaceFiles: [{ path: "/index.ts", content: "export default {}" }],
        })).toBe(false);
    });

    test("does not enter workspace execution mode for generic confirmation after prose-only summary", () => {
        expect(shouldExecuteWorkspacePlan({
            prompt: "yes, please make those changes",
            previousResponse: "Implementation Summary: updated editor window close reliability in specs/006-fix-editor-close/tasks.md",
            workspaceFiles: [{ path: "/index.ts", content: "export default {}" }],
        })).toBe(false);
    });

    test("allows generic confirmation only when previous response is an executable file plan", () => {
        expect(shouldExecuteWorkspacePlan({
            prompt: "yes, please make those changes",
            previousResponse: "### File: /index.ts\n```ts\nexport const name = \"Plugin\";\n```",
            workspaceFiles: [{ path: "/index.ts", content: "export const name = \"undefined\";" }],
        })).toBe(true);
    });
});
