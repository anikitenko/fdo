import {getPluginTrustTier, summarizePrivilegedRuntime, pluginFailureReviewKey, hasUnreviewedPluginFailures} from "../../src/utils/plugins/security/pluginTrustTier";

describe("plugin trust tier", () => {
    test("classifies basic ui/data plugins", () => {
        expect(getPluginTrustTier(["storage.json"])).toEqual(expect.objectContaining({
            id: "basic-ui-data",
        }));
    });

    test("classifies scoped operator plugins", () => {
        expect(getPluginTrustTier(["system.process.exec", "system.process.scope.docker-cli"])).toEqual(expect.objectContaining({
            id: "scoped-operator",
        }));
    });

    test("classifies fallback-scope plugins as high trust", () => {
        expect(getPluginTrustTier(["system.process.exec", "system.process.scope.system-observe"])).toEqual(expect.objectContaining({
            id: "high-trust-administrative",
        }));
    });

    test("classifies clipboard read as high trust", () => {
        expect(getPluginTrustTier(["system.clipboard.read"])).toEqual(expect.objectContaining({
            id: "high-trust-administrative",
        }));
    });

    test("classifies clipboard write as privileged operator trust", () => {
        expect(getPluginTrustTier(["system.clipboard.write"])).toEqual(expect.objectContaining({
            id: "scoped-operator",
        }));
    });

    test("summarizes privileged runtime outcomes", () => {
        expect(summarizePrivilegedRuntime([
            {success: true, timestamp: "2026-04-07T10:00:00.000Z"},
            {success: false, timestamp: "2026-04-07T10:01:00.000Z", error: {code: "PROCESS_SPAWN_ENOENT"}},
            {success: false, timestamp: "2026-04-07T10:02:00.000Z", confirmationDecision: "denied", workflowId: "wf-1", error: {code: "CANCELLED"}},
        ])).toEqual(expect.objectContaining({
            totalEvents: 3,
            successCount: 1,
            failureCount: 2,
            workflowCount: 1,
            approvalDenialCount: 1,
            latestFailureCode: "CANCELLED",
        }));
    });
});

test('review acknowledgment survives identical polling and success events but detects a new failure at the history limit', () => {
    const failure = {id: 'failed-1', success: false, timestamp: '2026-10-18T10:00:00Z', error: {code: 'CONNECTION_FAILED'}};
    const summary = summarizePrivilegedRuntime([failure]);
    expect(hasUnreviewedPluginFailures(summary)).toBe(true);
    const reviewed = pluginFailureReviewKey(summary);
    expect(hasUnreviewedPluginFailures(summarizePrivilegedRuntime([failure]), reviewed)).toBe(false);
    expect(hasUnreviewedPluginFailures(summarizePrivilegedRuntime([failure, {success: true, timestamp: '2026-10-18T10:01:00Z'}]), reviewed)).toBe(false);
    expect(hasUnreviewedPluginFailures(summarizePrivilegedRuntime([{...failure, id: 'failed-2'}]), reviewed)).toBe(true);
    expect(hasUnreviewedPluginFailures(summarizePrivilegedRuntime([]), reviewed)).toBe(false);
});
