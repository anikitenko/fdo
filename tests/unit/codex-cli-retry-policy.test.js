import {
    CODEX_JSON_EARLY_RETRY_MS,
    shouldRetryCodexWithoutJsonEarly,
} from "../../src/utils/ai/codex/codexCliRetryPolicy.js";

describe("codex CLI retry policy", () => {
    test("switches away from JSON mode after 15 seconds of progress-only events", () => {
        expect(shouldRetryCodexWithoutJsonEarly({
            jsonMode: true,
            retrying: false,
            elapsedMs: CODEX_JSON_EARLY_RETRY_MS,
            hasFirstContent: false,
            progressEventCount: 2,
            hasJsonEventStream: true,
        })).toBe(true);
    });

    test("does not switch if visible content already started", () => {
        expect(shouldRetryCodexWithoutJsonEarly({
            jsonMode: true,
            retrying: false,
            elapsedMs: CODEX_JSON_EARLY_RETRY_MS,
            hasFirstContent: true,
            progressEventCount: 4,
            hasJsonEventStream: true,
        })).toBe(false);
    });
});


test('does not restart an active turn just because reasoning has produced no visible answer',()=>{
    expect(shouldRetryCodexWithoutJsonEarly({jsonMode:true,generationActive:true,elapsedMs:240000,progressEventCount:8,hasJsonEventStream:true})).toBe(false);
});
