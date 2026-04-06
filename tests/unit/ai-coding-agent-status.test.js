import {buildAiCodingAgentStatusMessage} from "../../src/components/editor/utils/aiCodingAgentStatus.js";

describe("ai coding agent status messages", () => {
    test("describes reference analysis explicitly", () => {
        const message = buildAiCodingAgentStatusMessage({
            phase: "reference",
            externalReferenceEnabled: true,
            sdkKnowledgeEnabled: false,
            includeProjectContext: false,
        });

        expect(message).toContain("Analyzing the reference product");
        expect(message).toContain("reference URL");
    });

    test("describes generation with concrete sources", () => {
        const message = buildAiCodingAgentStatusMessage({
            phase: "generation",
            externalReferenceEnabled: true,
            sdkKnowledgeEnabled: true,
            includeProjectContext: true,
        });

        expect(message).toContain("Generating the implementation response");
        expect(message).toContain("reference URL");
        expect(message).toContain("bundled FDO SDK");
        expect(message).toContain("current project files");
    });
});
