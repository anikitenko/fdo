import {
    __setOptionalSdkHandshakeModuleForTests,
    evaluatePluginHandshakeCompatibility,
    getHostHandshakeExpectations,
    isPluginHandshakeCompatible,
} from "../../src/utils/sdk/pluginHandshakeCompatibility";

describe("plugin handshake compatibility", () => {
    test.each([
        ['1.0.0', '1.0.0', 'compatible'],
        ['1.1.0', '1.7.0', 'compatible'],
        ['1', '1', 'compatible'],
        ['2.0.0', '1.0.0', 'incompatible'],
        ['1.0.0', '2.0.0', 'incompatible'],
        ['', '1.0.0', 'incompatible'],
        ['1.0.0', '1-malformed', 'incompatible'],
    ])('released and unknown handshake versions %s / %s have explicit policy', (contractVersion, apiVersion, status) => {
        __setOptionalSdkHandshakeModuleForTests({});
        const report = evaluatePluginHandshakeCompatibility({handshake: {contractVersion, apiVersion,
            sdkVersion: '1.5.2', capabilitySchemaVersion: '1.0.0', featureFlags: {pluginDoctorReport: true}}});
        expect(report.status).toBe(status);
    });
    test('an SDK helper cannot relax invalid host protocol versions', () => {
        __setOptionalSdkHandshakeModuleForTests({evaluateSdkHandshakeCompatibility: () => ({status: 'compatible'}), isSdkHandshakeCompatible: () => true});
        const handshake = {contractVersion: '9.0.0', apiVersion: '1.0.0'};
        expect(evaluatePluginHandshakeCompatibility({handshake}).status).toBe('incompatible');
        expect(isPluginHandshakeCompatible({handshake})).toBe(false);
    });
    test.each([['1.1.0', 'needs-attention'], ['1', 'needs-attention'], ['2.0.0', 'incompatible'], ['bad', 'incompatible']])(
        'capability schema %s keeps additive differences distinct from incompatible formats', (capabilitySchemaVersion, status) => {
            __setOptionalSdkHandshakeModuleForTests({});
            const report = evaluatePluginHandshakeCompatibility({handshake: {contractVersion: '1.0.0', apiVersion: '1.0.0',
                capabilitySchemaVersion, featureFlags: {pluginDoctorReport: true}}});
            expect(report.status).toBe(status);
        });
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
                contractVersion: "1.0.0",
                apiVersion: "1.0.0",
                capabilitySchemaVersion: "1.0.0",
                featureFlags: {pluginDoctorReport: true},
            })),
        });

        const result = evaluatePluginHandshakeCompatibility({
            handshake: {
                contractVersion: "1.0.0",
                apiVersion: "1.0.0",
                capabilitySchemaVersion: "1.0.0",
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
                contractVersion: "1.0.0",
                apiVersion: "1.0.0",
                capabilitySchemaVersion: "1.0.0",
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
        expect(expectations.expectedContractVersion).toBe("1.0.0");
        expect(expectations.expectedCapabilitySchemaVersion).toBe("1.0.0");
    });

    test("accepts the full semantic versions reported by SDK 1.5.2", () => {
        __setOptionalSdkHandshakeModuleForTests({});
        const result = evaluatePluginHandshakeCompatibility({handshake: {
            contractVersion: '1.0.0', sdkVersion: '1.5.2', apiVersion: '1.0.0',
            capabilitySchemaVersion: '1.0.0', featureFlags: {pluginDoctorReport: true},
        }});
        expect(result.status).toBe('compatible');
        expect(result.findings).toEqual([]);
    });
});
