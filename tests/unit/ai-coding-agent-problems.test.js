jest.mock("monaco-editor", () => ({
    editor: {
        getModelMarkers: jest.fn(),
    },
}));

import * as monaco from "monaco-editor";
import {buildAiCodingProblemsContext, collectAiCodingProblems} from "../../src/components/editor/utils/aiCodingAgentProblems.js";

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

    test("can limit the repair context to error-severity markers", () => {
        monaco.editor.getModelMarkers.mockReturnValue([
            {startLineNumber: 1, startColumn: 1, severity: 4, message: "Style warning"},
            {startLineNumber: 2, startColumn: 3, severity: 8, message: "Type error"},
        ]);
        const models = [{uri: {toString: () => "file:///render.tsx"}}];
        expect(collectAiCodingProblems(models, {errorsOnly: true})).toHaveLength(1);
        expect(buildAiCodingProblemsContext(models, {errorsOnly: true})).toContain("Type error");
        expect(buildAiCodingProblemsContext(models, {errorsOnly: true})).not.toContain("Style warning");
    });
});
