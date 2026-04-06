import {
    buildAiCodingDoneStatus,
    buildAiCodingFirstResponseStatus,
    buildAiCodingLaunchStatus,
    buildAiCodingTransportStatus,
    buildAiCodingWaitingStatus,
    upsertAiCodingRequestStatus,
} from "../../src/utils/aiCodingAgentProgress.js";

describe("aiCodingAgentProgress", () => {
    test("builds user-facing waiting milestones", () => {
        expect(buildAiCodingWaitingStatus({ elapsedMs: 0 })).toBe("Analyzing the request and plugin workspace.");
        expect(buildAiCodingWaitingStatus({ elapsedMs: 12000 })).toContain("12s elapsed");
        expect(buildAiCodingWaitingStatus({ elapsedMs: 32000 })).toContain("Larger prompts can take up to about a minute.");
    });

    test("builds retry and completion statuses", () => {
        expect(buildAiCodingLaunchStatus({ assistantName: "Codex" })).toBe("Starting Codex.");
        expect(buildAiCodingFirstResponseStatus(15000)).toContain("15s");
        expect(buildAiCodingDoneStatus(37000)).toBe("Completed in 37s.");
        expect(buildAiCodingTransportStatus("early-retry-without-json")).toContain("Switching");
    });

    test("replaces status entries by phase instead of appending duplicates", () => {
        const first = upsertAiCodingRequestStatus([], "Analyzing the request and plugin workspace.", {
            phase: "waiting-for-first-content",
        });
        expect(first).toHaveLength(1);

        const updated = upsertAiCodingRequestStatus(first, "Still analyzing the request and plugin workspace (12s elapsed).", {
            phase: "waiting-for-first-content",
            elapsedMs: 12000,
        });
        expect(updated).toHaveLength(1);
        expect(updated[0].message).toContain("12s elapsed");

        const nextPhase = upsertAiCodingRequestStatus(updated, "First visible response received after 15s. Drafting the rest of the answer.", {
            phase: "first-content",
            elapsedMs: 15000,
        });
        expect(nextPhase).toHaveLength(2);
        expect(nextPhase[1].message).toContain("15s");
    });
});
