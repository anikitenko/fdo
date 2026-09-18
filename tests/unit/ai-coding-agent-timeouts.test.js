import { getAiCodingAgentIdleTimeoutMs } from "../../src/components/editor/utils/aiCodingAgentTimeouts.js";

describe("ai coding agent idle timeout policy", () => {
    test("uses a longer idle timeout for CLI providers", () => {
        expect(getAiCodingAgentIdleTimeoutMs("codex-cli")).toBe(180000);
        expect(getAiCodingAgentIdleTimeoutMs("gemini-cli")).toBe(180000);
    });

    test("uses the default idle timeout for non-Codex providers", () => {
        expect(getAiCodingAgentIdleTimeoutMs("openai")).toBe(180000);
        expect(getAiCodingAgentIdleTimeoutMs("anthropic")).toBe(180000);
        expect(getAiCodingAgentIdleTimeoutMs("")).toBe(180000);
    });
});
