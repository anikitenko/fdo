import { getAiCodingAgentIdleTimeoutMs } from "../../src/components/editor/utils/aiCodingAgentTimeouts.js";

describe("ai coding agent idle timeout policy", () => {
    test("uses a longer idle timeout for Codex CLI", () => {
        expect(getAiCodingAgentIdleTimeoutMs("codex-cli")).toBe(180000);
    });

    test("uses the default idle timeout for non-Codex providers", () => {
        expect(getAiCodingAgentIdleTimeoutMs("openai")).toBe(60000);
        expect(getAiCodingAgentIdleTimeoutMs("anthropic")).toBe(60000);
        expect(getAiCodingAgentIdleTimeoutMs("")).toBe(60000);
    });
});
