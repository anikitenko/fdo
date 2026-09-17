import {
    HOST_PLUGIN_API_VERSION,
    HOST_PLUGIN_CAPABILITY_SCHEMA_VERSION,
    HOST_PLUGIN_CONTRACT_VERSION,
    HOST_REQUIRED_SDK_FEATURE_FLAGS,
} from "./pluginHostContract";

export const HANDSHAKE_API_INCOMPATIBLE = "HANDSHAKE_API_INCOMPATIBLE";
export const HANDSHAKE_CAPABILITY_SCHEMA_MISMATCH = "HANDSHAKE_CAPABILITY_SCHEMA_MISMATCH";
export const HANDSHAKE_FEATURE_FLAG_MISSING = "HANDSHAKE_FEATURE_FLAG_MISSING";
export const LEGACY_SDK_NO_HANDSHAKE = "LEGACY_SDK_NO_HANDSHAKE";

let cachedOptionalSdkModule;

function getOptionalSdkModule() {
    if (cachedOptionalSdkModule !== undefined) {
        return cachedOptionalSdkModule;
    }

    try {
        cachedOptionalSdkModule = typeof __non_webpack_require__ === "function"
            ? __non_webpack_require__("@anikitenko/fdo-sdk")
            : null;
    } catch (_) {
        cachedOptionalSdkModule = null;
    }

    return cachedOptionalSdkModule;
}

export function __setOptionalSdkHandshakeModuleForTests(value) {
    cachedOptionalSdkModule = value;
}

function parseVersionMajor(value) {
    const normalized = String(value || "").trim();
    const match = normalized.match(/^v?(\d+)/i);
    return match ? Number(match[1]) : null;
}

function normalizeFeatureFlags(flags) {
    if (Array.isArray(flags)) {
        return flags.reduce((acc, flag) => {
            const normalizedFlag = String(flag || "").trim();
            if (normalizedFlag) {
                acc[normalizedFlag] = true;
            }
            return acc;
        }, {});
    }

    if (flags && typeof flags === "object") {
        return Object.entries(flags).reduce((acc, [key, value]) => {
            const normalizedKey = String(key || "").trim();
            if (normalizedKey) {
                acc[normalizedKey] = value === true;
            }
            return acc;
        }, {});
    }

    return {};
}

function normalizeHandshakeStatus(status = "") {
    const normalized = String(status || "").trim().toLowerCase();
    if (normalized === "compatible") {
        return "compatible";
    }
    if (normalized === "warning" || normalized === "needs-attention") {
        return "needs-attention";
    }
    if (normalized === "incompatible") {
        return "incompatible";
    }
    return "needs-attention";
}

function normalizeHandshakeFinding(finding = {}) {
    if (!finding || typeof finding !== "object") {
        return null;
    }
    const code = String(finding.code || "").trim();
    const severity = String(finding.severity || "").trim().toLowerCase();
    const message = String(finding.message || "").trim();
    const remediation = String(finding.remediation || "").trim();
    if (!code && !message) {
        return null;
    }
    return {
        code,
        severity: severity === "error" || severity === "warning" || severity === "info" ? severity : "warning",
        message,
        remediation,
        details: finding.details && typeof finding.details === "object" ? finding.details : {},
    };
}

export function normalizeDiagnosticsHandshake(handshake = null) {
    if (!handshake || typeof handshake !== "object") {
        return null;
    }

    return {
        contractVersion: typeof handshake.contractVersion === "string" ? handshake.contractVersion : "",
        sdkVersion: typeof handshake.sdkVersion === "string" ? handshake.sdkVersion : "",
        apiVersion: typeof handshake.apiVersion === "string" ? handshake.apiVersion : "",
        capabilitySchemaVersion: typeof handshake.capabilitySchemaVersion === "string"
            ? handshake.capabilitySchemaVersion
            : (handshake.capabilitySchemaVersion == null ? "" : String(handshake.capabilitySchemaVersion)),
        featureFlags: normalizeFeatureFlags(handshake.featureFlags),
    };
}

export function getHostHandshakeExpectations(overrides = {}) {
    const sdkModule = getOptionalSdkModule();
    const localSdkHandshake = typeof sdkModule?.getSdkHandshake === "function"
        ? normalizeDiagnosticsHandshake(sdkModule.getSdkHandshake())
        : null;

    const requiredFeatureFlags = Array.isArray(overrides?.requiredFeatureFlags)
        ? overrides.requiredFeatureFlags
        : HOST_REQUIRED_SDK_FEATURE_FLAGS;

    return {
        expectedContractVersion: String(
            overrides?.expectedContractVersion
            || HOST_PLUGIN_CONTRACT_VERSION
            || localSdkHandshake?.contractVersion
            || ""
        ).trim(),
        expectedApiVersion: String(
            overrides?.expectedApiVersion
            || HOST_PLUGIN_API_VERSION
            || localSdkHandshake?.apiVersion
            || ""
        ).trim(),
        expectedCapabilitySchemaVersion: String(
            overrides?.expectedCapabilitySchemaVersion
            || HOST_PLUGIN_CAPABILITY_SCHEMA_VERSION
            || localSdkHandshake?.capabilitySchemaVersion
            || ""
        ).trim(),
        requiredFeatureFlags: [...new Set((Array.isArray(requiredFeatureFlags) ? requiredFeatureFlags : [])
            .map((flag) => String(flag || "").trim())
            .filter(Boolean))],
    };
}

