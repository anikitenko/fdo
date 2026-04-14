import React, {useEffect, useMemo, useState} from "react";
import {Button, Card, Dialog, FormGroup, InputGroup, Switch, Tag} from "@blueprintjs/core";
import classNames from "classnames";

import * as styles from "../../css/SettingsDialog.module.css";

const PROCESS_SCOPE_POLICY_VERSION = 1;

function uniqueNormalizedTokens(values = []) {
    return [...new Set((Array.isArray(values) ? values : [])
        .filter((value) => typeof value === "string" && value.trim())
        .map((value) => value.trim()))];
}

function isAbsoluteLikePath(value = "") {
    const text = String(value || "").trim();
    return /^([A-Za-z]:[\\/]|\/)/.test(text);
}

function isValidEnvKey(value = "") {
    return /^[A-Z_][A-Z0-9_]*$/i.test(String(value || "").trim());
}

function isValidOptionToken(value = "") {
    return /^-{1,2}[^\s]+$/.test(String(value || "").trim());
}

function validateToken(field, token) {
    const value = String(token || "").trim();
    if (!value) return "Value cannot be empty.";
    if (field === "allowedExecutables" || field === "allowedCwdRoots") {
        return isAbsoluteLikePath(value) ? "" : "Use an absolute path.";
    }
    if (field === "allowedEnvKeys") {
        return isValidEnvKey(value) ? "" : "Use a valid environment variable key.";
    }
    if (field === "argumentPolicyAllowedFirstArgs" || field === "argumentPolicyDeniedFirstArgs") {
        return /\s/.test(value) ? "Use a single token without spaces." : "";
    }
    if (field === "argumentPolicyAllowedLeadingOptions" || field === "argumentPolicyPathRestrictedLeadingOptions") {
        if (/\s/.test(value)) {
            return "Use a single token without spaces.";
        }
        return isValidOptionToken(value) ? "" : "Use an option token like -C or --chdir.";
    }
    return "";
}

function normalizeCustomScopeSlugInput(value = "") {
    const raw = String(value || "").trim();
    const withoutCapabilityPrefix = raw
        .replace(/^system\.process\.scope\./i, "")
        .replace(/^system\.fs\.scope\./i, "");
    return withoutCapabilityPrefix
        .replace(/[^A-Za-z0-9._-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^[.-]+|[.-]+$/g, "");
}

function toCustomScopeIdFromSlug(slug = "") {
    const normalizedSlug = normalizeCustomScopeSlugInput(slug);
    return normalizedSlug || "";
}

function classifyScopeRisk(scope = {}) {
    const commands = (Array.isArray(scope?.allowedExecutables) ? scope.allowedExecutables : [])
        .map((entry) => String(entry || "").trim().toLowerCase());
    const description = String(scope?.description || "").toLowerCase();
    const saferHints = ["htop", "top", "btop", "glances", "ps", "iostat", "vm_stat", "uptime", "free", "tasklist"];
    const looksSafer = commands.length > 0
        && commands.every((entry) => saferHints.some((hint) => entry.endsWith(`/${hint}`) || entry.endsWith(`\\${hint}.exe`) || entry === hint))
        && !/(apply|delete|write|restart|stop|start|kill|mutate|admin|install|remove)/.test(description);
    return looksSafer
        ? {label: "Safer shared scopes", intent: "success", description: "Reusable read-oriented commands for multiple plugins."}
        : {label: "Higher-risk shared scopes", intent: "warning", description: "Reusable scopes that may mutate host state or need stronger review."};
}

function buildArgumentPolicySummary(scope = {}) {
    const policy = (scope?.argumentPolicy && typeof scope.argumentPolicy === "object") ? scope.argumentPolicy : null;
    if (!policy) {
        return "";
    }
    if (policy.mode === "first-arg") {
        const allowedCount = Array.isArray(policy.allowedFirstArgs) ? policy.allowedFirstArgs.length : 0;
        const deniedCount = Array.isArray(policy.deniedFirstArgs) ? policy.deniedFirstArgs.length : 0;
        const leadingCount = Array.isArray(policy.allowedLeadingOptions) ? policy.allowedLeadingOptions.length : 0;
        const pathRestrictedCount = Array.isArray(policy.pathRestrictedLeadingOptions) ? policy.pathRestrictedLeadingOptions.length : 0;
        return `Argument policy v${policy.version || PROCESS_SCOPE_POLICY_VERSION}: allow ${allowedCount}, deny ${deniedCount}, leading ${leadingCount}, path-restricted ${pathRestrictedCount}`;
    }
    if (policy.mode === "first-arg-by-executable") {
        const executableCount = Object.keys(policy.rulesByExecutable || {}).length;
        return `Argument policy v${policy.version || PROCESS_SCOPE_POLICY_VERSION}: executable rules (${executableCount}).`;
    }
    return `Argument policy v${policy.version || PROCESS_SCOPE_POLICY_VERSION}`;
}

function TokenListInput({
    label,
    placeholder,
    helperText,
    tokens,
    inputValue,
    inputError,
    onInputChange,
    onAddToken,
    onRemoveToken,
}) {
    return (
        <FormGroup label={label}>
            <InputGroup
                placeholder={placeholder}
                value={inputValue}
                intent={inputError ? "danger" : "none"}
                onChange={(event) => onInputChange(event.target.value)}
                onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === ",") {
                        event.preventDefault();
                        onAddToken();
                    }
                }}
                onBlur={() => {
                    if (String(inputValue || "").trim()) onAddToken();
                }}
            />
            <div className={classNames("bp6-text-small", "bp6-text-muted")} style={{marginTop: 4}}>
                {helperText}
            </div>
            {inputError ? (
                <div className="bp6-text-small" style={{color: "#c23030", marginTop: 4}}>
                    {inputError}
                </div>
            ) : null}
            {tokens.length > 0 ? (
                <div style={{display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8}}>
                    {tokens.map((token) => (
                        <Tag key={`${label}-${token}`} minimal interactive rightIcon="cross" onRemove={() => onRemoveToken(token)}>
                            {token}
                        </Tag>
                    ))}
                </div>
            ) : null}
        </FormGroup>
    );
}

