import os from "node:os";
import path from "node:path";

export const PROCESS_SCOPE_POLICY_VERSION = 1;

function defaultCwdRoots() {
    const roots = [process.cwd(), os.tmpdir(), os.homedir()].filter(Boolean);
    return Object.freeze([...new Set(roots)]);
}

function uniqueStrings(values = []) {
    return Object.freeze([...new Set((Array.isArray(values) ? values : []).filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()))]);
}

function buildWindowsPath(root = "", relativePath = "") {
    const normalizedRoot = String(root || "").trim();
    const normalizedRelativePath = String(relativePath || "").trim();
    if (!normalizedRoot || !normalizedRelativePath) return "";
    return path.win32.join(normalizedRoot, ...normalizedRelativePath.split(/[\\/]+/).filter(Boolean));
}

function windowsProgramRoots() {
    return uniqueStrings([
        process.env.ProgramFiles,
        process.env["ProgramFiles(x86)"],
        process.env.LOCALAPPDATA,
        "C:\\Program Files",
        "C:\\Program Files (x86)",
        "C:\\Users\\Default\\AppData\\Local",
    ]);
}

function windowsSystemRoots() {
    return uniqueStrings([
        process.env.SystemRoot,
        "C:\\Windows",
    ]);
}

function buildExecutableCandidates({
    unixPaths = [],
    unixDirExecutables = [],
    unixDirs = ["/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", "/bin", "/usr/local/sbin", "/usr/sbin", "/sbin", "/snap/bin"],
    windowsPaths = [],
    windowsProgramExecutables = [],
    windowsProgramDirs = [],
    windowsSystemExecutables = [],
    windowsSystemDirs = ["System32", "SysWOW64"],
    windowsUserExecutables = [],
    windowsUserDirs = ["Programs", "Microsoft\\WindowsApps", "scoop\\shims"],
} = {}) {
    const unixGenerated = (Array.isArray(unixDirExecutables) ? unixDirExecutables : []).flatMap((name) =>
        (Array.isArray(unixDirs) ? unixDirs : []).map((dir) => path.posix.join(dir, name))
    );
    const windowsProgramGenerated = (Array.isArray(windowsProgramExecutables) ? windowsProgramExecutables : []).flatMap((relativeName) =>
        windowsProgramRoots().flatMap((root) =>
            [".", ...(Array.isArray(windowsProgramDirs) ? windowsProgramDirs : [])].map((relativeDir) => {
                const relativePath = relativeDir === "." ? relativeName : `${relativeDir}\\${relativeName}`;
                return buildWindowsPath(root, relativePath);
            })
        )
    );
    const windowsSystemGenerated = (Array.isArray(windowsSystemExecutables) ? windowsSystemExecutables : []).flatMap((relativeName) =>
        windowsSystemRoots().flatMap((root) =>
            (Array.isArray(windowsSystemDirs) ? windowsSystemDirs : []).map((relativeDir) => buildWindowsPath(root, `${relativeDir}\\${relativeName}`))
        )
    );
    const windowsUserGenerated = (Array.isArray(windowsUserExecutables) ? windowsUserExecutables : []).flatMap((relativeName) =>
        uniqueStrings([process.env.LOCALAPPDATA, "C:\\Users\\Default\\AppData\\Local"]).flatMap((root) =>
            (Array.isArray(windowsUserDirs) ? windowsUserDirs : []).map((relativeDir) => buildWindowsPath(root, `${relativeDir}\\${relativeName}`))
        )
    );

    return uniqueStrings([
        ...(Array.isArray(unixPaths) ? unixPaths : []),
        ...unixGenerated,
        ...(Array.isArray(windowsPaths) ? windowsPaths : []),
        ...windowsProgramGenerated,
        ...windowsSystemGenerated,
        ...windowsUserGenerated,
    ]);
}

function uniqueNormalizedStringList(values = []) {
    return [...new Set((Array.isArray(values) ? values : [])
        .filter((value) => typeof value === "string" && value.trim())
        .map((value) => value.trim()))];
}

function normalizeArgumentRulesByExecutable(rulesByExecutable = {}) {
    return Object.freeze(Object.fromEntries(
        Object.entries((rulesByExecutable && typeof rulesByExecutable === "object") ? rulesByExecutable : {})
            .map(([executableName, rule]) => [String(executableName || "").trim(), rule])
            .filter(([executableName]) => executableName)
            .map(([executableName, rule]) => [
                executableName,
                Object.freeze({
                    allowedFirstArgs: Object.freeze(uniqueNormalizedStringList(rule?.allowedFirstArgs)),
                    deniedFirstArgs: Object.freeze(uniqueNormalizedStringList(rule?.deniedFirstArgs)),
                    allowedLeadingOptions: Object.freeze(uniqueNormalizedStringList(rule?.allowedLeadingOptions)),
                    pathRestrictedLeadingOptions: Object.freeze(uniqueNormalizedStringList(rule?.pathRestrictedLeadingOptions)),
                }),
            ])
    ));
}

function normalizeAdditionalAllowedFirstArgsByExecutable(values = {}) {
    return Object.freeze(Object.fromEntries(
        Object.entries((values && typeof values === "object") ? values : {})
            .map(([executableName, firstArgs]) => [
                String(executableName || "").trim(),
                Object.freeze(uniqueNormalizedStringList(firstArgs)),
            ])
            .filter(([executableName, firstArgs]) => executableName && firstArgs.length > 0)
    ));
}

function normalizeArgumentPolicy(policy = {}) {
    if (!policy || typeof policy !== "object") {
        return null;
    }
    const normalizedVersion = Number.isFinite(Number(policy?.version)) && Number(policy.version) > 0
        ? Math.trunc(Number(policy.version))
        : PROCESS_SCOPE_POLICY_VERSION;
    const mode = String(policy?.mode || "").trim();
    if (mode === "first-arg") {
        return Object.freeze({
            version: normalizedVersion,
            mode: "first-arg",
            allowedFirstArgs: Object.freeze(uniqueNormalizedStringList(policy?.allowedFirstArgs)),
            deniedFirstArgs: Object.freeze(uniqueNormalizedStringList(policy?.deniedFirstArgs)),
            allowedLeadingOptions: Object.freeze(uniqueNormalizedStringList(policy?.allowedLeadingOptions)),
            pathRestrictedLeadingOptions: Object.freeze(uniqueNormalizedStringList(policy?.pathRestrictedLeadingOptions)),
        });
    }
    if (mode === "first-arg-by-executable") {
        const rulesByExecutable = normalizeArgumentRulesByExecutable(policy?.rulesByExecutable);
        return Object.freeze({
            version: normalizedVersion,
            mode: "first-arg-by-executable",
            rulesByExecutable,
        });
    }
    return null;
}

function extractAdditionalAllowedFirstArgOverrides(scope = {}) {
    return Object.freeze({
        allowedFirstArgs: Object.freeze(uniqueNormalizedStringList(scope?.additionalAllowedFirstArgs)),
        byExecutable: normalizeAdditionalAllowedFirstArgsByExecutable(scope?.additionalAllowedFirstArgsByExecutable),
        allowedLeadingOptions: Object.freeze(uniqueNormalizedStringList(scope?.additionalAllowedLeadingOptions)),
        byExecutableLeadingOptions: normalizeAdditionalAllowedFirstArgsByExecutable(scope?.additionalAllowedLeadingOptionsByExecutable),
    });
}

function withArgumentPolicy(validator, argumentPolicy) {
    const normalizedPolicy = normalizeArgumentPolicy(argumentPolicy);
    if (typeof validator === "function" && normalizedPolicy) {
        Object.defineProperty(validator, "argumentPolicy", {
            value: normalizedPolicy,
            writable: false,
            configurable: false,
            enumerable: false,
        });
    }
    return validator;
}

