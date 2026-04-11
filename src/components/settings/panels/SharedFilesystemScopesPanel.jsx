import React, {useEffect, useMemo, useState} from "react";
import {Button, Card, Checkbox, Dialog, FormGroup, InputGroup, Switch, Tag} from "@blueprintjs/core";
import classNames from "classnames";

import * as styles from "../../css/SettingsDialog.module.css";

const FILESYSTEM_OPERATION_OPTIONS = Object.freeze([
    "writeFile",
    "appendFile",
    "mkdir",
    "rename",
    "remove",
]);

const FILESYSTEM_OPERATION_LABELS = Object.freeze({
    writeFile: "Write file",
    appendFile: "Append file",
    mkdir: "Create directory",
    rename: "Rename path",
    remove: "Remove path",
});

const EMPTY_SCOPE_DRAFT = Object.freeze({
    scope: "",
    title: "",
    description: "",
    allowedRoots: [],
    allowedOperationTypes: [...FILESYSTEM_OPERATION_OPTIONS],
    requireConfirmation: true,
});

function uniqueNormalizedTokens(values = []) {
    return [...new Set((Array.isArray(values) ? values : [])
        .filter((value) => typeof value === "string" && value.trim())
        .map((value) => value.trim()))];
}

function isAbsoluteLikePath(value = "") {
    const text = String(value || "").trim();
    return /^([A-Za-z]:[\\/]|\/)/.test(text);
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
    const roots = Array.isArray(scope?.allowedRoots) ? scope.allowedRoots : [];
    const operations = Array.isArray(scope?.allowedOperationTypes) ? scope.allowedOperationTypes : [];
    const hasDestructiveOps = operations.includes("remove") || operations.includes("rename");
    const touchesSensitiveRoot = roots.some((root) => /^\/(etc|usr|bin|sbin|opt|var)\b/.test(String(root || "").trim()));
    if (hasDestructiveOps || touchesSensitiveRoot) {
        return {
            label: "Higher-risk shared filesystem scopes",
            intent: "warning",
            description: "Reusable filesystem scopes that can modify sensitive paths or perform destructive operations.",
        };
    }
    return {
        label: "Scoped shared filesystem scopes",
        intent: "success",
        description: "Reusable filesystem scopes constrained to explicit roots and operations.",
    };
}