const EMPTY_SCOPE_DRAFT = Object.freeze({
    scope: "",
    title: "",
    description: "",
    allowedExecutables: [],
    allowedCwdRoots: [],
    allowedEnvKeys: [],
    argumentPolicyAllowedFirstArgs: [],
    argumentPolicyDeniedFirstArgs: [],
    argumentPolicyAllowedLeadingOptions: [],
    argumentPolicyPathRestrictedLeadingOptions: [],
    argumentPolicyRaw: null,
    policyVersion: PROCESS_SCOPE_POLICY_VERSION,
    timeoutCeilingMs: "30000",
    requireConfirmation: true,
});

export default function SharedProcessScopesPanel() {
    const [scopes, setScopes] = useState([]);
    const [plugins, setPlugins] = useState([]);
    const [showEditor, setShowEditor] = useState(false);
    const [draft, setDraft] = useState(EMPTY_SCOPE_DRAFT);
    const [editingScopeId, setEditingScopeId] = useState("");
    const [error, setError] = useState("");
    const [saving, setSaving] = useState(false);
    const [inputs, setInputs] = useState({
        allowedExecutables: "",
        allowedCwdRoots: "",
        allowedEnvKeys: "",
        argumentPolicyAllowedFirstArgs: "",
        argumentPolicyDeniedFirstArgs: "",
        argumentPolicyAllowedLeadingOptions: "",
        argumentPolicyPathRestrictedLeadingOptions: "",
    });
    const [inputErrors, setInputErrors] = useState({
        allowedExecutables: "",
        allowedCwdRoots: "",
        allowedEnvKeys: "",
        argumentPolicyAllowedFirstArgs: "",
        argumentPolicyDeniedFirstArgs: "",
        argumentPolicyAllowedLeadingOptions: "",
        argumentPolicyPathRestrictedLeadingOptions: "",
    });

    const loadSharedScopes = async () => {
        const result = await window.electron.plugin.getSharedProcessScopes();
        setScopes(result?.success && Array.isArray(result.scopes) ? result.scopes : []);
    };

    useEffect(() => {
        void loadSharedScopes();
        window.electron.plugin.getAll().then((result) => {
            setPlugins(result?.success && Array.isArray(result.plugins) ? result.plugins : []);
        }).catch(() => setPlugins([]));
    }, []);

    const groupedScopes = useMemo(() => (
        scopes.reduce((acc, scope) => {
            const risk = classifyScopeRisk(scope);
            if (!acc[risk.label]) {
                acc[risk.label] = {meta: risk, scopes: []};
            }
            acc[risk.label].scopes.push(scope);
            return acc;
        }, {})
    ), [scopes]);

    const usageByScopeId = useMemo(() => (
        scopes.reduce((acc, scope) => {
            const capabilityId = `system.process.scope.${scope.scope}`;
            acc[scope.scope] = (Array.isArray(plugins) ? plugins : [])
                .filter((plugin) => Array.isArray(plugin?.capabilities) && plugin.capabilities.includes(capabilityId));
            return acc;
        }, {})
    ), [plugins, scopes]);

    const requestCapabilityId = `system.process.scope.${toCustomScopeIdFromSlug(draft.scope) || "<scope-id>"}`;

    const resetDraft = () => {
        setDraft(EMPTY_SCOPE_DRAFT);
        setEditingScopeId("");
        setError("");
        setInputs({
            allowedExecutables: "",
            allowedCwdRoots: "",
            allowedEnvKeys: "",
            argumentPolicyAllowedFirstArgs: "",
            argumentPolicyDeniedFirstArgs: "",
            argumentPolicyAllowedLeadingOptions: "",
            argumentPolicyPathRestrictedLeadingOptions: "",
        });
        setInputErrors({
            allowedExecutables: "",
            allowedCwdRoots: "",
            allowedEnvKeys: "",
            argumentPolicyAllowedFirstArgs: "",
            argumentPolicyDeniedFirstArgs: "",
            argumentPolicyAllowedLeadingOptions: "",
            argumentPolicyPathRestrictedLeadingOptions: "",
        });
    };

    const addToken = (field) => {
        const nextToken = String(inputs[field] || "").trim().replace(/,$/, "");
        if (!nextToken) return;
        const fieldError = validateToken(field, nextToken);
        if (fieldError) {
            setInputErrors((prev) => ({...prev, [field]: fieldError}));
            return;
        }
        setDraft((prev) => ({...prev, [field]: uniqueNormalizedTokens([...(prev[field] || []), nextToken])}));
        setInputs((prev) => ({...prev, [field]: ""}));
        setInputErrors((prev) => ({...prev, [field]: ""}));
    };

    const removeToken = (field, token) => {
        setDraft((prev) => ({...prev, [field]: (prev[field] || []).filter((value) => value !== token)}));
    };

    const openCreate = () => {
        resetDraft();
        setShowEditor(true);
    };

    const openEdit = (scope) => {
        setEditingScopeId(scope?.scope || "");
        setDraft({
            scope: String(scope?.scope || ""),
            title: scope?.title || "",
            description: scope?.description || "",
            allowedExecutables: Array.isArray(scope?.allowedExecutables) ? scope.allowedExecutables : [],
            allowedCwdRoots: Array.isArray(scope?.allowedCwdRoots) ? scope.allowedCwdRoots : [],
            allowedEnvKeys: Array.isArray(scope?.allowedEnvKeys) ? scope.allowedEnvKeys : [],
            argumentPolicyAllowedFirstArgs: Array.isArray(scope?.argumentPolicy?.allowedFirstArgs) ? scope.argumentPolicy.allowedFirstArgs : [],
            argumentPolicyDeniedFirstArgs: Array.isArray(scope?.argumentPolicy?.deniedFirstArgs) ? scope.argumentPolicy.deniedFirstArgs : [],
            argumentPolicyAllowedLeadingOptions: Array.isArray(scope?.argumentPolicy?.allowedLeadingOptions) ? scope.argumentPolicy.allowedLeadingOptions : [],
            argumentPolicyPathRestrictedLeadingOptions: Array.isArray(scope?.argumentPolicy?.pathRestrictedLeadingOptions) ? scope.argumentPolicy.pathRestrictedLeadingOptions : [],
            argumentPolicyRaw: (scope?.argumentPolicy?.mode && scope.argumentPolicy.mode !== "first-arg")
                ? scope.argumentPolicy
                : null,
            policyVersion: Number.isFinite(Number(scope?.policyVersion)) && Number(scope.policyVersion) > 0
                ? Math.trunc(Number(scope.policyVersion))
                : PROCESS_SCOPE_POLICY_VERSION,
            timeoutCeilingMs: scope?.timeoutCeilingMs ? String(scope.timeoutCeilingMs) : "30000",
            requireConfirmation: scope?.requireConfirmation !== false,
        });
        setError("");
        setInputs({
            allowedExecutables: "",
            allowedCwdRoots: "",
            allowedEnvKeys: "",
            argumentPolicyAllowedFirstArgs: "",
            argumentPolicyDeniedFirstArgs: "",
            argumentPolicyAllowedLeadingOptions: "",
            argumentPolicyPathRestrictedLeadingOptions: "",
        });
        setInputErrors({
            allowedExecutables: "",
            allowedCwdRoots: "",
            allowedEnvKeys: "",
            argumentPolicyAllowedFirstArgs: "",
            argumentPolicyDeniedFirstArgs: "",
            argumentPolicyAllowedLeadingOptions: "",
            argumentPolicyPathRestrictedLeadingOptions: "",
        });
        setShowEditor(true);
    };

    const openClone = (scope) => {
        setEditingScopeId("");
        const clonedScopeSlug = normalizeCustomScopeSlugInput(String(scope?.scope || ""));
        setDraft({
            scope: `${clonedScopeSlug || "scope"}-copy`,
            title: scope?.title ? `${scope.title} Copy` : "Copied Shared Scope",
            description: scope?.description || "",
            allowedExecutables: Array.isArray(scope?.allowedExecutables) ? scope.allowedExecutables : [],
            allowedCwdRoots: Array.isArray(scope?.allowedCwdRoots) ? scope.allowedCwdRoots : [],
            allowedEnvKeys: Array.isArray(scope?.allowedEnvKeys) ? scope.allowedEnvKeys : [],
            argumentPolicyAllowedFirstArgs: Array.isArray(scope?.argumentPolicy?.allowedFirstArgs) ? scope.argumentPolicy.allowedFirstArgs : [],
            argumentPolicyDeniedFirstArgs: Array.isArray(scope?.argumentPolicy?.deniedFirstArgs) ? scope.argumentPolicy.deniedFirstArgs : [],
            argumentPolicyAllowedLeadingOptions: Array.isArray(scope?.argumentPolicy?.allowedLeadingOptions) ? scope.argumentPolicy.allowedLeadingOptions : [],
            argumentPolicyPathRestrictedLeadingOptions: Array.isArray(scope?.argumentPolicy?.pathRestrictedLeadingOptions) ? scope.argumentPolicy.pathRestrictedLeadingOptions : [],
            argumentPolicyRaw: (scope?.argumentPolicy?.mode && scope.argumentPolicy.mode !== "first-arg")
                ? scope.argumentPolicy
                : null,
            policyVersion: Number.isFinite(Number(scope?.policyVersion)) && Number(scope.policyVersion) > 0
                ? Math.trunc(Number(scope.policyVersion))
                : PROCESS_SCOPE_POLICY_VERSION,
            timeoutCeilingMs: scope?.timeoutCeilingMs ? String(scope.timeoutCeilingMs) : "30000",
            requireConfirmation: scope?.requireConfirmation !== false,
        });
        setError("");
        setInputs({
            allowedExecutables: "",
            allowedCwdRoots: "",
            allowedEnvKeys: "",
            argumentPolicyAllowedFirstArgs: "",
            argumentPolicyDeniedFirstArgs: "",
            argumentPolicyAllowedLeadingOptions: "",
            argumentPolicyPathRestrictedLeadingOptions: "",
        });
        setInputErrors({
            allowedExecutables: "",
            allowedCwdRoots: "",
            allowedEnvKeys: "",
            argumentPolicyAllowedFirstArgs: "",
            argumentPolicyDeniedFirstArgs: "",
            argumentPolicyAllowedLeadingOptions: "",
            argumentPolicyPathRestrictedLeadingOptions: "",
        });
        setShowEditor(true);
    };

    const handleSave = async () => {
        setSaving(true);
        setError("");
        try {
            const normalizedScopeId = toCustomScopeIdFromSlug(draft.scope);
            if (!normalizedScopeId) {
                setError("Scope ID is required. Use any scope ID such as internal-runner.");
                return;
            }
            const pendingField = [
                "allowedExecutables",
                "allowedCwdRoots",
                "allowedEnvKeys",
                "argumentPolicyAllowedFirstArgs",
                "argumentPolicyDeniedFirstArgs",
                "argumentPolicyAllowedLeadingOptions",
                "argumentPolicyPathRestrictedLeadingOptions",
            ]
                .find((field) => String(inputs[field] || "").trim());
            if (pendingField) {
                addToken(pendingField);
                setSaving(false);
                return;
            }
            const argumentPolicyAllowedFirstArgs = uniqueNormalizedTokens(draft.argumentPolicyAllowedFirstArgs);
            const argumentPolicyDeniedFirstArgs = uniqueNormalizedTokens(draft.argumentPolicyDeniedFirstArgs);
            const argumentPolicyAllowedLeadingOptions = uniqueNormalizedTokens(draft.argumentPolicyAllowedLeadingOptions);
            const argumentPolicyPathRestrictedLeadingOptions = uniqueNormalizedTokens(draft.argumentPolicyPathRestrictedLeadingOptions);
            const invalidPathRestrictedOption = argumentPolicyPathRestrictedLeadingOptions.find(
                (option) => !argumentPolicyAllowedLeadingOptions.includes(option)
            );
            if (invalidPathRestrictedOption) {
                setError(`Path-restricted option "${invalidPathRestrictedOption}" must also be listed in Allowed leading options.`);
                return;
            }
            const hasArgumentPolicy = argumentPolicyAllowedFirstArgs.length > 0
                || argumentPolicyDeniedFirstArgs.length > 0
                || argumentPolicyAllowedLeadingOptions.length > 0
                || argumentPolicyPathRestrictedLeadingOptions.length > 0;
            const argumentPolicy = hasArgumentPolicy ? {
                version: Number.isFinite(Number(draft.policyVersion)) && Number(draft.policyVersion) > 0
                    ? Math.trunc(Number(draft.policyVersion))
                    : PROCESS_SCOPE_POLICY_VERSION,
                mode: "first-arg",
                allowedFirstArgs: argumentPolicyAllowedFirstArgs,
                deniedFirstArgs: argumentPolicyDeniedFirstArgs,
                allowedLeadingOptions: argumentPolicyAllowedLeadingOptions,
                pathRestrictedLeadingOptions: argumentPolicyPathRestrictedLeadingOptions,
            } : ((draft.argumentPolicyRaw && typeof draft.argumentPolicyRaw === "object") ? draft.argumentPolicyRaw : undefined);
            const result = await window.electron.plugin.upsertSharedProcessScope({
                scope: normalizedScopeId,
                title: draft.title,
                description: draft.description,
                allowedExecutables: uniqueNormalizedTokens(draft.allowedExecutables),
                allowedCwdRoots: uniqueNormalizedTokens(draft.allowedCwdRoots),
                allowedEnvKeys: uniqueNormalizedTokens(draft.allowedEnvKeys),
                policyVersion: Number.isFinite(Number(draft.policyVersion)) && Number(draft.policyVersion) > 0
                    ? Math.trunc(Number(draft.policyVersion))
                    : PROCESS_SCOPE_POLICY_VERSION,
                argumentPolicy,
                timeoutCeilingMs: Number(draft.timeoutCeilingMs || 0),
                requireConfirmation: draft.requireConfirmation !== false,
            });
            if (!result?.success) {
                setError(result?.error || "Could not save shared scope.");
                return;
            }
            await loadSharedScopes();
            resetDraft();
            setShowEditor(false);
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (scopeId) => {
        const result = await window.electron.plugin.deleteSharedProcessScope(scopeId);
        if (!result?.success) {
            setError(result?.error || "Could not delete shared scope.");
            return;
        }
        await loadSharedScopes();
        if (toCustomScopeIdFromSlug(draft.scope) === scopeId) {
            resetDraft();
            setShowEditor(false);
        }
    };

    return (
        <Card className={styles["card-panel"]}>
            <div className={styles["card-setting-header"]}>
                <div>
                    <div className="bp6-heading" style={{fontSize: "1rem"}}>Shared Process Scopes</div>
                    <div className={classNames("bp6-text-small", "bp6-text-muted")}>
                        Reusable host-managed scopes for commands that multiple plugins may need.
                    </div>
                </div>
            </div>
            <div style={{display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap"}}>
                <div className={classNames("bp6-text-small", "bp6-text-muted")}>
                    Shared scopes belong to the host, not to any one plugin. Plugins may reference them, but grants still control execution.
                </div>
                <Button icon="add" small onClick={openCreate}>Add Shared Scope</Button>
            </div>
            <Card style={{marginTop: 12, border: "1px solid #eef0f2", background: "#fafbfc", boxShadow: "none"}}>
                <div className="bp6-text-small" style={{fontWeight: 600, marginBottom: 4}}>How assignment works</div>
                <div className={classNames("bp6-text-small", "bp6-text-muted")}>
                    1. Define the shared scope here in Settings.
                </div>
                <div className={classNames("bp6-text-small", "bp6-text-muted")}>
                    2. Open Manage Plugins for a specific plugin.
                </div>
                <div className={classNames("bp6-text-small", "bp6-text-muted")}>
                    3. In Capabilities, enable <code>system.process.exec</code> and the shared scope capability for that plugin.
                </div>
            </Card>
            {scopes.length > 0 ? (
                <div style={{display: "flex", flexDirection: "column", gap: 10, marginTop: 14}}>
                    {Object.values(groupedScopes).map(({meta, scopes: groupScopes}) => (
                        <Card key={meta.label} style={{border: "1px solid #eef0f2", background: "#fcfcfd"}}>
                            <div style={{display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 8}}>
                                <div>
                                    <div className="bp6-text-small" style={{fontWeight: 600}}>{meta.label}</div>
                                    <div className={classNames("bp6-text-small", "bp6-text-muted")}>{meta.description}</div>
                                </div>
                                <Tag minimal intent={meta.intent}>{groupScopes.length} scope{groupScopes.length === 1 ? "" : "s"}</Tag>
                            </div>
                            <div style={{display: "flex", flexDirection: "column", gap: 10}}>
                                {groupScopes.map((scope) => {
                                    const usedBy = usageByScopeId[scope.scope] || [];
                                    return (
                                        <Card key={scope.scope} style={{border: "1px solid #eef0f2", background: "#fafbfc", padding: 16}}>
                                            <div style={{display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap"}}>
                                                <div>
                                                    <div className="bp6-text-small" style={{fontWeight: 600}}>{scope.title || scope.scope}</div>
                                                    <div className={classNames("bp6-text-small", "bp6-text-muted")}>
                                                        Capability: <code>{`system.process.scope.${scope.scope}`}</code>
                                                    </div>
                                                </div>
                                                <div style={{display: "flex", gap: 6, alignItems: "center"}}>
                                                    <Button small minimal icon="duplicate" onClick={() => openClone(scope)}>Clone</Button>
                                                    <Button small minimal icon="edit" onClick={() => openEdit(scope)}>Edit</Button>
                                                    <Button small minimal intent="danger" icon="trash" onClick={() => handleDelete(scope.scope)}>Delete</Button>
                                                </div>
                                            </div>
                                            <div className={classNames("bp6-text-small", "bp6-text-muted")} style={{marginTop: 6}}>
                                                {scope.description}
                                            </div>
                                            <div style={{display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8}}>
                                                <Tag minimal>{(scope.allowedExecutables || []).length} command path{(scope.allowedExecutables || []).length === 1 ? "" : "s"}</Tag>
                                                <Tag minimal>timeout max: {scope.timeoutCeilingMs || 30000}ms</Tag>
                                                <Tag minimal>confirm: {scope.requireConfirmation ? "required" : "no"}</Tag>
                                                <Tag minimal>policy v{scope.policyVersion || PROCESS_SCOPE_POLICY_VERSION}</Tag>
                                                <Tag minimal intent={usedBy.length > 0 ? "primary" : "none"}>Granted to plugins: {usedBy.length}</Tag>
                                            </div>
                                            {buildArgumentPolicySummary(scope) ? (
                                                <div className={classNames("bp6-text-small", "bp6-text-muted")} style={{marginTop: 6}}>
                                                    {buildArgumentPolicySummary(scope)}
                                                </div>
                                            ) : null}
                                            <div className={classNames("bp6-text-small", "bp6-text-muted")} style={{marginTop: 8}}>
                                                Grant path: Manage Plugins -> plugin -> Capabilities -> <code>{`system.process.scope.${scope.scope}`}</code>
                                            </div>
                                            {usedBy.length > 0 ? (
                                                <div className={classNames("bp6-text-small", "bp6-text-muted")} style={{marginTop: 8}}>
                                                    {usedBy.map((plugin) => plugin.name || plugin.metadata?.name || plugin.id).join(", ")}
                                                </div>
                                            ) : null}
                                        </Card>
                                    );
                                })}
                            </div>
                        </Card>
                    ))}
                </div>
            ) : (
                <div className={classNames("bp6-text-small", "bp6-text-muted")} style={{marginTop: 14}}>
                    No shared process scopes yet. Add one when several plugins should reuse the same host-approved command family.
                </div>
            )}

            <Dialog
                isOpen={showEditor}
                onClose={() => {
                    setShowEditor(false);
                    resetDraft();
                }}
                title={editingScopeId ? "Edit Shared Scope" : "Create Shared Scope"}
                canEscapeKeyClose={true}
                canOutsideClickClose={!saving}
                style={{width: 680, maxWidth: "calc(100vw - 80px)"}}
            >
                <div className="bp6-dialog-body">
                    <div className={classNames("bp6-text-small", "bp6-text-muted")} style={{marginBottom: 12}}>
                        Define a host-managed reusable scope for multiple plugins. Shared scopes should stay stable and broadly understandable.
                    </div>
                    <div style={{display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12}}>
                        <Tag minimal>Broad grant: <code>system.process.exec</code></Tag>
                        <Tag minimal intent="primary">Narrow grant: <code>{requestCapabilityId}</code></Tag>
                        <Tag minimal intent="success">Visible in plugin capability settings</Tag>
                    </div>
                    <div style={{display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10}}>
                        <FormGroup
                            label="Scope ID"
                            helperText="Use any scope ID (for example: internal-runner). Do not paste full capability IDs."
                        >
                            <InputGroup
                                placeholder="internal-runner"
                                value={draft.scope}
                                onChange={(event) => setDraft((prev) => ({...prev, scope: normalizeCustomScopeSlugInput(event.target.value)}))}
                            />
                        </FormGroup>
                        <FormGroup label="Display name">
                            <InputGroup
                                placeholder="Process Monitoring"
                                value={draft.title}
                                onChange={(event) => setDraft((prev) => ({...prev, title: event.target.value}))}
                            />
                        </FormGroup>
                    </div>
                    <FormGroup label="Description">
                        <InputGroup
                            placeholder="Explain when plugins should request this shared scope."
                            value={draft.description}
                            onChange={(event) => setDraft((prev) => ({...prev, description: event.target.value}))}
                        />
                    </FormGroup>
                    <TokenListInput
                        label="Allowed executable paths"
                        placeholder="/usr/local/bin/htop"
                        helperText="Use absolute paths. Press Enter or comma to add."
                        tokens={draft.allowedExecutables}
                        inputValue={inputs.allowedExecutables}
                        inputError={inputErrors.allowedExecutables}
                        onInputChange={(value) => {
                            setInputs((prev) => ({...prev, allowedExecutables: value}));
                            setInputErrors((prev) => ({...prev, allowedExecutables: ""}));
                        }}
                        onAddToken={() => addToken("allowedExecutables")}
                        onRemoveToken={(token) => removeToken("allowedExecutables", token)}
                    />
                    <TokenListInput
                        label="Allowed CWD roots"
                        placeholder="/Users/alex"
                        helperText="Leave empty to use the standard safe roots for this host."
                        tokens={draft.allowedCwdRoots}
                        inputValue={inputs.allowedCwdRoots}
                        inputError={inputErrors.allowedCwdRoots}
                        onInputChange={(value) => {
                            setInputs((prev) => ({...prev, allowedCwdRoots: value}));
                            setInputErrors((prev) => ({...prev, allowedCwdRoots: ""}));
                        }}
                        onAddToken={() => addToken("allowedCwdRoots")}
                        onRemoveToken={(token) => removeToken("allowedCwdRoots", token)}
                    />
                    <TokenListInput
                        label="Allowed env keys"
                        placeholder="PATH"
                        helperText="Only list env keys this scope actually needs. Press Enter or comma to add."
                        tokens={draft.allowedEnvKeys}
                        inputValue={inputs.allowedEnvKeys}
                        inputError={inputErrors.allowedEnvKeys}
                        onInputChange={(value) => {
                            setInputs((prev) => ({...prev, allowedEnvKeys: value}));
                            setInputErrors((prev) => ({...prev, allowedEnvKeys: ""}));
                        }}
                        onAddToken={() => addToken("allowedEnvKeys")}
                        onRemoveToken={(token) => removeToken("allowedEnvKeys", token)}
                    />
                    <Card style={{border: "1px solid #eef0f2", background: "#fcfcfd", marginTop: 6}}>
                        <div className="bp6-text-small" style={{fontWeight: 600, marginBottom: 6}}>
                            Argument policy (optional)
                        </div>
                        <div className={classNames("bp6-text-small", "bp6-text-muted")} style={{marginBottom: 10}}>
                            Define first-argument and leading-option restrictions. Path-restricted options require absolute paths under allowed CWD roots.
                        </div>
                        <TokenListInput
                            label="Allowed subcommands"
                            placeholder="status"
                            helperText="Optional allowlist of subcommands/tokens accepted as first argument."
                            tokens={draft.argumentPolicyAllowedFirstArgs}
                            inputValue={inputs.argumentPolicyAllowedFirstArgs}
                            inputError={inputErrors.argumentPolicyAllowedFirstArgs}
                            onInputChange={(value) => {
                                setInputs((prev) => ({...prev, argumentPolicyAllowedFirstArgs: value}));
                                setInputErrors((prev) => ({...prev, argumentPolicyAllowedFirstArgs: ""}));
                            }}
                            onAddToken={() => addToken("argumentPolicyAllowedFirstArgs")}
                            onRemoveToken={(token) => removeToken("argumentPolicyAllowedFirstArgs", token)}
                        />
                        <TokenListInput
                            label="Blocked subcommands"
                            placeholder="credential"
                            helperText="Explicit denylist checked before allowlist."
                            tokens={draft.argumentPolicyDeniedFirstArgs}
                            inputValue={inputs.argumentPolicyDeniedFirstArgs}
                            inputError={inputErrors.argumentPolicyDeniedFirstArgs}
                            onInputChange={(value) => {
                                setInputs((prev) => ({...prev, argumentPolicyDeniedFirstArgs: value}));
                                setInputErrors((prev) => ({...prev, argumentPolicyDeniedFirstArgs: ""}));
                            }}
                            onAddToken={() => addToken("argumentPolicyDeniedFirstArgs")}
                            onRemoveToken={(token) => removeToken("argumentPolicyDeniedFirstArgs", token)}
                        />
                        <TokenListInput
                            label="Allowed leading options"
                            placeholder="-C"
                            helperText="Option-like tokens accepted before first subcommand."
                            tokens={draft.argumentPolicyAllowedLeadingOptions}
                            inputValue={inputs.argumentPolicyAllowedLeadingOptions}
                            inputError={inputErrors.argumentPolicyAllowedLeadingOptions}
                            onInputChange={(value) => {
                                setInputs((prev) => ({...prev, argumentPolicyAllowedLeadingOptions: value}));
                                setInputErrors((prev) => ({...prev, argumentPolicyAllowedLeadingOptions: ""}));
                            }}
                            onAddToken={() => addToken("argumentPolicyAllowedLeadingOptions")}
                            onRemoveToken={(token) => removeToken("argumentPolicyAllowedLeadingOptions", token)}
                        />
                        <TokenListInput
                            label="Path-restricted leading options"
                            placeholder="--chdir"
                            helperText="Must also exist in Allowed leading options."
                            tokens={draft.argumentPolicyPathRestrictedLeadingOptions}
                            inputValue={inputs.argumentPolicyPathRestrictedLeadingOptions}
                            inputError={inputErrors.argumentPolicyPathRestrictedLeadingOptions}
                            onInputChange={(value) => {
                                setInputs((prev) => ({...prev, argumentPolicyPathRestrictedLeadingOptions: value}));
                                setInputErrors((prev) => ({...prev, argumentPolicyPathRestrictedLeadingOptions: ""}));
                            }}
                            onAddToken={() => addToken("argumentPolicyPathRestrictedLeadingOptions")}
                            onRemoveToken={(token) => removeToken("argumentPolicyPathRestrictedLeadingOptions", token)}
                        />
                        <div className={classNames("bp6-text-small", "bp6-text-muted")}>
                            Policy version: <code>{draft.policyVersion || PROCESS_SCOPE_POLICY_VERSION}</code>
                        </div>
                        {draft.argumentPolicyRaw?.mode && draft.argumentPolicyRaw.mode !== "first-arg" ? (
                            <div className={classNames("bp6-text-small", "bp6-text-muted")} style={{marginTop: 6}}>
                                Existing advanced policy mode <code>{draft.argumentPolicyRaw.mode}</code> is preserved unless first-arg fields are set above.
                            </div>
                        ) : null}
                    </Card>
                    <div style={{display: "grid", gridTemplateColumns: "minmax(220px, 1fr)", gap: 10, alignItems: "start"}}>
                        <FormGroup label="Timeout ceiling (ms)">
                            <InputGroup
                                type="number"
                                value={draft.timeoutCeilingMs}
                                onChange={(event) => setDraft((prev) => ({...prev, timeoutCeilingMs: event.target.value}))}
                            />
                        </FormGroup>
                        <FormGroup
                            label="Approval policy"
                            helperText="Turn this on when operators should explicitly approve commands in this shared scope."
                        >
                            <Switch
                                checked={draft.requireConfirmation}
                                label="Require confirmation before execution"
                                onChange={(event) => setDraft((prev) => ({...prev, requireConfirmation: event.target.checked}))}
                            />
                        </FormGroup>
                    </div>
                    {error ? <div className="bp6-text-small" style={{color: "#c23030", marginTop: 8}}>{error}</div> : null}
                </div>
                <div className="bp6-dialog-footer">
                    <div className={classNames("bp6-text-small", "bp6-text-muted")} style={{paddingBottom: 8}}>
                        Plugin request ID: <code>{requestCapabilityId}</code>. This is a host-managed shared scope reference. Referencing it in plugin code does not grant permission by itself.
                    </div>
                    <div className="bp6-dialog-footer-actions">
                        <Button minimal onClick={() => {
                            setShowEditor(false);
                            resetDraft();
                        }}>Cancel</Button>
                        <Button intent="primary" loading={saving} onClick={handleSave}>
                            {editingScopeId ? "Save Changes" : "Save Scope"}
                        </Button>
                    </div>
                </div>
            </Dialog>
        </Card>
    );
}
