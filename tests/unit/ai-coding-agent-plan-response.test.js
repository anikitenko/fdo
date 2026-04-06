import {
    parseAiWorkspacePlanResponse,
    shouldApplyAiResponseToWorkspace,
} from "../../src/components/editor/utils/aiCodingAgentPlanResponse.js";

describe("ai coding agent workspace plan response", () => {
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

