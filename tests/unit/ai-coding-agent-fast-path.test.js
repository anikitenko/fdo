import {isAiCodingFastLocalEditPrompt} from "../../src/components/editor/utils/aiCodingAgentFastPath.js";

describe("ai coding agent fast path", () => {
    test("enables fast path for direct plugin-local metadata edits", () => {
        expect(isAiCodingFastLocalEditPrompt(
            "please change plugin's name in metadata from undefined to something useful",
            "smart",
        )).toBe(true);
    });

    test("keeps best-practice prompts off the fast path", () => {
        expect(isAiCodingFastLocalEditPrompt(
            "please change plugin's name in metadata using SDK best practices and production grade UX",
            "smart",
        )).toBe(false);
    });
});
