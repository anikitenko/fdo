import {
    isWorkspaceQualityReviewPrompt,
    WORKSPACE_REPAIR_PROMPT,
    WORKSPACE_REVIEW_PROMPT,
} from "../../src/components/editor/utils/aiCodingAgentReview";

describe("AI Coding Agent workspace review prompts", () => {
    test("keeps review first and repair workflows distinct", () => {
        expect(isWorkspaceQualityReviewPrompt(WORKSPACE_REVIEW_PROMPT)).toBe(true);
        expect(WORKSPACE_REVIEW_PROMPT).toContain("Do not modify files");
        expect(WORKSPACE_REPAIR_PROMPT).toContain("Automatically repair");
        expect(WORKSPACE_REPAIR_PROMPT).toContain("Re-run plugin tests");
    });
});
