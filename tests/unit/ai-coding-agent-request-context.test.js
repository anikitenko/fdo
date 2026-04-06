import { buildAiCodingAgentRequestContexts } from "../../src/components/editor/utils/aiCodingAgentRequestContext.js";

describe("ai coding agent request context", () => {
    test("includes referenced workspace files in reference-only context", () => {
        const contexts = buildAiCodingAgentRequestContexts({
            includeProjectContext: false,
            workspaceReferenceContext: "Referenced workspace files:\n\nFile: /TODO.md\n```\n- [ ] ship it\n```\n\n---\n\n",
            problemsContext: "Current editor problems:\n/index.ts:3:5 [8] broken\n\n",
            buildOutputContext: "Recent build output:\n[2024-03-09T16:00:00.000Z] [ERROR] Build failed: syntax error\n\nRecent test output:\n[2024-03-09T16:01:00.000Z] [ERROR] Assertion failed in /index.test.ts\n\n",
            pluginRuntimeActionContext: "Plugin runtime action report for \"demo\":\n- activate: success\n\n",
            externalReferenceContext: "External references:\n...",
            sdkKnowledgeContext: "Bundled FDO SDK:\n...",
        });

        expect(contexts.referenceContext).toContain("/TODO.md");
        expect(contexts.referenceContext).toContain("Current editor problems:");
        expect(contexts.referenceContext).toContain("Recent build output:");
        expect(contexts.referenceContext).toContain("Recent test output:");
        expect(contexts.referenceContext).toContain("Plugin runtime action report");
        expect(contexts.referenceContext).toContain("External references:");
        expect(contexts.referenceContext).toContain("Bundled FDO SDK:");
        expect(contexts.projectContext).toBe(contexts.referenceContext);
    });

    test("prioritizes referenced workspace files even when project context is enabled", () => {
        const contexts = buildAiCodingAgentRequestContexts({
            includeProjectContext: true,
            projectFiles: [
                { path: "/TODO.md", content: "- [ ] item" },
                { path: "/src/index.ts", content: "export {};" },
            ],
            currentFileContext: "export const value = 1;",
            workspaceReferenceContext: "Referenced workspace files:\n\nFile: /TODO.md\n```\n- [ ] item\n```\n\n---\n\n",
            externalReferenceContext: "",
            sdkKnowledgeContext: "",
        });

        expect(contexts.projectContext).toContain("Referenced workspace files:");
        expect(contexts.projectContext).toContain("Current file content:");
        expect(contexts.projectContext).toContain("Project files (2 of 2 files):");
    });

    test("supports focused project context for execution flows", () => {
        const contexts = buildAiCodingAgentRequestContexts({
            includeProjectContext: true,
            projectFiles: [
                { path: "/TODO.md", content: "- [ ] item" },
                { path: "/src/index.ts", content: "export {};" },
                { path: "/src/render.ts", content: "export const render = () => 'x';" },
            ],
            currentFileContext: "export const value = 1;",
            workspaceReferenceContext: "Referenced workspace files:\n\nFile: /TODO.md\n```\n- [ ] item\n```\n\n---\n\n",
            projectContextMode: "focused",
        });

        expect(contexts.projectContext).toContain("Referenced workspace files:");
        expect(contexts.projectContext).toContain("Current file content:");
        expect(contexts.projectContext).toContain("Nearby workspace files");
        expect(contexts.projectContext).toContain("/src/index.ts");
        expect(contexts.projectContext).not.toContain("Project files (");
    });

    test("prioritizes plugin metadata files for metadata rename prompts", () => {
        const contexts = buildAiCodingAgentRequestContexts({
            includeProjectContext: true,
            prompt: "please change plugin's name in metadata from undefined to something more useful and meaningful",
            currentFilePath: "/render.tsx",
            currentFileContext: "export const Render = () => null;",
            projectFiles: [
                { path: "/render.tsx", content: "export const Render = () => null;" },
                { path: "/README.md", content: "# Docs" },
                { path: "/index.ts", content: 'private readonly _metadata: PluginMetadata = { name: "undefined", version: "1.0.0", author: "FDO" };' },
                { path: "/fdo.meta.json", content: '{ "name": "undefined", "version": "1.0.0" }' },
            ],
        });

        const fdoMetaIndex = contexts.projectContext.indexOf("File: /fdo.meta.json");
        const indexTsIndex = contexts.projectContext.indexOf("File: /index.ts");
        const readmeIndex = contexts.projectContext.indexOf("File: /README.md");

        expect(fdoMetaIndex).toBeGreaterThan(-1);
        expect(indexTsIndex).toBeGreaterThan(-1);
        expect(readmeIndex).toBeGreaterThan(-1);
        expect(fdoMetaIndex).toBeLessThan(readmeIndex);
        expect(indexTsIndex).toBeLessThan(readmeIndex);
    });

    test("supports targeted project context for fast local edits", () => {
        const contexts = buildAiCodingAgentRequestContexts({
            includeProjectContext: true,
            prompt: "please change plugin's name in metadata from undefined to something more useful and meaningful",
            currentFilePath: "/render.tsx",
            currentFileContext: "export const Render = () => <h1>My Plugin</h1>;",
            projectFiles: [
                { path: "/render.tsx", content: "export const Render = () => <h1>My Plugin</h1>;" },
                { path: "/README.md", content: "# Docs" },
                { path: "/index.ts", content: 'private readonly _metadata: PluginMetadata = { name: "undefined", version: "1.0.0", author: "FDO" };' },
                { path: "/fdo.meta.json", content: '{ "name": "undefined", "version": "1.0.0" }' },
                { path: "/extra.ts", content: "export const extra = true;" },
            ],
            projectContextMode: "targeted",
        });

        expect(contexts.projectContext).toContain("Targeted plugin files");
        expect(contexts.projectContext).toContain("File: /fdo.meta.json");
        expect(contexts.projectContext).toContain("File: /index.ts");
        expect(contexts.projectContext).not.toContain("File: /README.md");
        expect(contexts.projectContext).not.toContain("Project files (");
    });
});