function applyAdditionalAllowedFirstArgs(basePolicy, overrides = {}) {
    const normalizedBase = normalizeArgumentPolicy(basePolicy);
    if (!normalizedBase) {
        return null;
    }
    const extraAllowedFirstArgs = uniqueNormalizedStringList(overrides?.allowedFirstArgs);
    const extraByExecutable = normalizeAdditionalAllowedFirstArgsByExecutable(overrides?.byExecutable);
    const extraAllowedLeadingOptions = uniqueNormalizedStringList(overrides?.allowedLeadingOptions);
    const extraByExecutableLeadingOptions = normalizeAdditionalAllowedFirstArgsByExecutable(overrides?.byExecutableLeadingOptions);

    if (normalizedBase.mode === "first-arg") {
        return Object.freeze({
            version: normalizedBase.version || PROCESS_SCOPE_POLICY_VERSION,
            mode: "first-arg",
            allowedFirstArgs: Object.freeze(uniqueNormalizedStringList([
                ...normalizedBase.allowedFirstArgs,
                ...extraAllowedFirstArgs,
            ])),
            deniedFirstArgs: Object.freeze(uniqueNormalizedStringList(normalizedBase.deniedFirstArgs)),
            allowedLeadingOptions: Object.freeze(uniqueNormalizedStringList([
                ...(Array.isArray(normalizedBase.allowedLeadingOptions) ? normalizedBase.allowedLeadingOptions : []),
                ...extraAllowedLeadingOptions,
            ])),
            pathRestrictedLeadingOptions: Object.freeze(uniqueNormalizedStringList(
                normalizedBase.pathRestrictedLeadingOptions
            )),
        });
    }
    if (normalizedBase.mode === "first-arg-by-executable") {
        const mergedRules = Object.entries(normalizedBase.rulesByExecutable || {}).map(([executableName, rule]) => {
            const extraForExecutable = extraByExecutable?.[executableName] || [];
            const extraLeadingForExecutable = extraByExecutableLeadingOptions?.[executableName] || [];
            return [
                executableName,
                {
                    allowedFirstArgs: uniqueNormalizedStringList([
                        ...(Array.isArray(rule?.allowedFirstArgs) ? rule.allowedFirstArgs : []),
                        ...extraForExecutable,
                    ]),
                    deniedFirstArgs: uniqueNormalizedStringList(rule?.deniedFirstArgs),
                    allowedLeadingOptions: uniqueNormalizedStringList([
                        ...(Array.isArray(rule?.allowedLeadingOptions) ? rule.allowedLeadingOptions : []),
                        ...extraLeadingForExecutable,
                    ]),
                    pathRestrictedLeadingOptions: uniqueNormalizedStringList(rule?.pathRestrictedLeadingOptions),
                },
            ];
        });
        return Object.freeze({
            version: normalizedBase.version || PROCESS_SCOPE_POLICY_VERSION,
            mode: "first-arg-by-executable",
            rulesByExecutable: normalizeArgumentRulesByExecutable(Object.fromEntries(mergedRules)),
        });
    }
    return normalizedBase;
}

function isAllowedLeadingOptionValueCandidate(token = "", {
    allowed = new Set(),
    denied = new Set(),
} = {}) {
    const normalized = String(token || "").trim();
    if (!normalized) {
        return false;
    }
    if (normalized.startsWith("-")) {
        return false;
    }
    if (allowed.has(normalized) || denied.has(normalized)) {
        return false;
    }
    return true;
}

