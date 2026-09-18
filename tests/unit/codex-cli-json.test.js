import {extractCodexJsonProgress, extractCodexJsonEventText, extractCodexFailure} from "../../src/utils/codexCliJson.js";

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

test("reads current Codex snake_case assistant events", () => {
    expect(extractCodexJsonEventText(JSON.stringify({type: "item.completed", item: {type: "agent_message", text: "Generated plugin"}}))).toBe("Generated plugin");
});

test("prefers the actual failed-turn message over stdin notices", () => {
    expect(extractCodexFailure(JSON.stringify({type: "turn.failed", error: {message: "Model unavailable"}}), "Reading additional input from stdin..."))
        .toBe("Model unavailable");
    expect(extractCodexFailure("", "Reading additional input from stdin...\nAuthentication failed")).toBe("Authentication failed");
    expect(extractCodexFailure("", "Reading additional input from stdin...")).toBe("");
});
