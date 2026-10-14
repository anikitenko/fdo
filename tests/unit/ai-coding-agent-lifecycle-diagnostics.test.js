import fs from "node:fs";
import {AiCodingAgentChannels} from "../../src/ipc/channels.js";

const readLifecycle = () => globalThis.__FDO_E2E_CODING_LIFECYCLE__ || [];

describe("renderer-reported coding lifecycle diagnostics", () => {
    let previousE2E;
    let handleRecordLifecycle;

    beforeEach(() => {
        // The recorder keeps module state (E2E gate result, status dedupe key);
        // a fresh module instance keeps every test independent.
        jest.resetModules();
        previousE2E = process.env.FDO_E2E;
        process.env.FDO_E2E = "1";
        delete globalThis.__FDO_E2E_CODING_LIFECYCLE__;
        ({handleRecordLifecycle} = require("../../src/ipc/ai_coding_agent.js"));
    });

    afterEach(() => {
        if (previousE2E === undefined) delete process.env.FDO_E2E;
        else process.env.FDO_E2E = previousE2E;
        delete globalThis.__FDO_E2E_CODING_LIFECYCLE__;
    });

    test("records a retry phase together with its validation errors", () => {
        const result = handleRecordLifecycle(null, {
            event: "plan-retry-validation",
            requestId: "1790081682380-4dvoy1iy1",
            details: {phase: "plan-retry-validation", fileCount: 22, validationErrors: ["/index.ts: forbidden host import"]},
        });

        expect(result).toEqual({recorded: true});
        expect(readLifecycle()).toEqual([
            expect.objectContaining({
                event: "plan-retry-validation",
                requestId: "1790081682380-4dvoy1iy1",
                phase: "plan-retry-validation",
                fileCount: 22,
                validationErrors: ["/index.ts: forbidden host import"],
                at: expect.any(String),
            }),
        ]);
    });

    test("mirrors request-status transitions with their phase metadata", () => {
        handleRecordLifecycle(null, {
            event: "request-status",
            requestId: "",
            details: {message: "Problems panel found generated-code errors.", phase: "plan-retry-problems"},
        });

        expect(readLifecycle()[0]).toMatchObject({event: "request-status", phase: "plan-retry-problems"});
    });

    test("collapses consecutive duplicate status lines but keeps interleaved ones", () => {
        const status = {
            event: "request-status",
            requestId: "req-7",
            details: {message: "Generating the implementation response.", phase: "generation"},
        };

        expect(handleRecordLifecycle(null, status)).toEqual({recorded: true});
        expect(handleRecordLifecycle(null, status)).toEqual({recorded: false, reason: "duplicate"});
        expect(handleRecordLifecycle(null, {...status, details: {message: "Different line.", phase: "generation"}}))
            .toEqual({recorded: true});
        expect(handleRecordLifecycle(null, status)).toEqual({recorded: true});
        expect(readLifecycle()).toHaveLength(3);
    });

    test("stamps its own envelope so caller details cannot shadow it", () => {
        handleRecordLifecycle(null, {
            event: "plan-retry-problems",
            requestId: "req-1",
            details: {event: "spoofed", requestId: "spoofed", at: "spoofed", problemsContext: "TS2322: type mismatch"},
        });

        expect(readLifecycle()[0]).toMatchObject({
            event: "plan-retry-problems",
            requestId: "req-1",
            problemsContext: "TS2322: type mismatch",
        });
        expect(readLifecycle()[0].at).not.toBe("spoofed");
    });

    test("redacts credential-shaped values and bounds string length", () => {
        handleRecordLifecycle(null, {
            event: "request-status",
            details: {
                message: `api_key=cf_secret_value_1234567890 bearer abc.authorization = zzz ${"x".repeat(600)}`,
                token: "sk-abcdefgh12345678",
            },
        });

        const record = readLifecycle()[0];
        expect(record.message).not.toContain("cf_secret_value_1234567890");
        expect(record.message).not.toContain("zzz");
        expect(record.message).toContain("api_key=[REDACTED]");
        expect(record.message.length).toBeLessThanOrEqual(500);
        expect(record.token).toBe("[REDACTED]");
    });

    test("bounds arrays, nesting, and key counts", () => {
        handleRecordLifecycle(null, {
            event: "request-status",
            details: {
                errors: Array.from({length: 100}, (_, index) => `error-${index}`),
                deep: {a: {b: {c: {d: "too-deep"}}}},
                extra: Object.fromEntries(Array.from({length: 50}, (_, index) => [`k${index}`, index])),
            },
        });

        const record = readLifecycle()[0];
        expect(record.errors).toHaveLength(25);
        expect(record.deep.a.b).toBe("[truncated]");
        expect(Object.keys(record.extra)).toHaveLength(25);
    });

    test("rejects events outside the controlled vocabulary", () => {
        expect(handleRecordLifecycle(null, {})).toEqual({recorded: false, reason: "invalid-event"});
        expect(handleRecordLifecycle(null, {event: "   "})).toEqual({recorded: false, reason: "invalid-event"});
        expect(handleRecordLifecycle(null, {event: "Plan Retry"})).toEqual({recorded: false, reason: "invalid-event"});
        expect(handleRecordLifecycle(null, {event: "x".repeat(200)})).toEqual({recorded: false, reason: "invalid-event"});
        expect(readLifecycle()).toEqual([]);
    });

    test("tolerates non-object details instead of throwing", () => {
        expect(handleRecordLifecycle(null, {event: "request-status", details: "not-an-object"})).toEqual({recorded: true});
        expect(readLifecycle()[0]).toMatchObject({event: "request-status"});
    });

    test("records nothing outside an E2E run", () => {
        process.env.FDO_E2E = "0";
        jest.resetModules();
        ({handleRecordLifecycle} = require("../../src/ipc/ai_coding_agent.js"));
        expect(handleRecordLifecycle(null, {event: "request-status", details: {phase: "tests"}}))
            .toEqual({recorded: false, reason: "disabled"});
        expect(readLifecycle()).toEqual([]);
    });

    test("exposes the channel and preload bridge used by the renderer", () => {
        expect(AiCodingAgentChannels.RECORD_LIFECYCLE).toBe("ai-coding-agent:record-lifecycle");
        const preload = fs.readFileSync("src/preload.js", "utf8");
        expect(preload).toContain("AiCodingAgentChannels.RECORD_LIFECYCLE");
        const panel = fs.readFileSync("src/components/editor/AiCodingAgentPanel.jsx", "utf8");
        expect(panel).toContain('recordCodingLifecycle("plan-retry-validation"');
        expect(panel).toContain('recordCodingLifecycle("plan-retry-problems"');
    });
});
