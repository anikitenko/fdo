import {
    parseAiWorkspacePlanResponse,
    shouldApplyAiResponseToWorkspace,
} from "../../src/components/editor/utils/aiCodingAgentPlanResponse.js";

describe("ai coding agent workspace plan response", () => {
    test.each(["SOLUTION", "SOLUTION READY TO APPLY"])("recognizes FILE sections after the %s wrapper", (marker) => {
        const response = `\`\`\`typescript\n// ${marker}\n// FILE: /index.ts\nexport const name = 'Quasar Quill';\n// FILE: /render.tsx\nexport const heading = 'Quasar Quill';\n\`\`\``;
        expect(parseAiWorkspacePlanResponse(response).files.map(file => file.path)).toEqual(["/index.ts", "/render.tsx"]);
        expect(shouldApplyAiResponseToWorkspace(response)).toBe(true);
    });
    test.each([false, true])("routes FILE comment sections independently (fenced=%s)", (fenced) => {
        const code = '// FILE: /index.ts\nexport const name = "Quasar Quill";\n\n// FILE: /render.tsx\nexport const heading = "Quasar Quill";';
        const response = fenced ? `\`\`\`typescript\n${code}\n\`\`\`` : code;
        expect(parseAiWorkspacePlanResponse(response)).toEqual({files: [
            {path: "/index.ts", language: "", content: 'export const name = "Quasar Quill";'},
            {path: "/render.tsx", language: "", content: 'export const heading = "Quasar Quill";'},
        ], invalidPaths: []});
        expect(shouldApplyAiResponseToWorkspace(response)).toBe(true);
    });

    test("rejects host paths in FILE comments", () => {
        const response = '// FILE: /Users/alexvwan/dev/fdo/index.ts\nexport const value = 1;';
        expect(parseAiWorkspacePlanResponse(response)).toEqual({files: [], invalidPaths: ["/Users/alexvwan/dev/fdo/index.ts"]});
        expect(shouldApplyAiResponseToWorkspace(response)).toBe(true);
    });
    test("parses multiple workspace file sections", () => {
        const response = `
### File: /index.ts
\`\`\`typescript
export default class MyPlugin {}
\`\`\`

### File: /TODO.md
\`\`\`md
# TODO
\`\`\`
        `;

        const result = parseAiWorkspacePlanResponse(response);
        expect(result.invalidPaths).toEqual([]);
        expect(result.files).toEqual([
            expect.objectContaining({ path: "/index.ts" }),
            expect.objectContaining({ path: "/TODO.md" }),
        ]);
        expect(shouldApplyAiResponseToWorkspace(response)).toBe(true);
    });

    test("tracks invalid host-machine paths separately", () => {
        const response = `
### File: /Users/alexvwan/dev/fdo/index.ts
\`\`\`typescript
export default class MyPlugin {}
\`\`\`
        `;

        const result = parseAiWorkspacePlanResponse(response);
        expect(result.files).toEqual([]);
        expect(result.invalidPaths).toEqual(["/Users/alexvwan/dev/fdo/index.ts"]);
        expect(shouldApplyAiResponseToWorkspace(response)).toBe(true);
    });

    test("does not classify plain code as workspace plan output", () => {
        const response = `
\`\`\`typescript
// SOLUTION READY TO APPLY
const value = 1;
\`\`\`
        `;

        expect(parseAiWorkspacePlanResponse(response)).toEqual({
            files: [],
            invalidPaths: [],
        });
        expect(shouldApplyAiResponseToWorkspace(response)).toBe(false);
    });
});