function isPathUnderRoot(targetPath = "", rootPath = "") {
    const normalizedTarget = path.resolve(String(targetPath || "").trim());
    const normalizedRoot = path.resolve(String(rootPath || "").trim());
    if (!normalizedTarget || !normalizedRoot) {
        return false;
    }
    const relative = path.relative(normalizedRoot, normalizedTarget);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isPathWithinAllowedRoots(targetPath = "", allowedRoots = []) {
    if (!path.isAbsolute(String(targetPath || "").trim())) {
        return false;
    }
    return (Array.isArray(allowedRoots) ? allowedRoots : []).some((root) => isPathUnderRoot(targetPath, root));
}

function splitOptionToken(token = "") {
    const normalized = String(token || "").trim();
    if (!normalized.startsWith("--") || !normalized.includes("=")) {
        return {optionName: normalized, inlineValue: ""};
    }
    const separatorIndex = normalized.indexOf("=");
    return {
        optionName: normalized.slice(0, separatorIndex),
        inlineValue: normalized.slice(separatorIndex + 1),
    };
}

function buildArgumentPolicyViolation({
    reason = "",
    message = "",
    argument = "",
    argumentPath = "",
    scope = "",
    executableName = "",
    pathSource = "",
} = {}) {
    const normalizedMessage = String(message || "").trim();
    if (!normalizedMessage) {
        return "";
    }
    const violation = {
        reason: String(reason || "").trim().toUpperCase() || "ARGUMENT_POLICY_VIOLATION",
        message: normalizedMessage,
    };
    const normalizedArgument = String(argument || "").trim();
    if (normalizedArgument) {
        violation.argument = normalizedArgument;
    }
    const normalizedPath = String(argumentPath || "").trim();
    if (normalizedPath) {
        violation.argumentPath = normalizedPath;
    }
    const normalizedScope = String(scope || "").trim();
    if (normalizedScope) {
        violation.scope = normalizedScope;
    }
    const normalizedExecutableName = String(executableName || "").trim();
    if (normalizedExecutableName) {
        violation.executableName = normalizedExecutableName;
    }
    const normalizedPathSource = String(pathSource || "").trim().toLowerCase();
    if (normalizedPathSource === "argument" || normalizedPathSource === "cwd") {
        violation.pathSource = normalizedPathSource;
    }
    return violation;
}

function validateScopedSubcommandSequence(scope, {
    args = [],
    allowedFirstArgs = [],
    deniedFirstArgs = [],
    allowedLeadingOptions = [],
    pathRestrictedLeadingOptions = [],
    executableName = "",
    policy = {},
} = {}) {
    const normalizedArgs = Array.isArray(args) ? args.map((entry) => String(entry || "").trim()) : [];
    const allowed = new Set(uniqueNormalizedStringList(allowedFirstArgs));
    const denied = new Set(uniqueNormalizedStringList(deniedFirstArgs));
    const allowedLeading = new Set(uniqueNormalizedStringList(allowedLeadingOptions));
    const pathRestrictedLeading = new Set(uniqueNormalizedStringList(pathRestrictedLeadingOptions));

    const scopeLabel = `process scope "${scope}"`;
    const executableLabel = executableName ? ` with executable "${executableName}"` : "";
    const rejection = (token) => buildArgumentPolicyViolation({
        reason: "ARGUMENT_NOT_ALLOWED",
        message: `Argument "${token}" is not allowed for ${scopeLabel}${executableLabel}.`,
        argument: token,
        scope,
        executableName,
    });

    if (normalizedArgs.length === 0) {
        return "";
    }

    for (let index = 0; index < normalizedArgs.length; index += 1) {
        const token = normalizedArgs[index];
        if (!token) {
            continue;
        }
        if (denied.has(token)) {
            return rejection(token);
        }
        if (allowed.has(token)) {
            return "";
        }
        if (token.startsWith("-")) {
            const {optionName, inlineValue} = splitOptionToken(token);
            if (!allowedLeading.has(optionName)) {
                return rejection(optionName || token);
            }
            const optionRequiresPath = pathRestrictedLeading.has(optionName);
            if (optionRequiresPath) {
                const optionValue = inlineValue || String(normalizedArgs[index + 1] || "").trim();
                if (!optionValue) {
                    return buildArgumentPolicyViolation({
                        reason: "ARGUMENT_PATH_REQUIRES_ABSOLUTE",
                        message: `Argument "${optionName}" requires an absolute path value for ${scopeLabel}${executableLabel}.`,
                        argument: optionName,
                        scope,
                        executableName,
                    });
                }
                if (!path.isAbsolute(optionValue)) {
                    return buildArgumentPolicyViolation({
                        reason: "ARGUMENT_PATH_REQUIRES_ABSOLUTE",
                        message: `Argument "${optionName}" requires an absolute path value for ${scopeLabel}${executableLabel}.`,
                        argument: optionName,
                        argumentPath: optionValue,
                        scope,
                        executableName,
                    });
                }
                const allowedRoots = Array.isArray(policy?.allowedCwdRoots) ? policy.allowedCwdRoots : [];
                if (!isPathWithinAllowedRoots(optionValue, allowedRoots)) {
                    return buildArgumentPolicyViolation({
                        reason: "ARGUMENT_PATH_OUTSIDE_ALLOWED_ROOTS",
                        message: `Argument "${optionName}" path "${optionValue}" is outside allowed roots for ${scopeLabel}${executableLabel}.`,
                        argument: optionName,
                        argumentPath: optionValue,
                        scope,
                        executableName,
                        pathSource: "argument",
                    });
                }
                if (!inlineValue) {
                    index += 1;
                }
                continue;
            }
            if (inlineValue) {
                continue;
            }
            const nextToken = normalizedArgs[index + 1] || "";
            if (isAllowedLeadingOptionValueCandidate(nextToken, {allowed, denied})) {
                index += 1;
            }
            continue;
        }
        if (allowed.size > 0 && !allowed.has(token)) {
            return rejection(token);
        }
        return "";
    }

    if (allowed.size > 0) {
        const firstToken = normalizedArgs.find(Boolean);
        if (firstToken) {
            return rejection(firstToken);
        }
    }
    return "";
}

function createSubcommandValidator(scope, {
    allowedFirstArgs = [],
    deniedFirstArgs = [],
    allowedLeadingOptions = [],
    pathRestrictedLeadingOptions = [],
} = {}) {
    const normalizedAllowedFirstArgs = uniqueNormalizedStringList(allowedFirstArgs);
    const normalizedDeniedFirstArgs = uniqueNormalizedStringList(deniedFirstArgs);
    const normalizedAllowedLeadingOptions = uniqueNormalizedStringList(allowedLeadingOptions);
    const normalizedPathRestrictedLeadingOptions = uniqueNormalizedStringList(pathRestrictedLeadingOptions);
    const validator = (args = [], _plan = {}, policy = {}) => {
        return validateScopedSubcommandSequence(scope, {
            args,
            allowedFirstArgs: normalizedAllowedFirstArgs,
            deniedFirstArgs: normalizedDeniedFirstArgs,
            allowedLeadingOptions: normalizedAllowedLeadingOptions,
            pathRestrictedLeadingOptions: normalizedPathRestrictedLeadingOptions,
            policy,
        });
    };
    return withArgumentPolicy(validator, {
        mode: "first-arg",
        allowedFirstArgs: normalizedAllowedFirstArgs,
        deniedFirstArgs: normalizedDeniedFirstArgs,
        allowedLeadingOptions: normalizedAllowedLeadingOptions,
        pathRestrictedLeadingOptions: normalizedPathRestrictedLeadingOptions,
    });
}

function createExecutableSubcommandValidator(scope, rulesByExecutable = {}) {
    const normalizedRules = normalizeArgumentRulesByExecutable(rulesByExecutable);
    const ruleSets = Object.fromEntries(
        Object.entries(normalizedRules).map(([executableName, rule]) => [
            executableName,
            {
                allowed: new Set(Array.isArray(rule?.allowedFirstArgs) ? rule.allowedFirstArgs : []),
                denied: new Set(Array.isArray(rule?.deniedFirstArgs) ? rule.deniedFirstArgs : []),
                allowedLeading: new Set(Array.isArray(rule?.allowedLeadingOptions) ? rule.allowedLeadingOptions : []),
                pathRestrictedLeading: new Set(Array.isArray(rule?.pathRestrictedLeadingOptions) ? rule.pathRestrictedLeadingOptions : []),
            },
        ])
    );
    const validator = (args = [], plan = {}, policy = {}) => {
        const executableName = path.basename(String(plan?.command || "").trim());
        const rule = ruleSets[executableName];
        if (!rule) {
            return "";
        }
        return validateScopedSubcommandSequence(scope, {
            args,
            allowedFirstArgs: [...rule.allowed],
            deniedFirstArgs: [...rule.denied],
            allowedLeadingOptions: [...rule.allowedLeading],
            pathRestrictedLeadingOptions: [...rule.pathRestrictedLeading],
            executableName,
            policy,
        });
    };
    return withArgumentPolicy(validator, {
        mode: "first-arg-by-executable",
        rulesByExecutable: normalizedRules,
    });
}

function createValidatorFromArgumentPolicy(scope = "", argumentPolicy = null) {
    const normalized = normalizeArgumentPolicy(argumentPolicy);
    if (!normalized) {
        return null;
    }
    if (normalized.mode === "first-arg") {
        return createSubcommandValidator(scope, {
            allowedFirstArgs: normalized.allowedFirstArgs,
            deniedFirstArgs: normalized.deniedFirstArgs,
            allowedLeadingOptions: normalized.allowedLeadingOptions,
            pathRestrictedLeadingOptions: normalized.pathRestrictedLeadingOptions,
        });
    }
    if (normalized.mode === "first-arg-by-executable") {
        return createExecutableSubcommandValidator(scope, normalized.rulesByExecutable);
    }
    return null;
}

function resolveArgumentPolicyForScope(scope = {}) {
    const explicitPolicy = normalizeArgumentPolicy(scope?.argumentPolicy);
    if (explicitPolicy) {
        return explicitPolicy;
    }
    const validatorPolicy = normalizeArgumentPolicy(scope?.validateArgs?.argumentPolicy);
    return validatorPolicy || null;
}

function mergeProcessScopePolicy(baseScope = null, overrideScope = null) {
    if (!baseScope && !overrideScope) {
        return null;
    }
    if (!baseScope) {
        const normalized = {
            ...overrideScope,
        };
        const explicitPolicy = resolveArgumentPolicyForScope(overrideScope);
        const additionalOverrides = extractAdditionalAllowedFirstArgOverrides(overrideScope);
        const hasAdditionalOverrides = additionalOverrides.allowedFirstArgs.length > 0
            || Object.keys(additionalOverrides.byExecutable || {}).length > 0
            || additionalOverrides.allowedLeadingOptions.length > 0
            || Object.keys(additionalOverrides.byExecutableLeadingOptions || {}).length > 0;
        const effectivePolicy = hasAdditionalOverrides && explicitPolicy
            ? applyAdditionalAllowedFirstArgs(explicitPolicy, additionalOverrides)
            : explicitPolicy;
        if (effectivePolicy) {
            normalized.argumentPolicy = effectivePolicy;
            if (typeof normalized.validateArgs !== "function") {
                normalized.validateArgs = createValidatorFromArgumentPolicy(normalized.scope, effectivePolicy);
            }
        }
        return Object.freeze(normalized);
    }
    if (!overrideScope) {
        const baseArgumentPolicy = resolveArgumentPolicyForScope(baseScope);
        return Object.freeze({
            ...baseScope,
            ...(baseArgumentPolicy ? {argumentPolicy: baseArgumentPolicy} : {}),
        });
    }

    const basePolicy = resolveArgumentPolicyForScope(baseScope);
    const overridePolicy = resolveArgumentPolicyForScope(overrideScope);
    const additionalOverrides = extractAdditionalAllowedFirstArgOverrides(overrideScope);
    const hasAdditionalOverrides = additionalOverrides.allowedFirstArgs.length > 0
        || Object.keys(additionalOverrides.byExecutable || {}).length > 0
        || additionalOverrides.allowedLeadingOptions.length > 0
        || Object.keys(additionalOverrides.byExecutableLeadingOptions || {}).length > 0;

    let effectivePolicy = overridePolicy || basePolicy;
    if (effectivePolicy && hasAdditionalOverrides) {
        effectivePolicy = applyAdditionalAllowedFirstArgs(effectivePolicy, additionalOverrides);
    }

    let validateArgs = typeof overrideScope?.validateArgs === "function"
        ? overrideScope.validateArgs
        : null;
    if (!validateArgs && effectivePolicy) {
        validateArgs = createValidatorFromArgumentPolicy(overrideScope?.scope || baseScope?.scope || "", effectivePolicy);
    }
    if (!validateArgs && typeof baseScope?.validateArgs === "function") {
        validateArgs = baseScope.validateArgs;
    }

    const merged = {
        ...baseScope,
        ...overrideScope,
        validateArgs: typeof validateArgs === "function" ? validateArgs : undefined,
    };

    if (effectivePolicy) {
        merged.argumentPolicy = effectivePolicy;
    }
    if (additionalOverrides.allowedFirstArgs.length > 0) {
        merged.additionalAllowedFirstArgs = Object.freeze([...additionalOverrides.allowedFirstArgs]);
    }
    if (Object.keys(additionalOverrides.byExecutable || {}).length > 0) {
        merged.additionalAllowedFirstArgsByExecutable = additionalOverrides.byExecutable;
    }
    if (additionalOverrides.allowedLeadingOptions.length > 0) {
        merged.additionalAllowedLeadingOptions = Object.freeze([...additionalOverrides.allowedLeadingOptions]);
    }
    if (Object.keys(additionalOverrides.byExecutableLeadingOptions || {}).length > 0) {
        merged.additionalAllowedLeadingOptionsByExecutable = additionalOverrides.byExecutableLeadingOptions;
    }

    return Object.freeze(merged);
}

export const HOST_PROCESS_SCOPE_REGISTRY = Object.freeze({
    "system-observe": Object.freeze({
        scope: "system-observe",
        kind: "process",
        category: "System",
        fallback: true,
        allowedExecutables: buildExecutableCandidates({
            unixPaths: [
                "/bin/ls",
                "/usr/bin/ls",
                "/bin/pwd",
                "/usr/bin/pwd",
                "/usr/bin/which",
                "/usr/bin/stat",
                "/usr/bin/du",
                "/usr/bin/find",
                "/bin/cat",
                "/usr/bin/head",
                "/usr/bin/tail",
                "/usr/bin/grep",
                "/usr/bin/sed",
                "/usr/bin/awk",
                "/usr/bin/sort",
                "/usr/bin/uniq",
                "/usr/bin/cut",
                "/usr/bin/basename",
                "/usr/bin/dirname",
                "/usr/bin/realpath",
                "/usr/bin/readlink",
                "/usr/bin/uname",
                "/usr/bin/id",
                "/usr/bin/whoami",
                "/usr/bin/env",
                "/usr/bin/printenv",
                "/bin/ps",
                "/usr/bin/ps",
                "/bin/hostname",
                "/usr/bin/hostname",
            ],
            windowsSystemExecutables: [
                "where.exe",
                "whoami.exe",
                "hostname.exe",
                "systeminfo.exe",
                "tasklist.exe",
            ],
        }),
        allowedCwdRoots: defaultCwdRoots(),
        allowedEnvKeys: Object.freeze([
            "HOME",
            "LANG",
            "LC_ALL",
            "PATH",
            "TMPDIR",
            "TMP",
            "TEMP",
            "USERPROFILE",
        ]),
        timeoutCeilingMs: 15000,
        requireConfirmation: true,
        description: "OS-aware fallback scope for read-oriented host observation commands when no curated operator tool family fits.",
    }),
    "system-inspect": Object.freeze({
        scope: "system-inspect",
        kind: "process",
        category: "System",
        fallback: true,
        allowedExecutables: buildExecutableCandidates({
            unixPaths: [
                "/bin/ls",
                "/usr/bin/ls",
                "/bin/pwd",
                "/usr/bin/pwd",
                "/usr/bin/which",
                "/usr/bin/stat",
                "/usr/bin/du",
                "/usr/bin/find",
                "/bin/cat",
                "/usr/bin/head",
                "/usr/bin/tail",
                "/usr/bin/grep",
                "/usr/bin/sed",
                "/usr/bin/awk",
                "/usr/bin/sort",
                "/usr/bin/uniq",
                "/usr/bin/cut",
                "/usr/bin/basename",
                "/usr/bin/dirname",
                "/usr/bin/realpath",
                "/usr/bin/readlink",
                "/usr/bin/uname",
                "/usr/bin/id",
                "/usr/bin/whoami",
                "/usr/bin/env",
                "/usr/bin/printenv",
                "/bin/ps",
                "/usr/bin/ps",
            ],
            windowsSystemExecutables: [
                "where.exe",
                "whoami.exe",
                "hostname.exe",
                "systeminfo.exe",
                "tasklist.exe",
            ],
        }),
        allowedCwdRoots: defaultCwdRoots(),
        allowedEnvKeys: Object.freeze([
            "HOME",
            "LANG",
            "LC_ALL",
            "PATH",
            "TMPDIR",
            "TMP",
            "TEMP",
        ]),
        timeoutCeilingMs: 15000,
        requireConfirmation: true,
        description: "Legacy-compatible fallback scope for read-oriented system inspection commands when no curated operator tool family fits.",
    }),
    "network-diagnostics": Object.freeze({
        scope: "network-diagnostics",
        kind: "process",
        category: "Network",
        fallback: true,
        allowedExecutables: buildExecutableCandidates({
            unixPaths: [
                "/usr/bin/curl",
                "/bin/ping",
                "/usr/bin/ping",
                "/usr/bin/wget",
                "/usr/bin/nslookup",
                "/usr/bin/dig",
                "/usr/sbin/traceroute",
                "/bin/netstat",
                "/usr/bin/netstat",
                "/usr/bin/ss",
                "/sbin/ifconfig",
                "/usr/sbin/ifconfig",
                "/sbin/ip",
                "/usr/sbin/ip",
            ],
            windowsSystemExecutables: [
                "curl.exe",
                "ping.exe",
                "tracert.exe",
                "nslookup.exe",
                "netstat.exe",
                "ipconfig.exe",
            ],
        }),
        allowedCwdRoots: defaultCwdRoots(),
        allowedEnvKeys: Object.freeze([
            "HOME",
            "PATH",
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "NO_PROXY",
            "TMPDIR",
            "TMP",
            "TEMP",
            "USERPROFILE",
        ]),
        timeoutCeilingMs: 30000,
        requireConfirmation: true,
        description: "OS-aware fallback scope for connectivity checks, host inspection, and network diagnostics when no curated operator tool family fits.",
    }),
    "service-management": Object.freeze({
        scope: "service-management",
        kind: "process",
        category: "System",
        fallback: true,
        allowedExecutables: buildExecutableCandidates({
            unixPaths: [
                "/bin/systemctl",
                "/usr/bin/systemctl",
                "/usr/sbin/service",
                "/sbin/service",
            ],
            windowsSystemExecutables: [
                "sc.exe",
                "net.exe",
            ],
        }),
        allowedCwdRoots: defaultCwdRoots(),
        allowedEnvKeys: Object.freeze([
            "HOME",
            "PATH",
            "TMPDIR",
            "TMP",
            "TEMP",
            "USERPROFILE",
        ]),
        timeoutCeilingMs: 45000,
        requireConfirmation: true,
        description: "OS-aware fallback scope for service inspection and controlled start/stop operations when no curated operator tool family fits.",
        validateArgs: createExecutableSubcommandValidator("service-management", {
            systemctl: {
                allowedFirstArgs: ["status", "show", "list-units", "list-unit-files", "start", "stop", "restart", "reload"],
            },
            service: {
                allowedFirstArgs: ["status", "start", "stop", "restart", "reload"],
            },
            "sc.exe": {
                allowedFirstArgs: ["query", "qc", "start", "stop"],
            },
            "net.exe": {
                allowedFirstArgs: ["start", "stop"],
            },
        }),
    }),
    "archive-tools": Object.freeze({
        scope: "archive-tools",
        kind: "process",
        category: "System",
        fallback: true,
        allowedExecutables: buildExecutableCandidates({
            unixPaths: [
                "/usr/bin/tar",
                "/bin/tar",
                "/usr/bin/gzip",
                "/usr/bin/gunzip",
                "/usr/bin/zip",
                "/usr/bin/unzip",
            ],
            windowsSystemExecutables: [
                "tar.exe",
            ],
            windowsProgramExecutables: [
                "7-Zip\\7z.exe",
            ],
        }),
        allowedCwdRoots: defaultCwdRoots(),
        allowedEnvKeys: Object.freeze([
            "HOME",
            "PATH",
            "TMPDIR",
            "TMP",
            "TEMP",
        ]),
        timeoutCeilingMs: 45000,
        requireConfirmation: true,
        description: "Scoped archive inspection and packaging commands for zip, unzip, tar, and gzip workflows.",
    }),
    homebrew: Object.freeze({
        scope: "homebrew",
        kind: "process",
        category: "Package Management",
        fallback: true,
        allowedExecutables: buildExecutableCandidates({
            unixPaths: [
                "/opt/homebrew/bin/brew",
                "/usr/local/bin/brew",
                "/usr/bin/brew",
            ],
        }),
        allowedCwdRoots: defaultCwdRoots(),
        allowedEnvKeys: Object.freeze([
            "HOMEBREW_CACHE",
            "HOMEBREW_CELLAR",
            "HOMEBREW_NO_AUTO_UPDATE",
            "HOMEBREW_PREFIX",
            "HOMEBREW_REPOSITORY",
            "HOME",
            "PATH",
            "TMPDIR",
            "TMP",
            "TEMP",
        ]),
        timeoutCeilingMs: 90000,
        requireConfirmation: true,
        description: "Scoped Homebrew execution for host package inspection and managed install or upgrade workflows.",
        validateArgs: createSubcommandValidator("homebrew", {
            allowedFirstArgs: ["info", "list", "search", "services", "doctor", "config", "update", "upgrade", "install", "uninstall", "tap", "untap", "outdated"],
            deniedFirstArgs: ["shellenv"],
        }),
    }),
    "package-management": Object.freeze({
        scope: "package-management",
        kind: "process",
        category: "Package Management",
        fallback: true,
        allowedExecutables: buildExecutableCandidates({
            unixPaths: [
                "/opt/homebrew/bin/brew",
                "/usr/local/bin/brew",
                "/usr/bin/brew",
                "/usr/local/bin/npm",
                "/opt/homebrew/bin/npm",
                "/usr/bin/npm",
                "/usr/local/bin/npx",
                "/opt/homebrew/bin/npx",
                "/usr/bin/npx",
                "/usr/local/bin/pnpm",
                "/opt/homebrew/bin/pnpm",
                "/usr/local/bin/yarn",
                "/opt/homebrew/bin/yarn",
                "/usr/local/bin/pip",
                "/opt/homebrew/bin/pip",
                "/usr/bin/pip",
                "/usr/local/bin/pip3",
                "/opt/homebrew/bin/pip3",
                "/usr/bin/pip3",
                "/usr/local/bin/uv",
                "/opt/homebrew/bin/uv",
                "/usr/bin/apt",
                "/usr/bin/apt-get",
                "/usr/bin/dnf",
                "/usr/bin/yum",
                "/usr/bin/zypper",
                "/usr/bin/pacman",
            ],
            windowsSystemExecutables: [
                "winget.exe",
            ],
            windowsProgramExecutables: [
                "chocolatey\\bin\\choco.exe",
                "nodejs\\npm.cmd",
                "nodejs\\npx.cmd",
            ],
            windowsUserExecutables: [
                "pnpm.cmd",
                "yarn.cmd",
                "pip.exe",
                "pip3.exe",
                "uv.exe",
            ],
        }),
        allowedCwdRoots: defaultCwdRoots(),
        allowedEnvKeys: Object.freeze([
            "HOME",
            "NPM_CONFIG_CACHE",
            "NPM_CONFIG_PREFIX",
            "PATH",
            "PIP_CACHE_DIR",
            "PIP_INDEX_URL",
            "PNPM_HOME",
            "TMPDIR",
            "TMP",
            "TEMP",
            "UV_CACHE_DIR",
            "YARN_CACHE_FOLDER",
        ]),
        timeoutCeilingMs: 120000,
        requireConfirmation: true,
        description: "Scoped package manager execution across Homebrew, npm, pnpm, yarn, pip, and uv.",
        validateArgs: createExecutableSubcommandValidator("package-management", {
            brew: {
                allowedFirstArgs: ["info", "list", "search", "services", "doctor", "config", "update", "upgrade", "install", "uninstall", "tap", "untap", "outdated"],
                deniedFirstArgs: ["shellenv"],
            },
            npm: {
                allowedFirstArgs: ["list", "view", "outdated", "audit", "install", "update", "uninstall", "run", "test", "exec"],
                deniedFirstArgs: ["login", "publish", "token"],
            },
            npx: {
                allowedFirstArgs: ["--yes", "--no", "-y", "-q"],
            },
            pnpm: {
                allowedFirstArgs: ["list", "outdated", "audit", "install", "update", "remove", "run", "test", "exec"],
                deniedFirstArgs: ["publish", "login"],
            },
            yarn: {
                allowedFirstArgs: ["list", "info", "outdated", "install", "upgrade", "remove", "run", "test", "exec"],
                deniedFirstArgs: ["publish", "npm"],
            },
            pip: {
                allowedFirstArgs: ["list", "show", "freeze", "install", "uninstall"],
            },
            pip3: {
                allowedFirstArgs: ["list", "show", "freeze", "install", "uninstall"],
            },
            uv: {
                allowedFirstArgs: ["tool", "pip", "run", "sync", "lock", "add", "remove"],
            },
        }),
    }),
    "source-control": Object.freeze({
        scope: "source-control",
        kind: "process",
        category: "Source Control",
        fallback: true,
        allowedExecutables: buildExecutableCandidates({
            unixPaths: [
                "/usr/bin/git",
                "/usr/local/bin/git",
                "/opt/homebrew/bin/git",
                "/usr/local/bin/gh",
                "/opt/homebrew/bin/gh",
                "/usr/bin/gh",
                "/usr/local/bin/glab",
                "/opt/homebrew/bin/glab",
                "/usr/bin/glab",
            ],
            windowsProgramExecutables: [
                "Git\\bin\\git.exe",
                "Git\\cmd\\git.exe",
                "GitHub CLI\\gh.exe",
                "glab\\bin\\glab.exe",
            ],
            windowsUserExecutables: [
                "GitHub CLI\\gh.exe",
                "glab\\bin\\glab.exe",
            ],
        }),
        allowedCwdRoots: defaultCwdRoots(),
        allowedEnvKeys: Object.freeze([
            "GIT_ASKPASS",
            "GIT_AUTHOR_EMAIL",
            "GIT_AUTHOR_NAME",
            "GIT_COMMITTER_EMAIL",
            "GIT_COMMITTER_NAME",
            "GIT_CONFIG_GLOBAL",
            "GIT_CONFIG_SYSTEM",
            "GIT_DIR",
            "GIT_SSH_COMMAND",
            "GH_HOST",
            "GH_TOKEN",
            "GLAB_TOKEN",
            "HOME",
            "PATH",
            "TMPDIR",
            "TMP",
            "TEMP",
        ]),
        timeoutCeilingMs: 90000,
        requireConfirmation: true,
        description: "Scoped source control execution across Git and common forge CLIs for repository and change workflows.",
        validateArgs: createExecutableSubcommandValidator("source-control", {
            git: {
                allowedFirstArgs: ["status", "diff", "log", "show", "branch", "checkout", "switch", "pull", "fetch", "clone", "add", "commit", "restore", "reset", "merge", "rebase", "push", "tag"],
                deniedFirstArgs: ["credential", "daemon", "upload-pack", "receive-pack"],
                pathRestrictedLeadingOptions: ["-C"],
            },
            gh: {
                allowedFirstArgs: ["repo", "pr", "issue", "run", "workflow", "release", "auth", "api"],
            },
            glab: {
                allowedFirstArgs: ["repo", "mr", "issue", "pipeline", "release", "auth", "api"],
            },
        }),
    }),
    "build-tooling": Object.freeze({
        scope: "build-tooling",
        kind: "process",
        category: "Build",
        fallback: true,
        allowedExecutables: buildExecutableCandidates({
            unixPaths: [
                "/usr/bin/make",
                "/usr/local/bin/make",
                "/usr/bin/cmake",
                "/usr/local/bin/cmake",
                "/usr/bin/ctest",
                "/usr/local/bin/ctest",
                "/usr/bin/ninja",
                "/usr/local/bin/ninja",
                "/usr/bin/mvn",
                "/usr/local/bin/mvn",
                "/usr/bin/gradle",
                "/usr/local/bin/gradle",
            ],
            windowsProgramExecutables: [
                "CMake\\bin\\cmake.exe",
                "CMake\\bin\\ctest.exe",
                "Apache\\Maven\\bin\\mvn.cmd",
                "Gradle\\bin\\gradle.bat",
            ],
            windowsUserExecutables: [
                "ninja.exe",
            ],
        }),
        allowedCwdRoots: defaultCwdRoots(),
        allowedEnvKeys: Object.freeze([
            "HOME",
            "JAVA_HOME",
            "M2_HOME",
            "PATH",
            "TMPDIR",
            "TMP",
            "TEMP",
            "USERPROFILE",
        ]),
        timeoutCeilingMs: 180000,
        requireConfirmation: true,
        description: "OS-aware fallback scope for build-system inspection and controlled build/test commands when no curated operator tool family fits.",
        validateArgs: createExecutableSubcommandValidator("build-tooling", {
            make: {
                allowedFirstArgs: ["help", "build", "test", "lint", "clean", "check"],
            },
            cmake: {
                allowedFirstArgs: ["--build", "--install", "--preset", "--list-presets", "-S", "-B"],
            },
            ctest: {
                allowedFirstArgs: ["--output-on-failure", "--test-dir", "-N"],
            },
            ninja: {
                allowedFirstArgs: ["-n", "-t", "all", "test", "install", "clean"],
            },
            mvn: {
                allowedFirstArgs: ["test", "verify", "package", "compile", "clean", "help"],
            },
            "mvn.cmd": {
                allowedFirstArgs: ["test", "verify", "package", "compile", "clean", "help"],
            },
            gradle: {
                allowedFirstArgs: ["tasks", "test", "build", "clean", "check", "assemble"],
            },
            "gradle.bat": {
                allowedFirstArgs: ["tasks", "test", "build", "clean", "check", "assemble"],
            },
        }),
    }),
    "task-runners": Object.freeze({
        scope: "task-runners",
        kind: "process",
        category: "Build",
        fallback: true,
        allowedExecutables: buildExecutableCandidates({
            unixPaths: [
                "/usr/bin/make",
                "/usr/local/bin/make",
                "/usr/local/bin/just",
                "/opt/homebrew/bin/just",
                "/usr/local/bin/task",
                "/opt/homebrew/bin/task",
            ],
            windowsProgramExecutables: [
                "Go Task\\task.exe",
            ],
            windowsUserExecutables: [
                "just.exe",
                "task.exe",
            ],
        }),
        allowedCwdRoots: defaultCwdRoots(),
        allowedEnvKeys: Object.freeze([
            "HOME",
            "PATH",
            "TMPDIR",
            "TMP",
            "TEMP",
            "USERPROFILE",
        ]),
        timeoutCeilingMs: 120000,
        requireConfirmation: true,
        description: "OS-aware fallback scope for structured project task runners when no curated operator tool family fits.",
        validateArgs: createExecutableSubcommandValidator("task-runners", {
            make: {
                allowedFirstArgs: ["help", "build", "test", "lint", "clean", "check"],
            },
            just: {
                allowedFirstArgs: ["--list", "--summary", "build", "test", "lint", "clean", "check"],
            },
            "just.exe": {
                allowedFirstArgs: ["--list", "--summary", "build", "test", "lint", "clean", "check"],
            },
            task: {
                allowedFirstArgs: ["--list", "--summary", "build", "test", "lint", "clean", "check"],
            },
            "task.exe": {
                allowedFirstArgs: ["--list", "--summary", "build", "test", "lint", "clean", "check"],
            },
        }),
    }),
    "docker-cli": Object.freeze({
        scope: "docker-cli",
        kind: "process",
        category: "Containers",
        allowedExecutables: Object.freeze([
            "/usr/local/bin/docker",
            "/opt/homebrew/bin/docker",
            "/usr/bin/docker",
        ]),
        allowedCwdRoots: defaultCwdRoots(),
        allowedEnvKeys: Object.freeze([
            "DOCKER_CONFIG",
            "DOCKER_CONTEXT",
            "DOCKER_HOST",
            "DOCKER_TLS_VERIFY",
            "DOCKER_CERT_PATH",
            "HOME",
            "PATH",
            "TMPDIR",
            "TMP",
            "TEMP",
        ]),
        timeoutCeilingMs: 30000,
        requireConfirmation: true,
        description: "Scoped Docker CLI execution for operator-style container workflows.",
        validateArgs: createSubcommandValidator("docker-cli", {
            allowedFirstArgs: ["version", "info", "ps", "images", "inspect", "logs", "context", "compose", "container", "network", "volume", "start", "stop", "restart", "pull"],
            deniedFirstArgs: ["run", "exec"],
        }),
    }),
    kubectl: Object.freeze({
        scope: "kubectl",
        kind: "process",
        category: "Infrastructure",
        allowedExecutables: Object.freeze([
            "/usr/local/bin/kubectl",
            "/opt/homebrew/bin/kubectl",
            "/usr/bin/kubectl",
        ]),
        allowedCwdRoots: defaultCwdRoots(),
        allowedEnvKeys: Object.freeze([
            "HOME",
            "KUBECONFIG",
            "KUBE_CONTEXT",
            "PATH",
            "TMPDIR",
            "TMP",
            "TEMP",
        ]),
        timeoutCeilingMs: 30000,
        requireConfirmation: true,
        description: "Scoped kubectl execution for cluster dashboards and operator consoles.",
        validateArgs: createSubcommandValidator("kubectl", {
            allowedFirstArgs: ["version", "get", "describe", "logs", "top", "apply", "delete", "patch", "rollout", "scale", "diff", "config"],
            deniedFirstArgs: ["exec", "cp", "port-forward", "proxy", "attach"],
        }),
    }),
    helm: Object.freeze({
        scope: "helm",
        kind: "process",
        category: "Infrastructure",
        allowedExecutables: Object.freeze([
            "/usr/local/bin/helm",
            "/opt/homebrew/bin/helm",
            "/usr/bin/helm",
        ]),
        allowedCwdRoots: defaultCwdRoots(),
        allowedEnvKeys: Object.freeze([
            "HELM_CACHE_HOME",
            "HELM_CONFIG_HOME",
            "HELM_DATA_HOME",
            "HELM_DRIVER",
            "HELM_NAMESPACE",
            "HOME",
            "KUBECONFIG",
            "PATH",
            "TMPDIR",
            "TMP",
            "TEMP",
        ]),
        timeoutCeilingMs: 45000,
        requireConfirmation: true,
        description: "Scoped Helm CLI execution for chart and release management consoles.",
        validateArgs: createSubcommandValidator("helm", {
            allowedFirstArgs: ["version", "list", "status", "get", "template", "install", "upgrade", "uninstall", "rollback", "lint", "dependency", "search", "show", "repo"],
            deniedFirstArgs: ["plugin"],
        }),
    }),
    terraform: Object.freeze({
        scope: "terraform",
        kind: "process",
        category: "Infrastructure",
        allowedExecutables: Object.freeze([
            "/usr/local/bin/terraform",
            "/opt/homebrew/bin/terraform",
            "/usr/bin/terraform",
        ]),
        allowedCwdRoots: defaultCwdRoots(),
        allowedEnvKeys: Object.freeze([
            "AWS_PROFILE",
            "AWS_REGION",
            "GOOGLE_APPLICATION_CREDENTIALS",
            "HOME",
            "PATH",
            "TF_CLI_ARGS",
            "TF_DATA_DIR",
            "TF_LOG",
            "TF_VAR_environment",
            "TMPDIR",
            "TMP",
            "TEMP",
        ]),
        timeoutCeilingMs: 60000,
        requireConfirmation: true,
        description: "Scoped Terraform CLI execution for infrastructure planning and apply workflows.",
        validateArgs: createSubcommandValidator("terraform", {
            allowedFirstArgs: ["version", "fmt", "validate", "plan", "apply", "destroy", "output", "show", "workspace", "state"],
            deniedFirstArgs: ["console", "login"],
            pathRestrictedLeadingOptions: ["-chdir"],
        }),
    }),
    ansible: Object.freeze({
        scope: "ansible",
        kind: "process",
        category: "Infrastructure",
        allowedExecutables: buildExecutableCandidates({
            unixPaths: [
                "/usr/local/bin/ansible",
                "/opt/homebrew/bin/ansible",
                "/usr/bin/ansible",
                "/usr/local/bin/ansible-playbook",
                "/opt/homebrew/bin/ansible-playbook",
                "/usr/bin/ansible-playbook",
            ],
            windowsUserExecutables: [
                "Python\\Scripts\\ansible.exe",
                "Python\\Scripts\\ansible-playbook.exe",
            ],
        }),
        allowedCwdRoots: defaultCwdRoots(),
        allowedEnvKeys: Object.freeze([
            "ANSIBLE_CONFIG",
            "ANSIBLE_FORCE_COLOR",
            "ANSIBLE_HOST_KEY_CHECKING",
            "ANSIBLE_INVENTORY",
            "HOME",
            "PATH",
            "PYTHONPATH",
            "TMPDIR",
            "TMP",
            "TEMP",
        ]),
        timeoutCeilingMs: 120000,
        requireConfirmation: true,
        description: "Scoped Ansible execution for inventory inspection and controlled playbook workflows.",
        validateArgs: createExecutableSubcommandValidator("ansible", {
            ansible: {
                allowedFirstArgs: ["all", "localhost"],
            },
            "ansible-playbook": {
                allowedFirstArgs: ["site.yml", "playbook.yml", "deploy.yml"],
            },
            "ansible.exe": {
                allowedFirstArgs: ["all", "localhost"],
            },
            "ansible-playbook.exe": {
                allowedFirstArgs: ["site.yml", "playbook.yml", "deploy.yml"],
            },
        }),
    }),
    "aws-cli": Object.freeze({
        scope: "aws-cli",
        kind: "process",
        category: "Cloud",
        allowedExecutables: buildExecutableCandidates({
            unixPaths: [
                "/usr/local/bin/aws",
                "/opt/homebrew/bin/aws",
                "/usr/bin/aws",
            ],
            windowsProgramExecutables: [
                "Amazon\\AWSCLIV2\\aws.exe",
            ],
            windowsUserExecutables: [
                "Programs\\Python\\Python311\\Scripts\\aws.exe",
                "Programs\\Python\\Python312\\Scripts\\aws.exe",
            ],
        }),
        allowedCwdRoots: defaultCwdRoots(),
        allowedEnvKeys: Object.freeze([
            "AWS_ACCESS_KEY_ID",
            "AWS_CA_BUNDLE",
            "AWS_DEFAULT_OUTPUT",
            "AWS_DEFAULT_REGION",
            "AWS_PROFILE",
            "AWS_REGION",
            "AWS_SECRET_ACCESS_KEY",
            "AWS_SESSION_TOKEN",
            "HOME",
            "PATH",
            "TMPDIR",
            "TMP",
            "TEMP",
        ]),
        timeoutCeilingMs: 90000,
        requireConfirmation: true,
        description: "Scoped AWS CLI execution for cloud inspection and controlled operational workflows.",
        validateArgs: createSubcommandValidator("aws-cli", {
            allowedFirstArgs: ["sts", "ec2", "eks", "ecs", "s3", "rds", "cloudformation", "lambda", "iam", "logs", "cloudwatch", "route53", "autoscaling", "elasticache", "dynamodb"],
        }),
    }),
    gcloud: Object.freeze({
        scope: "gcloud",
        kind: "process",
        category: "Cloud",
        allowedExecutables: buildExecutableCandidates({
            unixPaths: [
                "/usr/local/bin/gcloud",
                "/opt/homebrew/bin/gcloud",
                "/usr/bin/gcloud",
                "/usr/local/Caskroom/google-cloud-sdk/latest/google-cloud-sdk/bin/gcloud",
            ],
            windowsProgramExecutables: [
                "Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.cmd",
            ],
            windowsUserExecutables: [
                "Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.cmd",
            ],
        }),
        allowedCwdRoots: defaultCwdRoots(),
        allowedEnvKeys: Object.freeze([
            "CLOUDSDK_ACTIVE_CONFIG_NAME",
            "CLOUDSDK_CONFIG",
            "GOOGLE_APPLICATION_CREDENTIALS",
            "HOME",
            "PATH",
            "TMPDIR",
            "TMP",
            "TEMP",
        ]),
        timeoutCeilingMs: 90000,
        requireConfirmation: true,
        description: "Scoped gcloud execution for GCP operational flows.",
        validateArgs: createSubcommandValidator("gcloud", {
            allowedFirstArgs: ["config", "auth", "projects", "compute", "container", "run", "sql", "functions", "pubsub", "storage", "iam"],
        }),
    }),
    "azure-cli": Object.freeze({
        scope: "azure-cli",
        kind: "process",
        category: "Cloud",
        allowedExecutables: buildExecutableCandidates({
            unixPaths: [
                "/usr/local/bin/az",
                "/opt/homebrew/bin/az",
                "/usr/bin/az",
            ],
            windowsProgramExecutables: [
                "Microsoft SDKs\\Azure\\CLI2\\wbin\\az.cmd",
            ],
            windowsUserExecutables: [
                "Programs\\Python\\Python311\\Scripts\\az.cmd",
                "Programs\\Python\\Python312\\Scripts\\az.cmd",
            ],
        }),
        allowedCwdRoots: defaultCwdRoots(),
        allowedEnvKeys: Object.freeze([
            "AZURE_CONFIG_DIR",
            "AZURE_CORE_OUTPUT",
            "AZURE_DEFAULTS_GROUP",
            "AZURE_DEFAULTS_LOCATION",
            "AZURE_DEFAULTS_SUBSCRIPTION",
            "HOME",
            "PATH",
            "TMPDIR",
            "TMP",
            "TEMP",
        ]),
        timeoutCeilingMs: 90000,
        requireConfirmation: true,
        description: "Scoped Azure CLI execution for Azure operational flows.",
        validateArgs: createSubcommandValidator("azure-cli", {
            allowedFirstArgs: ["account", "group", "vm", "aks", "acr", "appservice", "functionapp", "network", "monitor", "resource", "storage", "deployment"],
        }),
    }),
    podman: Object.freeze({
        scope: "podman",
        kind: "process",
        category: "Containers",
        allowedExecutables: buildExecutableCandidates({
            unixPaths: [
                "/usr/local/bin/podman",
                "/opt/homebrew/bin/podman",
                "/usr/bin/podman",
            ],
            windowsProgramExecutables: [
                "RedHat\\Podman\\podman.exe",
            ],
        }),
        allowedCwdRoots: defaultCwdRoots(),
        allowedEnvKeys: Object.freeze([
            "HOME",
            "PATH",
            "PODMAN_HOST",
            "TMPDIR",
            "TMP",
            "TEMP",
        ]),
        timeoutCeilingMs: 30000,
        requireConfirmation: true,
        description: "Scoped Podman CLI execution for container operator workflows.",
        validateArgs: createSubcommandValidator("podman", {
            allowedFirstArgs: ["version", "info", "ps", "images", "inspect", "logs", "start", "stop", "restart", "pull", "compose", "container", "network", "volume"],
            deniedFirstArgs: ["run", "exec"],
        }),
    }),
    kustomize: Object.freeze({
        scope: "kustomize",
        kind: "process",
        category: "Infrastructure",
        allowedExecutables: buildExecutableCandidates({
            unixPaths: [
                "/usr/local/bin/kustomize",
                "/opt/homebrew/bin/kustomize",
                "/usr/bin/kustomize",
            ],
            windowsUserExecutables: [
                "kustomize.exe",
            ],
        }),
        allowedCwdRoots: defaultCwdRoots(),
        allowedEnvKeys: Object.freeze([
            "HOME",
            "KUBECONFIG",
            "PATH",
            "TMPDIR",
            "TMP",
            "TEMP",
        ]),
        timeoutCeilingMs: 45000,
        requireConfirmation: true,
        description: "Scoped Kustomize execution for Kubernetes manifest build and diff workflows.",
        validateArgs: createSubcommandValidator("kustomize", {
            allowedFirstArgs: ["build", "cfg", "edit", "version"],
        }),
    }),
    gh: Object.freeze({
        scope: "gh",
        kind: "process",
        category: "Source Control",
        allowedExecutables: buildExecutableCandidates({
            unixPaths: [
                "/usr/local/bin/gh",
                "/opt/homebrew/bin/gh",
                "/usr/bin/gh",
            ],
            windowsProgramExecutables: [
                "GitHub CLI\\gh.exe",
            ],
            windowsUserExecutables: [
                "GitHub CLI\\gh.exe",
            ],
        }),
        allowedCwdRoots: defaultCwdRoots(),
        allowedEnvKeys: Object.freeze([
            "GH_HOST",
            "GH_TOKEN",
            "GITHUB_TOKEN",
            "HOME",
            "PATH",
            "TMPDIR",
            "TMP",
            "TEMP",
        ]),
        timeoutCeilingMs: 60000,
        requireConfirmation: true,
        description: "Scoped GitHub CLI execution for repository, pull request, and workflow operations.",
        validateArgs: createSubcommandValidator("gh", {
            allowedFirstArgs: ["repo", "pr", "issue", "run", "workflow", "release", "auth", "api"],
        }),
    }),
    vault: Object.freeze({
        scope: "vault",
        kind: "process",
        category: "Security",
        allowedExecutables: buildExecutableCandidates({
            unixPaths: [
                "/usr/local/bin/vault",
                "/opt/homebrew/bin/vault",
                "/usr/bin/vault",
            ],
            windowsProgramExecutables: [
                "HashiCorp\\Vagrant\\bin\\vault.exe",
            ],
            windowsUserExecutables: [
                "vault.exe",
            ],
        }),
        allowedCwdRoots: defaultCwdRoots(),
        allowedEnvKeys: Object.freeze([
            "HOME",
            "PATH",
            "TMPDIR",
            "TMP",
            "TEMP",
            "VAULT_ADDR",
            "VAULT_CACERT",
            "VAULT_NAMESPACE",
            "VAULT_TOKEN",
        ]),
        timeoutCeilingMs: 60000,
        requireConfirmation: true,
        description: "Scoped Vault CLI execution for secrets and auth operational workflows.",
        validateArgs: createSubcommandValidator("vault", {
            allowedFirstArgs: ["status", "read", "write", "kv", "auth", "token", "policy", "secrets", "operator", "login"],
        }),
    }),
    nomad: Object.freeze({
        scope: "nomad",
        kind: "process",
        category: "Infrastructure",
        allowedExecutables: buildExecutableCandidates({
            unixPaths: [
                "/usr/local/bin/nomad",
                "/opt/homebrew/bin/nomad",
                "/usr/bin/nomad",
            ],
            windowsUserExecutables: [
                "nomad.exe",
            ],
        }),
        allowedCwdRoots: defaultCwdRoots(),
        allowedEnvKeys: Object.freeze([
            "HOME",
            "NOMAD_ADDR",
            "NOMAD_NAMESPACE",
            "NOMAD_TOKEN",
            "PATH",
            "TMPDIR",
            "TMP",
            "TEMP",
        ]),
        timeoutCeilingMs: 60000,
        requireConfirmation: true,
        description: "Scoped Nomad CLI execution for job and cluster operational workflows.",
        validateArgs: createSubcommandValidator("nomad", {
            allowedFirstArgs: ["status", "job", "node", "alloc", "namespace", "operator", "deployment", "run", "stop"],
        }),
    }),
    git: Object.freeze({
        scope: "git",
        kind: "process",
        category: "Source Control",
        allowedExecutables: Object.freeze([
            "/usr/bin/git",
            "/usr/local/bin/git",
            "/opt/homebrew/bin/git",
        ]),
        allowedCwdRoots: defaultCwdRoots(),
        allowedEnvKeys: Object.freeze([
            "GIT_ASKPASS",
            "GIT_AUTHOR_EMAIL",
            "GIT_AUTHOR_NAME",
            "GIT_COMMITTER_EMAIL",
            "GIT_COMMITTER_NAME",
            "GIT_CONFIG_GLOBAL",
            "GIT_CONFIG_SYSTEM",
            "GIT_DIR",
            "GIT_SSH_COMMAND",
            "HOME",
            "PATH",
            "TMPDIR",
            "TMP",
            "TEMP",
        ]),
        timeoutCeilingMs: 60000,
        requireConfirmation: true,
        description: "Scoped Git execution for repository inspection and controlled source management workflows.",
        validateArgs: createSubcommandValidator("git", {
            allowedFirstArgs: ["status", "diff", "log", "show", "branch", "checkout", "switch", "pull", "fetch", "clone", "add", "commit", "restore", "reset", "merge", "rebase", "push", "tag"],
            deniedFirstArgs: ["credential", "daemon", "upload-pack", "receive-pack"],
            pathRestrictedLeadingOptions: ["-C"],
        }),
    }),
});

let sharedCustomProcessScopeRegistry = Object.freeze({});
let pluginCustomProcessScopeRegistry = Object.freeze({});

function normalizeOwnerMetadata(scope = {}, owner = {}) {
    const ownerPluginId = typeof owner?.pluginId === "string" && owner.pluginId.trim()
        ? owner.pluginId.trim()
        : (typeof scope?.ownerPluginId === "string" && scope.ownerPluginId.trim() ? scope.ownerPluginId.trim() : "");
    const shared = owner?.shared === true || scope?.shared === true || !ownerPluginId;
    return {
        ownerPluginId: shared ? "" : ownerPluginId,
        ownerType: shared ? "shared" : "plugin",
        shared,
    };
}

function uniqueNormalizedStrings(values = []) {
    return [...new Set((Array.isArray(values) ? values : [])
        .filter((value) => typeof value === "string" && value.trim())
        .map((value) => value.trim()))];
}

export function sanitizeCustomProcessScopeId(scopeId = "") {
    const raw = String(scopeId || "").trim();
    const withoutCapabilityPrefixes = raw
        .replace(/^system\.process\.scope\./i, "")
        .replace(/^system\.fs\.scope\./i, "");
    const normalized = withoutCapabilityPrefixes
        .replace(/[^A-Za-z0-9._-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^[.-]+|[.-]+$/g, "");
    return normalized || "";
}

export function normalizeCustomProcessScope(scope = {}, owner = {}) {
    const normalizedScopeId = sanitizeCustomProcessScopeId(scope?.scope || scope?.id || scope?.slug || "");
    if (!normalizedScopeId) {
        throw new Error("Custom process scope id is required.");
    }
    const allowedExecutables = uniqueNormalizedStrings(scope?.allowedExecutables);
    if (allowedExecutables.length === 0) {
        throw new Error(`Custom process scope "${normalizedScopeId}" must allow at least one executable path.`);
    }

    const timeoutCeilingMs = Number.isFinite(scope?.timeoutCeilingMs) && Number(scope.timeoutCeilingMs) > 0
        ? Number(scope.timeoutCeilingMs)
        : 30000;
    const policyVersion = Number.isFinite(Number(scope?.policyVersion)) && Number(scope.policyVersion) > 0
        ? Math.trunc(Number(scope.policyVersion))
        : PROCESS_SCOPE_POLICY_VERSION;
    const additionalAllowedFirstArgs = uniqueNormalizedStringList(scope?.additionalAllowedFirstArgs);
    const additionalAllowedFirstArgsByExecutable = normalizeAdditionalAllowedFirstArgsByExecutable(scope?.additionalAllowedFirstArgsByExecutable);
    const additionalAllowedLeadingOptions = uniqueNormalizedStringList(scope?.additionalAllowedLeadingOptions);
    const additionalAllowedLeadingOptionsByExecutable = normalizeAdditionalAllowedFirstArgsByExecutable(scope?.additionalAllowedLeadingOptionsByExecutable);
    const explicitArgumentPolicy = normalizeArgumentPolicy(scope?.argumentPolicy);

    const ownerMeta = normalizeOwnerMetadata(scope, owner);

    const normalizedScope = {
        scope: normalizedScopeId,
        title: typeof scope?.title === "string" && scope.title.trim()
            ? scope.title.trim()
            : normalizedScopeId.replace(/[._-]+/g, " "),
        kind: "process",
        category: ownerMeta.shared ? "Shared User-Defined Scopes" : "Plugin-Specific Scopes",
        userDefined: true,
        description: typeof scope?.description === "string" && scope.description.trim()
            ? scope.description.trim()
            : ownerMeta.shared
                ? "Host-managed shared user-defined process scope."
                : "Plugin-specific host-managed user-defined process scope.",
        allowedExecutables: Object.freeze(allowedExecutables),
        allowedCwdRoots: Object.freeze(uniqueNormalizedStrings(scope?.allowedCwdRoots).length > 0
            ? uniqueNormalizedStrings(scope?.allowedCwdRoots)
            : defaultCwdRoots()),
        allowedEnvKeys: Object.freeze(uniqueNormalizedStrings(scope?.allowedEnvKeys)),
        timeoutCeilingMs,
        requireConfirmation: scope?.requireConfirmation !== false,
        fallback: false,
        policyVersion,
        ownerPluginId: ownerMeta.ownerPluginId,
        ownerType: ownerMeta.ownerType,
        shared: ownerMeta.shared,
    };

    if (additionalAllowedFirstArgs.length > 0) {
        normalizedScope.additionalAllowedFirstArgs = Object.freeze(additionalAllowedFirstArgs);
    }
    if (Object.keys(additionalAllowedFirstArgsByExecutable).length > 0) {
        normalizedScope.additionalAllowedFirstArgsByExecutable = additionalAllowedFirstArgsByExecutable;
    }
    if (additionalAllowedLeadingOptions.length > 0) {
        normalizedScope.additionalAllowedLeadingOptions = Object.freeze(additionalAllowedLeadingOptions);
    }
    if (Object.keys(additionalAllowedLeadingOptionsByExecutable).length > 0) {
        normalizedScope.additionalAllowedLeadingOptionsByExecutable = additionalAllowedLeadingOptionsByExecutable;
    }
    if (explicitArgumentPolicy) {
        normalizedScope.argumentPolicy = explicitArgumentPolicy;
        normalizedScope.validateArgs = createValidatorFromArgumentPolicy(normalizedScopeId, explicitArgumentPolicy);
    }

    return Object.freeze(normalizedScope);
}

export function setHostSharedProcessScopes(scopes = []) {
    const normalizedEntries = (Array.isArray(scopes) ? scopes : [])
        .map((scope) => normalizeCustomProcessScope(scope, {shared: true}));
    sharedCustomProcessScopeRegistry = Object.freeze(Object.fromEntries(
        normalizedEntries.map((scope) => [scope.scope, scope])
    ));
    return sharedCustomProcessScopeRegistry;
}

export function setHostPluginCustomProcessScopes(pluginId, scopes = []) {
    const safePluginId = typeof pluginId === "string" ? pluginId.trim() : "";
    if (!safePluginId) {
        return pluginCustomProcessScopeRegistry;
    }
    const normalizedEntries = (Array.isArray(scopes) ? scopes : [])
        .map((scope) => normalizeCustomProcessScope(scope, {pluginId: safePluginId}));
    pluginCustomProcessScopeRegistry = Object.freeze({
        ...pluginCustomProcessScopeRegistry,
        [safePluginId]: Object.freeze(Object.fromEntries(
            normalizedEntries.map((scope) => [scope.scope, scope])
        )),
    });
    return pluginCustomProcessScopeRegistry;
}

export function removeHostPluginCustomProcessScopes(pluginId) {
    const safePluginId = typeof pluginId === "string" ? pluginId.trim() : "";
    if (!safePluginId || !pluginCustomProcessScopeRegistry[safePluginId]) {
        return pluginCustomProcessScopeRegistry;
    }
    const nextRegistry = {...pluginCustomProcessScopeRegistry};
    delete nextRegistry[safePluginId];
    pluginCustomProcessScopeRegistry = Object.freeze(nextRegistry);
    return pluginCustomProcessScopeRegistry;
}

export function setHostCustomProcessScopes(scopes = []) {
    return setHostSharedProcessScopes(scopes);
}

function mergeProcessScopeRegistry(baseRegistry = {}, overlayRegistry = {}) {
    const merged = Object.fromEntries(
        Object.entries((baseRegistry && typeof baseRegistry === "object") ? baseRegistry : {})
            .map(([scopeId, scope]) => [scopeId, mergeProcessScopePolicy(scope, null)])
    );
    Object.entries((overlayRegistry && typeof overlayRegistry === "object") ? overlayRegistry : {}).forEach(([scopeId, scope]) => {
        const normalizedScopeId = String(scopeId || "").trim();
        if (!normalizedScopeId) {
            return;
        }
        merged[normalizedScopeId] = mergeProcessScopePolicy(merged[normalizedScopeId] || null, scope);
    });
    return merged;
}

export function getAllHostProcessScopePolicies(options = {}) {
    const safePluginId = typeof options?.pluginId === "string" ? options.pluginId.trim() : "";
    const mergedShared = mergeProcessScopeRegistry(HOST_PROCESS_SCOPE_REGISTRY, sharedCustomProcessScopeRegistry);
    const mergedPlugin = safePluginId
        ? mergeProcessScopeRegistry(mergedShared, pluginCustomProcessScopeRegistry[safePluginId] || {})
        : mergedShared;
    return Object.freeze(mergedPlugin);
}

export function getHostCustomProcessScopes() {
    return getHostSharedProcessScopes();
}

export function getHostSharedProcessScopes() {
    return Object.values(sharedCustomProcessScopeRegistry);
}

export function getHostPluginCustomProcessScopes(pluginId) {
    const safePluginId = typeof pluginId === "string" ? pluginId.trim() : "";
    if (!safePluginId) {
        return [];
    }
    return Object.values(pluginCustomProcessScopeRegistry[safePluginId] || {});
}

export function getHostProcessScopePolicy(scopeId, options = {}) {
    if (typeof scopeId !== "string" || !scopeId.trim()) {
        return null;
    }
    const allScopes = getAllHostProcessScopePolicies(options);
    return allScopes[scopeId] || null;
}
