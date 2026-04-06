jest.mock("monaco-editor", () => ({
    editor: {
        getModelMarkers: jest.fn(),
    },
}));

import * as monaco from "monaco-editor";
import {buildAiCodingProblemsContext} from "../../src/components/editor/utils/aiCodingAgentProblems.js";

describe("ai coding agent problems context", () => {
    test("formats current problems into context text", () => {
        monaco.editor.getModelMarkers.mockReturnValue([
            {
                startLineNumber: 3,
                startColumn: 5,
                severity: 8,
                message: "Property 'x' does not exist",
            },
        ]);

        const context = buildAiCodingProblemsContext([
            {
                uri: {
                    toString: () => "file:///index.ts",
                },
            },
        ]);

        expect(context).toContain("Current editor problems:");
        expect(context).toContain("/index.ts:3:5");
        expect(context).toContain("Property 'x' does not exist");
    });

    test("returns empty string when there are no problems", () => {
        monaco.editor.getModelMarkers.mockReturnValue([]);
        expect(buildAiCodingProblemsContext([{ uri: { toString: () => "file:///index.ts" } }])).toBe("");
    });
});