function evaluateLocalFallback(handshake = null, expectations = {}) {
    const findings = [];
    const normalizedHandshake = normalizeDiagnosticsHandshake(handshake);

    if (!normalizedHandshake) {
        findings.push({
            code: LEGACY_SDK_NO_HANDSHAKE,
            severity: "warning",
            message: "Legacy SDK detected: no handshake contract was reported by diagnostics.",
            remediation: "Upgrade the plugin SDK to a version that exposes diagnostics.handshake for explicit host compatibility checks.",
            details: {
                expectedApiVersion: expectations.expectedApiVersion,
                expectedCapabilitySchemaVersion: expectations.expectedCapabilitySchemaVersion,
            },
        });
        return {
            status: "needs-attention",
            handshake: null,
            findings,
            issues: findings,
            summary: "Legacy SDK (no handshake contract). Continuing with conservative compatibility defaults.",
            expected: expectations,
        };
    }

    const expectedApiMajor = parseVersionMajor(expectations.expectedApiVersion);
    const receivedApiMajor = parseVersionMajor(normalizedHandshake.apiVersion);
    if (expectedApiMajor !== null && receivedApiMajor !== null && expectedApiMajor !== receivedApiMajor) {
        findings.push({
            code: HANDSHAKE_API_INCOMPATIBLE,
            severity: "error",
            message: `Plugin API major ${receivedApiMajor} is incompatible with host API major ${expectedApiMajor}.`,
            remediation: `Upgrade plugin SDK or host so both use API major ${expectedApiMajor}.`,
            details: {
                expectedApiVersion: expectations.expectedApiVersion,
                receivedApiVersion: normalizedHandshake.apiVersion,
            },
        });
    }

    if (
        normalizedHandshake.capabilitySchemaVersion
        && expectations.expectedCapabilitySchemaVersion
        && normalizedHandshake.capabilitySchemaVersion !== expectations.expectedCapabilitySchemaVersion
    ) {
        findings.push({
            code: HANDSHAKE_CAPABILITY_SCHEMA_MISMATCH,
            severity: "warning",
            message: `Capability schema version ${normalizedHandshake.capabilitySchemaVersion} differs from host schema ${expectations.expectedCapabilitySchemaVersion}.`,
            remediation: "Upgrade plugin SDK or host capability schema so both sides use the same schema contract.",
            details: {
                expectedCapabilitySchemaVersion: expectations.expectedCapabilitySchemaVersion,
                receivedCapabilitySchemaVersion: normalizedHandshake.capabilitySchemaVersion,
            },
        });
    }

    for (const featureFlag of expectations.requiredFeatureFlags) {
        if (normalizedHandshake.featureFlags?.[featureFlag] !== true) {
            findings.push({
                code: HANDSHAKE_FEATURE_FLAG_MISSING,
                severity: "warning",
                message: `Required SDK feature flag "${featureFlag}" is not enabled.`,
                remediation: `Upgrade plugin SDK or enable feature flag "${featureFlag}" so this host UX path can run on the advertised contract.`,
                details: {
                    requiredFeatureFlag: featureFlag,
                    availableFeatureFlags: normalizedHandshake.featureFlags,
                },
            });
        }
    }

    const hasErrors = findings.some((finding) => finding.severity === "error");
    const hasWarnings = findings.some((finding) => finding.severity === "warning");
    const status = hasErrors ? "incompatible" : (hasWarnings ? "needs-attention" : "compatible");
    return {
        status,
        handshake: normalizedHandshake,
        findings,
        issues: findings,
        summary: hasErrors
            ? "Handshake contract is incompatible with the current host."
            : (hasWarnings
                ? "Handshake contract is usable but needs attention."
                : "Handshake contract is compatible with the current host."),
        expected: expectations,
    };
}

function normalizeSdkCompatibilityResult(result, handshake, expectations) {
    const normalizedHandshake = normalizeDiagnosticsHandshake(result?.handshake || handshake);
    const rawFindings = Array.isArray(result?.issues)
        ? result.issues
        : (Array.isArray(result?.findings) ? result.findings : []);
    const findings = rawFindings
        .map((finding) => normalizeHandshakeFinding(finding))
        .filter(Boolean);
    return {
        status: normalizeHandshakeStatus(result?.status),
        handshake: normalizedHandshake,
        findings,
        issues: findings,
        summary: String(result?.summary || "").trim()
            || "SDK handshake compatibility was evaluated by host policy.",
        expected: expectations,
    };
}

export function evaluatePluginHandshakeCompatibility({
    handshake = null,
    ...overrides
} = {}) {
    const normalizedHandshake = normalizeDiagnosticsHandshake(handshake);
    const expectations = getHostHandshakeExpectations(overrides);
    const sdkModule = getOptionalSdkModule();

    if (typeof sdkModule?.evaluateSdkHandshakeCompatibility === "function") {
        try {
            const result = sdkModule.evaluateSdkHandshakeCompatibility(normalizedHandshake, expectations);
            if (result && typeof result === "object") {
                return normalizeSdkCompatibilityResult(result, normalizedHandshake, expectations);
            }
        } catch (_) {
            // Fall back to host-local evaluator.
        }
    }

    return evaluateLocalFallback(normalizedHandshake, expectations);
}

export function isPluginHandshakeCompatible({
    handshake = null,
    ...overrides
} = {}) {
    const normalizedHandshake = normalizeDiagnosticsHandshake(handshake);
    const expectations = getHostHandshakeExpectations(overrides);
    const sdkModule = getOptionalSdkModule();

    if (typeof sdkModule?.isSdkHandshakeCompatible === "function") {
        try {
            return sdkModule.isSdkHandshakeCompatible(normalizedHandshake, expectations) === true;
        } catch (_) {
            // Fall through to normalized host evaluator.
        }
    }

    return evaluatePluginHandshakeCompatibility({
        handshake: normalizedHandshake,
        ...expectations,
    }).status === "compatible";
}
