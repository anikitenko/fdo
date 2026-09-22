import {
    buildAiCodingDoneStatus,
    buildAiCodingFirstResponseStatus,
    buildAiCodingLaunchStatus,
    buildAiCodingTransportStatus,
    buildAiCodingWaitingStatus,
    buildAiCodingStreamStatus,
    createAiCodingStreamProgress,
    recordAiCodingStreamText,
    upsertAiCodingRequestStatus,
} from "../../src/utils/aiCodingAgentProgress.js";

describe("aiCodingAgentProgress", () => {
    test("reports received text and measured throughput without estimating completion", () => {
        const progress = createAiCodingStreamProgress();
        expect(buildAiCodingStreamStatus(progress, 0)).toBe("");
        recordAiCodingStreamText(progress, "a".repeat(998), 0);
        recordAiCodingStreamText(progress, "\n ", 10000);
        expect(buildAiCodingStreamStatus(progress, 10000)).toBe(
            "1,000 answer characters received · 100 chars/s average. Receiving answer text.");
        expect(buildAiCodingStreamStatus(progress, 15000)).toContain("Last answer text 5s ago.");
        expect(buildAiCodingStreamStatus(progress, 40000)).toContain("No new answer text for 30s.");
        recordAiCodingStreamText(progress, "Resumed", 41000);
        expect(buildAiCodingStreamStatus(progress, 41000)).toContain("Receiving answer text.");
        expect(buildAiCodingStreamStatus(createAiCodingStreamProgress(), 41000)).toBe("");
    });
    test("shows a resumed phase as the latest activity without duplicating it", () => {
        let entries = upsertAiCodingRequestStatus([], "Running tests", {phase: "tests"});
        entries = upsertAiCodingRequestStatus(entries, "Correcting code", {phase: "generation"});
        entries = upsertAiCodingRequestStatus(entries, "Verifying corrected code", {phase: "tests"});
        expect(entries.map(entry => entry.message)).toEqual(["Correcting code", "Verifying corrected code"]);
    });
    test("builds user-facing waiting milestones", () => {
        expect(buildAiCodingWaitingStatus({ elapsedMs: 0 })).toBe("Analyzing the request and plugin workspace.");
        expect(buildAiCodingWaitingStatus({ elapsedMs: 12000 })).toContain("12s elapsed");
        expect(buildAiCodingWaitingStatus({ elapsedMs: 32000 })).toContain("Prompt or image processing may still be in progress.");
    });

    test("uses provider transport feedback without speculative processing claims", () => {
        const transportStatus = "Waiting for the complete response from Cloudflare. This request returns its answer all at once.";
        expect(buildAiCodingWaitingStatus({elapsedMs: 120000, transportStatus}))
            .toBe(`${transportStatus} (120s elapsed)`);
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

    test("does not repeat a lifecycle message emitted by a transport retry", () => {
        const first = upsertAiCodingRequestStatus([], "Starting the coding assistant.", {
            phase: "launch",
        });
        const repeated = upsertAiCodingRequestStatus(first, "Starting the coding assistant.", {
            phase: "retry-launch",
        });

        expect(repeated).toEqual(first);
    });
});
