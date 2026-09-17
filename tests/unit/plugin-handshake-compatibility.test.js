import {
    __setOptionalSdkHandshakeModuleForTests,
    evaluatePluginHandshakeCompatibility,
    getHostHandshakeExpectations,
    isPluginHandshakeCompatible,
} from "../../src/utils/pluginHandshakeCompatibility";

describe("plugin handshake compatibility", () => {
    afterEach(() => {
        __setOptionalSdkHandshakeModuleForTests(undefined);
    });

    test("uses SDK evaluator and normalizes issues/findings shape", () => {
        __setOptionalSdkHandshakeModuleForTests({
            evaluateSdkHandshakeCompatibility: jest.fn(() => ({
                status: "needs-attention",
                summary: "Warnings detected.",
                issues: [{
                    code: "HANDSHAKE_FEATURE_FLAG_MISSING",
                    severity: "warning",
                    message: "Missing required feature flag.",
                    remediation: "Upgrade SDK.",
                    details: {featureFlag: "pluginDoctorReport"},
                }],
            })),
            getSdkHandshake: jest.fn(() => ({
                contractVersion: "1",
                apiVersion: "1.0.0",
                capabilitySchemaVersion: "1",
                featureFlags: {pluginDoctorReport: true},
            })),
        });

        const result = evaluatePluginHandshakeCompatibility({
            handshake: {
                contractVersion: "1",
                apiVersion: "1.0.0",
                capabilitySchemaVersion: "1",
                featureFlags: {},
            },
        });

        expect(result.status).toBe("needs-attention");
        expect(result.findings).toEqual(expect.arrayContaining([
            expect.objectContaining({
                code: "HANDSHAKE_FEATURE_FLAG_MISSING",
                severity: "warning",
            }),
        ]));
    });

    test("falls back to legacy warning mode when handshake is absent", () => {
        __setOptionalSdkHandshakeModuleForTests({});

        const result = evaluatePluginHandshakeCompatibility({
            handshake: null,
        });

        expect(result.status).toBe("needs-attention");
        expect(result.findings).toEqual(expect.arrayContaining([
            expect.objectContaining({
                code: "LEGACY_SDK_NO_HANDSHAKE",
            }),
        ]));
    });

    test("isPluginHandshakeCompatible uses SDK boolean helper when available", () => {
        const isSdkHandshakeCompatible = jest.fn(() => true);
        __setOptionalSdkHandshakeModuleForTests({
            isSdkHandshakeCompatible,
        });

        const compatible = isPluginHandshakeCompatible({
            handshake: {
                contractVersion: "1",
                apiVersion: "1.0.0",
                capabilitySchemaVersion: "1",
                featureFlags: {pluginDoctorReport: true},
            },
        });

        expect(compatible).toBe(true);
        expect(isSdkHandshakeCompatible).toHaveBeenCalledTimes(1);
    });

    test("host handshake expectations expose deterministic contract keys", () => {
        const expectations = getHostHandshakeExpectations();
        expect(expectations).toEqual(expect.objectContaining({
            expectedContractVersion: expect.any(String),
            expectedApiVersion: expect.any(String),
            expectedCapabilitySchemaVersion: expect.any(String),
            requiredFeatureFlags: expect.any(Array),
        }));
    });
});
