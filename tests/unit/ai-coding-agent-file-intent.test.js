import {
    buildProjectFilePlanPrompt,
    extractProjectFileTargets,
    shouldCreateProjectFiles,
} from "../../src/components/editor/utils/aiCodingAgentFileIntent.js";

describe("ai coding agent file intent", () => {
    test("detects explicit TODO file creation requests", () => {
        expect(shouldCreateProjectFiles({
            prompt: "okay.. so please create TODO and let's do that!",
            previousResponse: "We should break this into phases.",
        })).toBe(true);
    });

    test("does not trigger for generic implementation prompts", () => {
        expect(shouldCreateProjectFiles({
            prompt: "Implement the plugin UI",
            previousResponse: "We should break this into phases.",
        })).toBe(false);
    });

    test("extracts dynamic file targets from the prompt", () => {
        expect(extractProjectFileTargets({
            prompt: "Please create README.md and changelog",
            previousResponse: "",
        })).toEqual(["/README.md", "/CHANGELOG.md"]);
    });

    test("does not treat TODO update follow-ups as file creation", () => {
        expect(shouldCreateProjectFiles({
            prompt: "so?? will you continue with TODO and mark what was completed after my testing?",
            previousResponse: "We created /TODO.md and outlined the implementation phases.",
        })).toBe(false);

        expect(extractProjectFileTargets({
            prompt: "so?? will you continue with TODO and mark what was completed after my testing?",
            previousResponse: "We created /TODO.md and outlined the implementation phases.",
        })).toEqual([]);
    });

    test("builds a file-oriented plan prompt", () => {
        const prompt = buildProjectFilePlanPrompt({
            prompt: "Please create TODO",
            previousResponse: "We should break this into phases.",
        });

        expect(prompt).toContain("### File: /TODO.md");
        expect(prompt).toContain("Requested file target(s): /TODO.md");
        expect(prompt).toContain("Do not return prose-only guidance");
    });

    test("prefers an existing workspace task file over the hardcoded TODO alias", () => {
        expect(extractProjectFileTargets({
            prompt: "Please create TODO",
            previousResponse: "",
            workspaceFiles: [{ path: "/IMPLEMENTATION-TODO.md", content: "- [ ] item" }],
        })).toEqual(["/IMPLEMENTATION-TODO.md"]);
    });

    test("uses a neutral fallback instead of hardcoded TODO when no target can be inferred", () => {
        const prompt = buildProjectFilePlanPrompt({
            prompt: "Please create a task file",
            previousResponse: "We should track work items.",
        });

        expect(prompt).toContain("### File: /TASKS.md");
        expect(prompt).toContain("Requested file target(s): /TASKS.md");
        expect(prompt).not.toContain("/TODO.md");
    });

    test("does not create plugin workspace files for host-app file follow-ups", () => {
        expect(shouldCreateProjectFiles({
            prompt: "please fix PluginPage.jsx and ai_coding_agent.js",
            previousResponse: "Look at /Users/alexvwan/dev/fdo/src/ipc/ai_coding_agent.js and src/components/plugin/PluginPage.jsx",
            workspaceFiles: [{ path: "/index.ts", content: "export default {}" }],
        })).toBe(false);
    });
});
