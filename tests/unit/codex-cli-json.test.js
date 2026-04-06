import {extractCodexJsonProgress} from "../../src/utils/codexCliJson.js";

describe("codex CLI JSON progress extraction", () => {
    test("uses friendly wording for turn start", () => {
        const message = extractCodexJsonProgress(JSON.stringify({
            type: "turn.started",
        }));

        expect(message).toBe("Codex is analyzing the request and workspace.");
    });

    test("summarizes internal assistant progress without exposing raw transport details", () => {
        const message = extractCodexJsonProgress(JSON.stringify({
            type: "item.completed",
            item: {
                type: "agentMessage",
                text: "internal planning",
            },
        }));

        expect(message).toBe("Codex is preparing the first answer.");
    });
});
