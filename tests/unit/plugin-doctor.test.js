describe("plugin doctor presentation", () => {
    const diagnosticsFixture = {
        apiVersion: "1.0.0",
        pluginId: "plugin-doctor-test",
        handshake: {
            contractVersion: "1",
            sdkVersion: "1.4.0",
            apiVersion: "1.0.0",
            capabilitySchemaVersion: "1",
            featureFlags: {
                pluginDoctorReport: true,
            },
        },
        metadata: {
            name: "Plugin Doctor Test",
            version: "1.0.0",
            author: "Author",
            description: "Desc",
            icon: "cog",
        },
        health: {
            status: "degraded",
            startedAt: "2026-04-15T08:00:00.000Z",
            lastErrorAt: "2026-04-15T08:05:00.000Z",
            lastErrorMessage: "Process execution failed.",
            initCount: 1,
            renderCount: 1,
            handlerCount: 1,
            errorCount: 1,
        },
        capabilities: {
            diagnosticsHandler: "__sdk.getDiagnostics",
            registeredHandlers: ["requestPrivilegedAction", "__sdk.getDiagnostics"],
            registeredStores: [],
            quickActionsCount: 0,
            hasSidePanel: false,
            stores: [],
            declaration: {
                declared: ["system.process.exec", "system.process.scope.terraform"],
                missing: ["system.process.scope.terraform"],
                undeclaredGranted: [],
            },
            permissions: {
                granted: ["system.process.exec"],
                usageCount: {},
                deniedCount: {
                    "system.process.scope.terraform": 1,
                },
            },
        },
        notifications: {
            count: 1,
            capacity: 20,
            recent: [
                {
                    message: "Terraform apply failed",
                    type: "warning",
                    timestamp: "2026-04-15T08:05:00.000Z",
                },
            ],
        },
    };

    afterEach(() => {
        jest.resetModules();
    });

    test("degraded diagnostics map to degraded status with error findings shown", () => {
        const {__setOptionalSdkModuleForTests, createPluginDoctorPresentation} = require("../../src/utils/pluginDoctor");
        const sdkModule = require("@anikitenko/fdo-sdk");
        __setOptionalSdkModuleForTests({
            createPluginDoctorReport: sdkModule.createPluginDoctorReport,
            createPluginDoctorPanelModel: sdkModule.createPluginDoctorPanelModel,
        });

        const result = createPluginDoctorPresentation(diagnosticsFixture, {
            includeInfo: true,
            includeNotificationFindings: true,
        });

        expect(result.mode).toBe("doctor");
        expect(result.report.status).toBe("degraded");
        expect(result.panelModel && typeof result.panelModel === "object").toBe(true);
        expect(result.report.findings.some((finding) => finding.severity === "error")).toBe(true);
        expect(result.handshakeCompatibility.status).toBe("compatible");
    });

    test("missing declared capability produces warning with remediation", () => {
        const {__setOptionalSdkModuleForTests, createPluginDoctorPresentation} = require("../../src/utils/pluginDoctor");
        const sdkModule = require("@anikitenko/fdo-sdk");
        __setOptionalSdkModuleForTests({
            createPluginDoctorReport: sdkModule.createPluginDoctorReport,
        });

        const result = createPluginDoctorPresentation(diagnosticsFixture, {
            includeInfo: true,
            includeNotificationFindings: true,
        });

        const capabilityWarning = result.report.findings.find((finding) => (
            finding.severity === "warning"
            && /capab/i.test(String(finding.category || ""))
        ));

        expect(capabilityWarning).toBeTruthy();
        expect(String(capabilityWarning.remediation || "")).not.toBe("");
    });

    test("API mismatch produces incompatible handshake status", () => {
        const {createPluginDoctorPresentation} = require("../../src/utils/pluginDoctor");

        const result = createPluginDoctorPresentation({
            ...diagnosticsFixture,
            handshake: {
                ...diagnosticsFixture.handshake,
                apiVersion: "2.1.0",
            },
        });

        expect(result.handshakeCompatibility.status).toBe("incompatible");
        expect(result.handshakeCompatibility.findings).toEqual(expect.arrayContaining([
            expect.objectContaining({
                code: "HANDSHAKE_API_INCOMPATIBLE",
                severity: "error",
            }),
        ]));
    });

    test("schema mismatch produces warning but remains boot-compatible", () => {
        const {createPluginDoctorPresentation} = require("../../src/utils/pluginDoctor");

        const result = createPluginDoctorPresentation({
            ...diagnosticsFixture,
            handshake: {
                ...diagnosticsFixture.handshake,
                capabilitySchemaVersion: "2",
            },
        });

        expect(result.handshakeCompatibility.status).toBe("needs-attention");
        expect(result.handshakeCompatibility.findings).toEqual(expect.arrayContaining([
            expect.objectContaining({
                code: "HANDSHAKE_CAPABILITY_SCHEMA_MISMATCH",
                severity: "warning",
            }),
        ]));
    });

    test("missing required feature flag produces warning with remediation", () => {
        const {createPluginDoctorPresentation} = require("../../src/utils/pluginDoctor");

        const result = createPluginDoctorPresentation({
            ...diagnosticsFixture,
            handshake: {
                ...diagnosticsFixture.handshake,
                featureFlags: {},
            },
        });

        expect(result.handshakeCompatibility.status).toBe("needs-attention");
        expect(result.handshakeCompatibility.findings).toEqual(expect.arrayContaining([
            expect.objectContaining({
                code: "HANDSHAKE_FEATURE_FLAG_MISSING",
                severity: "warning",
                remediation: expect.any(String),
            }),
        ]));
    });

    test("toggles recompute plugin doctor options instead of filtering post-hoc", () => {
        const createPluginDoctorReport = jest.fn((_diagnostics, options) => ({
            pluginId: "plugin-doctor-test",
            generatedAt: "2026-04-15T08:05:00.000Z",
            status: options.includeInfo ? "healthy" : "needs-attention",
            summary: "ok",
            counts: {
                error: 0,
                warning: 0,
                info: options.includeInfo ? 1 : 0,
            },
            findings: options.includeNotificationFindings ? [{
                code: "TEST_INFO",
                severity: options.includeInfo ? "info" : "warning",
                category: "notifications",
                message: "notification finding",
                remediation: "toggle verified",
            }] : [],
        }));
        const createPluginDoctorPanelModel = jest.fn((report, _options) => ({
            pluginId: report.pluginId,
            status: report.status,
            summary: report.summary,
            blocking: false,
            counts: {
                total: report.findings.length,
                error: report.counts.error,
                warning: report.counts.warning,
                info: report.counts.info,
            },
            prioritizedFindings: report.findings.slice(0, 8),
            sections: [],
        }));
        const {
            __setOptionalSdkModuleForTests,
            createPluginDoctorPresentation,
        } = require("../../src/utils/pluginDoctor");

        __setOptionalSdkModuleForTests({
            createPluginDoctorReport,
            createPluginDoctorPanelModel,
        });

        createPluginDoctorPresentation(diagnosticsFixture, {
            includeInfo: true,
            includeNotificationFindings: true,
        });
        createPluginDoctorPresentation(diagnosticsFixture, {
            includeInfo: false,
            includeNotificationFindings: false,
        });

        expect(createPluginDoctorReport).toHaveBeenNthCalledWith(1, diagnosticsFixture, {
            includeInfo: true,
            includeNotificationFindings: true,
            handshake: expect.objectContaining({
                expectedContractVersion: expect.any(String),
                expectedApiVersion: expect.any(String),
                expectedCapabilitySchemaVersion: expect.any(String),
                requiredFeatureFlags: expect.any(Array),
            }),
        });
        expect(createPluginDoctorReport).toHaveBeenNthCalledWith(2, diagnosticsFixture, {
            includeInfo: false,
            includeNotificationFindings: false,
            handshake: expect.objectContaining({
                expectedContractVersion: expect.any(String),
                expectedApiVersion: expect.any(String),
                expectedCapabilitySchemaVersion: expect.any(String),
                requiredFeatureFlags: expect.any(Array),
            }),
        });
        expect(createPluginDoctorPanelModel).toHaveBeenCalledWith(expect.any(Object), {
            maxPrioritizedFindings: 8,
        });
    });

    test("panel model supports blocking and non-blocking outcomes", () => {
        const createPluginDoctorReport = jest.fn(() => ({
            pluginId: "plugin-doctor-test",
            generatedAt: "2026-04-15T08:05:00.000Z",
            status: "degraded",
            summary: "degraded",
            counts: {error: 1, warning: 0, info: 0},
            findings: [{code: "PROCESS_EXIT_NON_ZERO", severity: "error", message: "failed", remediation: "fix"}],
        }));
        const createPluginDoctorPanelModel = jest
            .fn()
            .mockReturnValueOnce({
                pluginId: "plugin-doctor-test",
                status: "degraded",
                summary: "blocking",
                blocking: true,
                counts: {total: 1, error: 1, warning: 0, info: 0},
                prioritizedFindings: [{code: "PROCESS_EXIT_NON_ZERO", severity: "error", message: "failed", exactFix: "fdo sdk migrate ..."}],
                sections: [],
            })
            .mockReturnValueOnce({
                pluginId: "plugin-doctor-test",
                status: "needs-attention",
                summary: "non-blocking",
                blocking: false,
                counts: {total: 1, error: 0, warning: 1, info: 0},
                prioritizedFindings: [{code: "HANDSHAKE_FEATURE_FLAG_MISSING", severity: "warning", message: "missing flag"}],
                sections: [],
            });

        const {
            __setOptionalSdkModuleForTests,
            createPluginDoctorPresentation,
        } = require("../../src/utils/pluginDoctor");
        __setOptionalSdkModuleForTests({
            createPluginDoctorReport,
            createPluginDoctorPanelModel,
        });

        const blocking = createPluginDoctorPresentation(diagnosticsFixture, {
            includeInfo: true,
            includeNotificationFindings: true,
        });
        const nonBlocking = createPluginDoctorPresentation(diagnosticsFixture, {
            includeInfo: false,
            includeNotificationFindings: false,
        });

        expect(blocking.panelModel.blocking).toBe(true);
        expect(blocking.panelModel.prioritizedFindings[0].exactFix).toContain("fdo");
        expect(nonBlocking.panelModel.blocking).toBe(false);
    });

    test("absent handshake stays usable in legacy warning mode", () => {
        const {createPluginDoctorPresentation} = require("../../src/utils/pluginDoctor");

        const result = createPluginDoctorPresentation({
            ...diagnosticsFixture,
            handshake: undefined,
        });

        expect(result.handshakeCompatibility.status).toBe("needs-attention");
        expect(result.handshakeCompatibility.findings).toEqual(expect.arrayContaining([
            expect.objectContaining({
                code: "LEGACY_SDK_NO_HANDSHAKE",
                severity: "warning",
            }),
        ]));
    });
});