export default function SharedFilesystemScopesPanel() {
    const [scopes, setScopes] = useState([]);
    const [plugins, setPlugins] = useState([]);
    const [showEditor, setShowEditor] = useState(false);
    const [draft, setDraft] = useState(EMPTY_SCOPE_DRAFT);
    const [editingScopeId, setEditingScopeId] = useState("");
    const [error, setError] = useState("");
    const [saving, setSaving] = useState(false);
    const [rootInput, setRootInput] = useState("");
    const [rootInputError, setRootInputError] = useState("");

    const loadSharedScopes = async () => {
        const result = await window.electron.plugin.getSharedFilesystemScopes();
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
            const capabilityId = `system.fs.scope.${scope.scope}`;
            acc[scope.scope] = (Array.isArray(plugins) ? plugins : [])
                .filter((plugin) => Array.isArray(plugin?.capabilities) && plugin.capabilities.includes(capabilityId));
            return acc;
        }, {})
    ), [plugins, scopes]);

    const requestCapabilityId = `system.fs.scope.${toCustomScopeIdFromSlug(draft.scope) || "<scope-id>"}`;

    const resetDraft = () => {
        setDraft(EMPTY_SCOPE_DRAFT);
        setEditingScopeId("");
        setError("");
        setRootInput("");
        setRootInputError("");
    };

    const addRootToken = () => {
        const nextToken = String(rootInput || "").trim().replace(/,$/, "");
        if (!nextToken) return;
        if (!isAbsoluteLikePath(nextToken)) {
            setRootInputError("Use an absolute path.");
            return;
        }
        setDraft((prev) => ({...prev, allowedRoots: uniqueNormalizedTokens([...(prev.allowedRoots || []), nextToken])}));
        setRootInput("");
        setRootInputError("");
    };

    const removeRootToken = (token) => {
        setDraft((prev) => ({...prev, allowedRoots: (prev.allowedRoots || []).filter((value) => value !== token)}));
    };

    const toggleOperation = (operationType, checked) => {
        setDraft((prev) => {
            const next = new Set(Array.isArray(prev.allowedOperationTypes) ? prev.allowedOperationTypes : []);
            if (checked) {
                next.add(operationType);
            } else {
                next.delete(operationType);
            }
            return {
                ...prev,
                allowedOperationTypes: [...next],
            };
        });
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
            allowedRoots: uniqueNormalizedTokens(scope?.allowedRoots || []),
            allowedOperationTypes: uniqueNormalizedTokens(scope?.allowedOperationTypes || []),
            requireConfirmation: scope?.requireConfirmation !== false,
        });
        setError("");
        setRootInput("");
        setRootInputError("");
        setShowEditor(true);
    };

    const openClone = (scope) => {
        setEditingScopeId("");
        const clonedScopeSlug = normalizeCustomScopeSlugInput(String(scope?.scope || ""));
        setDraft({
            scope: `${clonedScopeSlug || "scope"}-copy`,
            title: scope?.title ? `${scope.title} Copy` : "Copied Shared Filesystem Scope",
            description: scope?.description || "",
            allowedRoots: uniqueNormalizedTokens(scope?.allowedRoots || []),
            allowedOperationTypes: uniqueNormalizedTokens(scope?.allowedOperationTypes || []),
            requireConfirmation: scope?.requireConfirmation !== false,
        });
        setError("");
        setRootInput("");
        setRootInputError("");
        setShowEditor(true);
    };

    const handleSave = async () => {
        setSaving(true);
        setError("");
        try {
            const normalizedScopeId = toCustomScopeIdFromSlug(draft.scope);
            if (!normalizedScopeId) {
                setError("Scope ID is required. Use any scope ID such as workspace-write.");
                return;
            }
            if (String(rootInput || "").trim()) {
                addRootToken();
                setSaving(false);
                return;
            }
            const allowedRoots = uniqueNormalizedTokens(draft.allowedRoots || []).filter((root) => isAbsoluteLikePath(root));
            if (allowedRoots.length === 0) {
                setError("Add at least one absolute root path.");
                return;
            }
            const allowedOperationTypes = uniqueNormalizedTokens(draft.allowedOperationTypes || [])
                .filter((operation) => FILESYSTEM_OPERATION_OPTIONS.includes(operation));
            if (allowedOperationTypes.length === 0) {
                setError("Select at least one allowed filesystem operation.");
                return;
            }
            const result = await window.electron.plugin.upsertSharedFilesystemScope({
                scope: normalizedScopeId,
                title: draft.title,
                description: draft.description,
                allowedRoots,
                allowedOperationTypes,
                requireConfirmation: draft.requireConfirmation !== false,
            });
            if (!result?.success) {
                setError(result?.error || "Could not save shared filesystem scope.");
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
        const result = await window.electron.plugin.deleteSharedFilesystemScope(scopeId);
        if (!result?.success) {
            setError(result?.error || "Could not delete shared filesystem scope.");
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
                    <div className="bp6-heading" style={{fontSize: "1rem"}}>Shared Filesystem Scopes</div>
                    <div className={classNames("bp6-text-small", "bp6-text-muted")}>
                        Reusable host-managed filesystem scopes for paths/operations multiple plugins may need.
                    </div>
                </div>
            </div>
            <div style={{display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap"}}>
                <div className={classNames("bp6-text-small", "bp6-text-muted")}>
                    Shared filesystem scopes belong to the host, not to any one plugin. Plugins may reference them, but grants still control execution.
                </div>
                <Button icon="add" small onClick={openCreate}>Add Shared Filesystem Scope</Button>
            </div>
            <Card style={{marginTop: 12, border: "1px solid #eef0f2", background: "#fafbfc", boxShadow: "none"}}>
                <div className="bp6-text-small" style={{fontWeight: 600, marginBottom: 4}}>How assignment works</div>
                <div className={classNames("bp6-text-small", "bp6-text-muted")}>
                    1. Define the shared filesystem scope here in Settings.
                </div>
                <div className={classNames("bp6-text-small", "bp6-text-muted")}>
                    2. Open Manage Plugins for a specific plugin.
                </div>
                <div className={classNames("bp6-text-small", "bp6-text-muted")}>
                    3. In Capabilities, enable <code>system.host.write</code> and the shared filesystem scope capability for that plugin.
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
                                                        Capability: <code>{`system.fs.scope.${scope.scope}`}</code>
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
                                                <Tag minimal>{(scope.allowedRoots || []).length} root{(scope.allowedRoots || []).length === 1 ? "" : "s"}</Tag>
                                                <Tag minimal>{(scope.allowedOperationTypes || []).length} operation{(scope.allowedOperationTypes || []).length === 1 ? "" : "s"}</Tag>
                                                <Tag minimal>confirm: {scope.requireConfirmation ? "required" : "no"}</Tag>
                                                <Tag minimal intent={usedBy.length > 0 ? "primary" : "none"}>Granted to plugins: {usedBy.length}</Tag>
                                            </div>
                                            <div className={classNames("bp6-text-small", "bp6-text-muted")} style={{marginTop: 8}}>
                                                Grant path: Manage Plugins -> plugin -> Capabilities -> <code>{`system.fs.scope.${scope.scope}`}</code>
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
                    No shared filesystem scopes yet. Add one when several plugins should reuse the same host-approved filesystem policy.
                </div>
            )}

            <Dialog
                isOpen={showEditor}
                onClose={() => {
                    setShowEditor(false);
                    resetDraft();
                }}
                title={editingScopeId ? "Edit Shared Filesystem Scope" : "Create Shared Filesystem Scope"}
                canEscapeKeyClose={true}
                canOutsideClickClose={!saving}
                style={{width: 680, maxWidth: "calc(100vw - 80px)"}}
            >
                <div className="bp6-dialog-body">
                    <div className={classNames("bp6-text-small", "bp6-text-muted")} style={{marginBottom: 12}}>
                        Define a host-managed reusable filesystem scope for multiple plugins. Shared scopes should stay explicit and narrow.
                    </div>
                    <div style={{display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12}}>
                        <Tag minimal>Broad grant: <code>system.host.write</code></Tag>
                        <Tag minimal intent="primary">Narrow grant: <code>{requestCapabilityId}</code></Tag>
                        <Tag minimal intent="success">Visible in plugin capability settings</Tag>
                    </div>
                    <div style={{display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10}}>
                        <FormGroup
                            label="Scope ID"
                            helperText="Use any scope ID (for example: workspace-write). Do not paste full capability IDs."
                        >
                            <InputGroup
                                placeholder="workspace-write"
                                value={draft.scope}
                                onChange={(event) => setDraft((prev) => ({...prev, scope: normalizeCustomScopeSlugInput(event.target.value)}))}
                            />
                        </FormGroup>
                        <FormGroup label="Display name">
                            <InputGroup
                                placeholder="Shared Workspace Writes"
                                value={draft.title}
                                onChange={(event) => setDraft((prev) => ({...prev, title: event.target.value}))}
                            />
                        </FormGroup>
                    </div>
                    <FormGroup label="Description">
                        <InputGroup
                            placeholder="Explain when plugins should request this shared filesystem scope."
                            value={draft.description}
                            onChange={(event) => setDraft((prev) => ({...prev, description: event.target.value}))}
                        />
                    </FormGroup>
                    <FormGroup
                        label="Allowed roots"
                        helperText="Use absolute paths. Press Enter or comma to add."
                    >
                        <InputGroup
                            placeholder="/Users/alexvwan/dev/fdo/workspace"
                            value={rootInput}
                            intent={rootInputError ? "danger" : "none"}
                            onChange={(event) => {
                                setRootInput(event.target.value);
                                setRootInputError("");
                            }}
                            onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === ",") {
                                    event.preventDefault();
                                    addRootToken();
                                }
                            }}
                            onBlur={() => {
                                if (String(rootInput || "").trim()) addRootToken();
                            }}
                        />
                        {rootInputError ? <div className="bp6-text-small" style={{color: "#c23030", marginTop: 4}}>{rootInputError}</div> : null}
                        {draft.allowedRoots.length > 0 ? (
                            <div style={{display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8}}>
                                {draft.allowedRoots.map((token) => (
                                    <Tag key={`allowed-root-${token}`} minimal interactive rightIcon="cross" onRemove={() => removeRootToken(token)}>
                                        {token}
                                    </Tag>
                                ))}
                            </div>
                        ) : null}
                    </FormGroup>
                    <FormGroup
                        label="Allowed operation types"
                        helperText="Select only filesystem operations this shared scope should allow."
                    >
                        <div style={{display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 6}}>
                            {FILESYSTEM_OPERATION_OPTIONS.map((operationType) => (
                                <Checkbox
                                    key={`filesystem-operation-${operationType}`}
                                    checked={(draft.allowedOperationTypes || []).includes(operationType)}
                                    label={FILESYSTEM_OPERATION_LABELS[operationType] || operationType}
                                    onChange={(event) => toggleOperation(operationType, event.target.checked)}
                                />
                            ))}
                        </div>
                    </FormGroup>
                    <FormGroup
                        label="Approval policy"
                        helperText="Turn this on when operators should explicitly approve filesystem operations in this shared scope."
                    >
                        <Switch
                            checked={draft.requireConfirmation}
                            label="Require confirmation before filesystem operations"
                            onChange={(event) => setDraft((prev) => ({...prev, requireConfirmation: event.target.checked}))}
                        />
                    </FormGroup>
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
