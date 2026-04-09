import {
    Alert,
    Button,
    Card,
    Checkbox,
    ControlGroup,
    Dialog,
    Divider,
    FormGroup,
    HTMLSelect,
    Icon,
    InputGroup, NonIdealState,
    Switch,
    Tab,
    Tabs,
    Tag,
    Tooltip as TooltipBP
} from "@blueprintjs/core";
import PropTypes from "prop-types";
import * as styles from './css/ManagePluginsDialog.module.css'
import {CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis} from "recharts";
import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {addHours, addMinutes, format, formatDistanceToNow, parse, startOfDay} from 'date-fns';
import {debounce} from "lodash";
import classNames from "classnames";
import {AppToaster} from "./AppToaster.jsx";
import {metricDensityReductionInterval} from "../utils/metricDensityReductionInterval";
import {CertificateValidComponent} from "./editor/utils/CertificateValidComponent";
import {RootCertificateSelectionComponent, selectRootCert} from "./editor/utils/RootCertificateSelectionComponent";
import {CodeEditorSelectionComponent, selectCodeEditor} from "./editor/utils/CodeEditorSelectionComponent";
import {
    applyCapabilityToggle,
    buildScopeCapabilities,
    getSelectedScopeCapabilities,
    hasCapabilitySelectionChanges
} from "../utils/pluginCapabilitySelection";
import {getCapabilityPresentation} from "../utils/capabilityPresentation";
import {getPluginTrustTier} from "../utils/pluginTrustTier";
import {buildCapabilityDeclarationSummary} from "../utils/pluginCapabilityDeclaration";
import {sanitizeBlueprintIcon} from "../utils/blueprintIcons";

function scopeCategoryLabel(scopeItem = {}) {
    if (scopeItem?.userDefined === true) {
        return "Custom Scopes";
    }
    if (scopeItem?.baseCapability === "system.process.exec" && scopeItem?.fallback === true) {
        return "Host-Specific Fallback Scopes";
    }
    return scopeItem?.category || "Other";
}

function scopeCategorySortWeight(categoryLabel = "") {
    if (categoryLabel === "Custom Scopes") return -10;
    if (categoryLabel === "Host-Specific Fallback Scopes") return 100;
    return 10;
}

function getShortTrustTierLabel(trustTier = {}) {
    switch (trustTier?.id) {
        case "high-trust-administrative":
            return "Admin";
        case "scoped-operator":
            return "Operator";
        default:
            return "Basic";
    }
}

const CUSTOM_SCOPE_TOKEN_FIELDS = Object.freeze([
    "allowedExecutables",
    "allowedCwdRoots",
    "allowedEnvKeys",
]);

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

function customScopeTokenValidation(field, token) {
    const value = String(token || "").trim();
    if (!value) {
        return "Value cannot be empty.";
    }
    if (field === "allowedExecutables" || field === "allowedCwdRoots") {
        return isAbsoluteLikePath(value) ? "" : "Use an absolute path.";
    }
    if (field === "allowedEnvKeys") {
        return isValidEnvKey(value) ? "" : "Use a valid environment variable key.";
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

function classifyCustomScopeRisk(scope = {}) {
    const commands = (Array.isArray(scope?.allowedExecutables) ? scope.allowedExecutables : [])
        .map((entry) => String(entry || "").trim().toLowerCase());
    const description = String(scope?.description || "").toLowerCase();
    const saferCommandHints = ["htop", "top", "btop", "glances", "ps", "iostat", "vm_stat", "uptime", "free", "tasklist"];
    const looksSafer = commands.every((entry) => saferCommandHints.some((hint) => entry.endsWith(`/${hint}`) || entry.endsWith(`\\${hint}.exe`) || entry === hint))
        && !/(apply|delete|write|restart|stop|start|kill|mutate|admin|install|remove)/.test(description);
    return looksSafer
        ? {
            label: "Safer host scopes",
            intent: "success",
            description: "Read-oriented monitoring or observation commands.",
        }
        : {
            label: "Higher-risk host scopes",
            intent: "warning",
            description: "Commands that may mutate host state or need closer review.",
        };
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
                    if (String(inputValue || "").trim()) {
                        onAddToken();
                    }
                }}
            />
            <div className={classNames("bp6-text-small", "bp6-text-muted")} style={{marginTop: "4px"}}>
                {helperText}
            </div>
            {inputError ? (
                <div className={classNames("bp6-text-small")} style={{color: "#c23030", marginTop: "4px"}}>
                    {inputError}
                </div>
            ) : null}
            {tokens.length > 0 ? (
                <div style={{display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "8px"}}>
                    {tokens.map((token) => (
                        <Tag
                            key={`${label}-${token}`}
                            minimal
                            interactive
                            onRemove={() => onRemoveToken(token)}
                        >
                            {token}
                        </Tag>
                    ))}
                </div>
            ) : null}
        </FormGroup>
    );
}

function PolicyDetailList({label, values = [], maxVisible = 4}) {
    if (!Array.isArray(values) || values.length === 0) {
        return null;
    }
    const visibleValues = values.slice(0, maxVisible);
    const remaining = values.length - visibleValues.length;
    return (
        <div style={{marginTop: "8px"}}>
            <div className={"bp6-text-small"} style={{fontWeight: 600, marginBottom: "4px"}}>{label}</div>
            <div style={{display: "flex", gap: "6px", flexWrap: "wrap"}}>
                {visibleValues.map((value) => (
                    <Tag key={`${label}-${value}`} minimal>{value}</Tag>
                ))}
                {remaining > 0 ? <Tag minimal>{`+${remaining} more`}</Tag> : null}
            </div>
        </div>
    );
}

function buildScopeSummary(scopeItem = {}) {
    const commandCount = Array.isArray(scopeItem?.allowedExecutables) ? scopeItem.allowedExecutables.length : 0;
    const cwdCount = Array.isArray(scopeItem?.allowedCwdRoots) ? scopeItem.allowedCwdRoots.length : 0;
    const envCount = Array.isArray(scopeItem?.allowedEnvKeys) ? scopeItem.allowedEnvKeys.length : 0;
    const parts = [];

    if (commandCount > 0) {
        const preview = scopeItem.allowedExecutables.slice(0, 2).join(", ");
        parts.push(`Commands: ${preview}${commandCount > 2 ? ` +${commandCount - 2} more` : ""}`);
    }
    if (cwdCount > 0) {
        parts.push(`CWD roots: ${cwdCount}`);
    }
    if (envCount > 0) {
        parts.push(`Env keys: ${envCount}`);
    }
    if (scopeItem?.timeoutCeilingMs) {
        parts.push(`Timeout max: ${scopeItem.timeoutCeilingMs}ms`);
    }

    return parts.join(" | ");
}

export const ManagePluginsDialog = ({
                                        show,
                                        setShow,
                                        plugins,
                                        activePlugins,
                                        deselectPlugin,
                                        selectPlugin,
                                        removePlugin,
                                        setSearchActions,
                                        refreshPluginsState,
                                        focusRequest,
                                    }) => {
    const [selectedTabId, setSelectedTabId] = useState(null);
    const [sortedPlugins, setSortedPlugins] = useState([]);
    const [scopePolicies, setScopePolicies] = useState([]);
    const [runtimeStatusByPluginId, setRuntimeStatusByPluginId] = useState(new Map());

    const reloadScopePolicies = useCallback(async (pluginId = "") => {
        try {
            const result = await window.electron.plugin.getScopePolicies(pluginId);
            if (result?.success) {
                setScopePolicies(Array.isArray(result.scopes) ? result.scopes : []);
                return;
            }
            setScopePolicies([]);
        } catch (_) {
            setScopePolicies([]);
        }
    }, []);

    const refreshRuntimeStatuses = useCallback(async (requestedIds = null) => {
        const ids = Array.isArray(requestedIds)
            ? requestedIds.map((item) => String(item || "").trim()).filter(Boolean)
            : (Array.isArray(plugins) ? plugins : []).map((item) => String(item?.id || "").trim()).filter(Boolean);
        if (ids.length === 0 || typeof window?.electron?.plugin?.getRuntimeStatus !== "function") {
            setRuntimeStatusByPluginId(new Map());
            return;
        }
        try {
            const result = await window.electron.plugin.getRuntimeStatus(ids);
            if (!result?.success || !Array.isArray(result.statuses)) {
                return;
            }
            setRuntimeStatusByPluginId((prev) => {
                const next = new Map(prev);
                result.statuses.forEach((status) => {
                    next.set(status.id, status);
                });
                return next;
            });
        } catch (_) {
            // keep last known status
        }
    }, [plugins]);

    useEffect(() => {
        if (!plugins) return;

        const sorted = plugins.slice().sort((a, b) => {
            const isAActive = activePlugins.some((p) => p.id === a.id);
            const isBActive = activePlugins.some((p) => p.id === b.id);

            if (isAActive !== isBActive) {
                return isAActive ? -1 : 1; // Active plugins first
            }

            return a.name.localeCompare(b.name); // Alphabetical order within each group
        });

        setSortedPlugins(sorted);

        // Set the default tab only if it's null or the selected tab no longer exists
        if (!selectedTabId || !sorted.some(plugin => plugin.id === selectedTabId)) {
            setSelectedTabId(sorted.length > 0 ? sorted[0].id : null);
        }
    }, [plugins, activePlugins]);

    useEffect(() => {
        setSearchActions((prev) => {
            const newActions = sortedPlugins?.reduce((acc, plugin) => {
                if (activePlugins.length === 0 || activePlugins.every((p) => p.id !== plugin.id)) return acc;
                if (prev.some(action => action.id === `navigate-active-manage-${plugin.id}`)) return acc;
                return [
                    ...acc,
                    {
                        id: `navigate-active-manage-${plugin.id}`,
                        name: "Manage",
                        subtitle: "Manage plugin",
                        icon: <Icon icon={"cog"} size={16}/>,
                        perform: () => {
                            setShow(true);
                            setTimeout(() => {
                                setSelectedTabId(plugin.id);
                            }, 300);
                        },
                        section: plugin.name,
                        sectionPriorityKey: "Active plugin actions",
                    }
                ];
            }, []);

            return [...prev, ...newActions];
        });
    }, [sortedPlugins, activePlugins]);

    useEffect(() => {
        if (!show) return;
        void reloadScopePolicies(selectedTabId || "");
    }, [show, selectedTabId, reloadScopePolicies]);

    useEffect(() => {
        if (!show) return;
        void refreshRuntimeStatuses();
    }, [show, plugins, refreshRuntimeStatuses]);

    useEffect(() => {
        if (!show || !focusRequest?.pluginId) return;
        setSelectedTabId(focusRequest.pluginId);
    }, [show, focusRequest?.pluginId, focusRequest?.requestId]);

    return (
        <Dialog
            autoFocus={true}
            canEscapeKeyClose={true}
            canOutsideClickClose={true}
            isOpen={show}
            isCloseButtonShown={true}
            onClose={() => setShow(false)}
            className={styles["manage-plugins"]}
            title={<><Icon icon={"cube"} intent={"primary"} size={20}/><span className={"bp6-heading"}
                                                                             style={{fontSize: "1.2rem"}}>Manage Plugins</span></>}
            style={{
                minWidth: 800,
                paddingBottom: 0
            }}
        >
            {sortedPlugins?.length > 0 ? (
            <Tabs
                vertical={true}
                animate={true}
                selectedTabId={selectedTabId}
                onChange={setSelectedTabId}
                id={"manage-plugins-tabs"}
                renderActiveTabPanelOnly={true}
            >
                {sortedPlugins?.map((plugin, idx) => (
                        <Tab id={plugin.id} key={plugin.id}
                             title={
                                 <div style={{verticalAlign: "center", width: "180px"}}
                                      className={"bp6-text-overflow-ellipsis"}>
                                     <Icon icon={sanitizeBlueprintIcon(plugin.icon)} intent={"primary"}/>
                                     <span style={{
                                         marginLeft: "5px",
                                         fontSize: "0.8rem",
                                         lineHeight: "10px",
                                         textOverflow: "ellipsis"
                                     }}
                                           className={classNames("bp6-text-muted")}>{plugin.name}</span>
                                 </div>
                             }
                             style={{
                                 borderBottom: (activePlugins?.some((p) => p.id === plugin.id)) ? "solid 1px #d4d5d7" : "",
                                 borderTop: idx === 0 ? "solid 1px #d4d5d7" : "",
                             }}
                             panelClassName={styles["panel"]}
                             panel={
                                 <SelectPluginPanel plugin={plugin} activePlugins={activePlugins}
                                                    plugins={plugins}
                                                    selectPlugin={selectPlugin}
                                                    deselectPlugin={deselectPlugin} removePlugin={removePlugin}
                                                    setSelectedTabId={setSelectedTabId}
                                                    selectedTabId={selectedTabId} setSortedPlugins={setSortedPlugins}
                                                    scopePolicies={scopePolicies}
                                                    runtimeStatus={runtimeStatusByPluginId.get(plugin.id) || null}
                                                    refreshPluginsState={refreshPluginsState}
                                                    reloadScopePolicies={reloadScopePolicies}
                                                     highlightedCapabilityIds={
                                                        focusRequest?.pluginId === plugin.id
                                                            ? (Array.isArray(focusRequest?.capabilityIds) ? focusRequest.capabilityIds : [])
                                                            : []
                                                    }
                                                    refreshRuntimeStatuses={refreshRuntimeStatuses}
                                 />
                             }/>
                    )
                )}
            </Tabs>
            ) : (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
                    <NonIdealState
                        icon="layout"
                        title="No plugins found"
                        description="Please add or install plugins to manage them here."
                        layout="vertical"
                    />
                </div>
            )}
        </Dialog>
    )
}
ManagePluginsDialog.propTypes = {
    show: PropTypes.bool,
    setShow: PropTypes.func,
    plugins: PropTypes.array,
    activePlugins: PropTypes.array,
    selectPlugin: PropTypes.func,
    deselectPlugin: PropTypes.func,
    removePlugin: PropTypes.func,
    setSearchActions: PropTypes.func,
    refreshPluginsState: PropTypes.func,
    reloadScopePolicies: PropTypes.func,
    refreshRuntimeStatuses: PropTypes.func,
    focusRequest: PropTypes.shape({
        requestId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
        pluginId: PropTypes.string,
        capabilityIds: PropTypes.array,
    }),
}

const SelectPluginPanel = ({
                               plugin,
                               plugins,
                               activePlugins,
                               deselectPlugin,
                               selectPlugin,
                               removePlugin,
                               setSelectedTabId,
                               selectedTabId,
                               setSortedPlugins,
                               scopePolicies,
                           runtimeStatus,
                           refreshPluginsState,
                           reloadScopePolicies,
                           refreshRuntimeStatuses,
                           highlightedCapabilityIds,
                       }) => {
    const emptyCustomScopeDraft = {
        scope: "",
        title: "",
        description: "",
        allowedExecutables: [],
        allowedCwdRoots: [],
        allowedEnvKeys: [],
        timeoutCeilingMs: "30000",
        requireConfirmation: true,
    };
    const BASE_PRIVILEGED_CAPABILITIES = [
        "system.hosts.write",
        "system.process.exec",
    ];
    const [metrics, setMetrics] = useState([]);
    const [availableMetrics, setAvailableMetrics] = useState([]);
    const [selectedLines, setSelectedLines] = useState({});
    const [localTimeRange, setLocalTimeRange] = useState([
        format(addMinutes(new Date(), -5), "HH:mm"),
        format(new Date(), "HH:mm")
    ]);
    const [timeRange, setTimeRange] = useState([addMinutes(new Date(), -5), new Date()]);
    const [selectedPreset, setSelectedPreset] = useState("Last 5 mins");
    const [isStatic, setIsStatic] = useState(false);
    const [creationTime, setCreationTime] = useState(null);
    const [refreshCountdown, setRefreshCountdown] = useState(5);
    const [refreshCountdownLoading, setRefreshCountdownLoading] = useState(false);
    const [isOpenClean, setIsOpenClean] = useState(false)
    const [isLoadingClean, setIsLoadingClean] = useState(false)
    const [isOpenRemove, setIsOpenRemove] = useState(false)
    const [capabilitiesDraft, setCapabilitiesDraft] = useState([]);
    const [isSavingCapabilities, setIsSavingCapabilities] = useState(false);
    const [capabilityFilter, setCapabilityFilter] = useState("");
    const [showCapabilityIntent, setShowCapabilityIntent] = useState(false);
    const [showCapabilitiesPanel, setShowCapabilitiesPanel] = useState(false);
    const [customProcessScopes, setCustomProcessScopes] = useState([]);
    const [showCustomScopeEditor, setShowCustomScopeEditor] = useState(false);
    const [customScopeDraft, setCustomScopeDraft] = useState(emptyCustomScopeDraft);
    const [customScopeError, setCustomScopeError] = useState("");
    const [customScopeSaving, setCustomScopeSaving] = useState(false);
    const [editingCustomScopeId, setEditingCustomScopeId] = useState("");
    const [activePolicyDetails, setActivePolicyDetails] = useState(null);
    const [customScopeInputs, setCustomScopeInputs] = useState({
        allowedExecutables: "",
        allowedCwdRoots: "",
        allowedEnvKeys: "",
    });
    const [customScopeInputErrors, setCustomScopeInputErrors] = useState({
        allowedExecutables: "",
        allowedCwdRoots: "",
        allowedEnvKeys: "",
    });

    const [pluginVerification, setPluginVerification] = useState(null)

    const [rootCertificates, setRootCertificates] = useState([])
    const [resignProgress, setResignProgress] = useState(false)
    const [onRootCertificateSelected, setOnRootCertificateSelected] = useState(null)
    const [showRootCertificateDialog, setShowRootCertificateDialog] = useState(false)
    const [rememberedRootCertificate, setRememberedRootCertificate] = useState(null);

    const [openEditorProgress, setOpenEditorProgress] = useState(false)
    const [showCodeEditorDialog, setShowCodeEditorDialog] = useState(false)
    const [onCodeEditorSelected, setOnCodeEditorSelected] = useState(null)
    const [rememberedEditor, setRememberedEditor] = useState(null);

    const rememberChoiceRef = useRef(false);
    const rememberEditorRef = useRef(false);
    const capabilityFilterExpandedRef = useRef(false);
    const capabilityPanelBeforeFilterRef = useRef(false);

    const [exportProgress, setExportProgress] = useState(false)

    useEffect(() => {
        setCapabilitiesDraft(Array.isArray(plugin?.capabilities) ? plugin.capabilities : []);
        setActivePolicyDetails(null);
    }, [plugin?.id, plugin?.capabilities]);

    useEffect(() => {
        let cancelled = false;
        if (typeof window?.electron?.plugin?.getPluginCustomProcessScopes !== "function") {
            setCustomProcessScopes([]);
            return () => {
                cancelled = true;
            };
        }
        window.electron.plugin.getPluginCustomProcessScopes(plugin?.id).then((result) => {
            if (cancelled) return;
            setCustomProcessScopes(result?.success && Array.isArray(result?.scopes) ? result.scopes : []);
        }).catch(() => {
            if (!cancelled) {
                setCustomProcessScopes([]);
            }
        });
        return () => {
            cancelled = true;
        };
    }, [plugin?.id]);

    const hasCapability = (capability) => capabilitiesDraft.includes(capability);
    const resetCustomScopeDraft = () => {
        setCustomScopeDraft(emptyCustomScopeDraft);
        setCustomScopeError("");
        setEditingCustomScopeId("");
        setCustomScopeInputs({
            allowedExecutables: "",
            allowedCwdRoots: "",
            allowedEnvKeys: "",
        });
        setCustomScopeInputErrors({
            allowedExecutables: "",
            allowedCwdRoots: "",
            allowedEnvKeys: "",
        });
    };

    const groupedCustomProcessScopes = useMemo(() => {
        return customProcessScopes.reduce((acc, scope) => {
            const riskGroup = classifyCustomScopeRisk(scope);
            if (!acc[riskGroup.label]) {
                acc[riskGroup.label] = {
                    meta: riskGroup,
                    scopes: [],
                };
            }
            acc[riskGroup.label].scopes.push(scope);
            return acc;
        }, {});
    }, [customProcessScopes]);

    const normalizedCustomScopeSlug = useMemo(
        () => normalizeCustomScopeSlugInput(customScopeDraft.scope),
        [customScopeDraft.scope]
    );
    const capabilityPreviewId = useMemo(
        () => `system.process.scope.${toCustomScopeIdFromSlug(customScopeDraft.scope) || "<scope-id>"}`,
        [customScopeDraft.scope]
    );

    const addCustomScopeToken = (field) => {
        const nextToken = String(customScopeInputs[field] || "").trim().replace(/,$/, "");
        if (!nextToken) {
            return;
        }
        const validationError = customScopeTokenValidation(field, nextToken);
        if (validationError) {
            setCustomScopeInputErrors((prev) => ({...prev, [field]: validationError}));
            return;
        }
        setCustomScopeDraft((prev) => ({
            ...prev,
            [field]: uniqueNormalizedTokens([...(prev[field] || []), nextToken]),
        }));
        setCustomScopeInputs((prev) => ({...prev, [field]: ""}));
        setCustomScopeInputErrors((prev) => ({...prev, [field]: ""}));
    };

    const removeCustomScopeToken = (field, token) => {
        setCustomScopeDraft((prev) => ({
            ...prev,
            [field]: (prev[field] || []).filter((value) => value !== token),
        }));
    };

    const scopeCapabilities = useMemo(() => buildScopeCapabilities(scopePolicies), [scopePolicies]);
    const clipboardCapabilityChildren = useMemo(() => ([
        {
            id: "clipboard-read",
            title: "Read Clipboard",
            kind: "capability",
            category: "Clipboard",
            description: "Host-mediated clipboard read capability. Sensitive: read access can expose copied secrets.",
            fallback: false,
            userDefined: false,
            capability: "system.clipboard.read",
            baseCapability: "system.hosts.write",
            allowedRoots: [],
            allowedCwdRoots: [],
            allowedOperationTypes: [],
            allowedExecutables: [],
            allowedEnvKeys: [],
            timeoutCeilingMs: null,
            requireConfirmation: null,
        },
        {
            id: "clipboard-write",
            title: "Write Clipboard",
            kind: "capability",
            category: "Clipboard",
            description: "Host-mediated clipboard write capability. Keep separate from read for least-privilege grants.",
            fallback: false,
            userDefined: false,
            capability: "system.clipboard.write",
            baseCapability: "system.hosts.write",
            allowedRoots: [],
            allowedCwdRoots: [],
            allowedOperationTypes: [],
            allowedExecutables: [],
            allowedEnvKeys: [],
            timeoutCeilingMs: null,
            requireConfirmation: null,
        },
    ]), []);
    const scopeCapabilitiesByBase = useMemo(() => {
        return BASE_PRIVILEGED_CAPABILITIES.reduce((groups, baseCapability) => {
            groups[baseCapability] = scopeCapabilities.filter((item) => item.baseCapability === baseCapability);
            return groups;
        }, {});
    }, [scopeCapabilities]);
    const capabilityChildrenByBase = useMemo(() => {
        return BASE_PRIVILEGED_CAPABILITIES.reduce((groups, baseCapability) => {
            const scopeChildren = scopeCapabilitiesByBase[baseCapability] || [];
            const extraChildren = baseCapability === "system.hosts.write" ? clipboardCapabilityChildren : [];
            groups[baseCapability] = [...scopeChildren, ...extraChildren];
            return groups;
        }, {});
    }, [BASE_PRIVILEGED_CAPABILITIES, scopeCapabilitiesByBase, clipboardCapabilityChildren]);
    const setCapability = (capability, checked) => {
        const childItem = Object.values(capabilityChildrenByBase).flat().find((item) => item.capability === capability);
        setCapabilitiesDraft((prev) => {
            let next = applyCapabilityToggle(prev, {
                capability,
                checked,
                baseCapability: childItem?.baseCapability || capability,
            });
            if (!checked && BASE_PRIVILEGED_CAPABILITIES.includes(capability)) {
                const childCapabilities = (capabilityChildrenByBase[capability] || []).map((item) => item.capability);
                next = next.filter((item) => !childCapabilities.includes(item));
            }
            return next;
        });
    };
    const baseCapabilityEnabled = useMemo(() => {
        return BASE_PRIVILEGED_CAPABILITIES.reduce((acc, capability) => {
            acc[capability] = hasCapability(capability);
            return acc;
        }, {});
    }, [capabilitiesDraft]);
    const selectedScopeCapabilitiesByBase = useMemo(() => {
        return BASE_PRIVILEGED_CAPABILITIES.reduce((groups, baseCapability) => {
            groups[baseCapability] = getSelectedScopeCapabilities(
                capabilitiesDraft,
                capabilityChildrenByBase[baseCapability] || [],
            );
            return groups;
        }, {});
    }, [capabilitiesDraft, capabilityChildrenByBase]);
    const highlightedSet = useMemo(
        () => new Set(Array.isArray(highlightedCapabilityIds) ? highlightedCapabilityIds : []),
        [highlightedCapabilityIds]
    );
    const hasUnsavedCapabilityChanges = useMemo(
        () => hasCapabilitySelectionChanges(plugin?.capabilities, capabilitiesDraft),
        [plugin?.capabilities, capabilitiesDraft]
    );
    const trustTier = useMemo(
        () => getPluginTrustTier(capabilitiesDraft),
        [capabilitiesDraft]
    );
    const capabilityIntent = runtimeStatus?.capabilityIntent || null;
    const capabilityIntentSummary = useMemo(
        () => buildCapabilityDeclarationSummary(capabilityIntent || {}),
        [capabilityIntent]
    );
    const selectedScopeCount = useMemo(
        () => getSelectedScopeCapabilities(capabilitiesDraft, Object.values(capabilityChildrenByBase).flat()).length,
        [capabilitiesDraft, capabilityChildrenByBase]
    );
    const availableChildCapabilityCount = useMemo(
        () => Object.values(capabilityChildrenByBase).flat().length,
        [capabilityChildrenByBase]
    );
    const normalizedCapabilityFilter = useMemo(
        () => String(capabilityFilter || "").trim().toLowerCase(),
        [capabilityFilter]
    );
    const filteredScopeCapabilitiesByBase = useMemo(() => {
        return BASE_PRIVILEGED_CAPABILITIES.reduce((groups, baseCapability) => {
            const scopes = capabilityChildrenByBase[baseCapability] || [];
            if (!normalizedCapabilityFilter) {
                groups[baseCapability] = scopes;
                return groups;
            }
            groups[baseCapability] = scopes.filter((scopeItem) => {
                const presentation = getCapabilityPresentation(scopeItem.capability, scopePolicies);
                const haystack = [
                    scopeItem.id,
                    scopeItem.category,
                    scopeItem.description,
                    scopeItem.capability,
                    presentation?.title,
                    presentation?.description,
                    ...(scopeItem.allowedExecutables || []),
                ].join(" ").toLowerCase();
                return haystack.includes(normalizedCapabilityFilter);
            });
            return groups;
        }, {});
    }, [BASE_PRIVILEGED_CAPABILITIES, normalizedCapabilityFilter, capabilityChildrenByBase, scopePolicies]);

    useEffect(() => {
        if (normalizedCapabilityFilter) {
            if (!capabilityFilterExpandedRef.current) {
                capabilityPanelBeforeFilterRef.current = showCapabilitiesPanel;
                capabilityFilterExpandedRef.current = true;
            }
            if (!showCapabilitiesPanel) {
                setShowCapabilitiesPanel(true);
            }
            return;
        }

        if (capabilityFilterExpandedRef.current) {
            capabilityFilterExpandedRef.current = false;
            setShowCapabilitiesPanel(capabilityPanelBeforeFilterRef.current);
        }
    }, [normalizedCapabilityFilter, showCapabilitiesPanel]);

    const saveCapabilities = async () => {
        setIsSavingCapabilities(true);
        try {
            const nextCapabilities = [...new Set(capabilitiesDraft)];
            const wasActive = activePlugins?.some((item) => item.id === plugin.id);
            const wasSelected = selectedTabId === plugin.id;
            const result = await window.electron.plugin.setCapabilities(plugin.id, nextCapabilities);
            if (!result?.success) {
                (await AppToaster).show({
                    message: `Failed to save capabilities: ${result?.error || "unknown error"}`,
                    intent: "danger",
                });
                return;
            }
            (await AppToaster).show({
                message: `Capabilities updated for ${plugin.id}.`,
                intent: "success",
            });
            await refreshPluginsState?.();
            await refreshRuntimeStatuses?.([plugin.id]);
            if (wasActive) {
                window.setTimeout(() => {
                    selectPlugin(plugin, {open: wasSelected});
                }, 0);
            }
        } finally {
            setIsSavingCapabilities(false);
        }
    };

    const handleSaveCustomScope = async () => {
        if (typeof window?.electron?.plugin?.upsertPluginCustomProcessScope !== "function") {
            return;
        }
        setCustomScopeSaving(true);
        setCustomScopeError("");
        try {
            const normalizedScopeId = toCustomScopeIdFromSlug(customScopeDraft.scope);
            if (!normalizedScopeId) {
                setCustomScopeError("Scope ID is required. Use any scope ID such as internal-runner.");
                return;
            }
            const pendingField = CUSTOM_SCOPE_TOKEN_FIELDS.find((field) => String(customScopeInputs[field] || "").trim());
            if (pendingField) {
                addCustomScopeToken(pendingField);
                setCustomScopeSaving(false);
                return;
            }
            const payload = {
                scope: normalizedScopeId,
                title: customScopeDraft.title,
                description: customScopeDraft.description,
                allowedExecutables: uniqueNormalizedTokens(customScopeDraft.allowedExecutables),
                allowedCwdRoots: uniqueNormalizedTokens(customScopeDraft.allowedCwdRoots),
                allowedEnvKeys: uniqueNormalizedTokens(customScopeDraft.allowedEnvKeys),
                timeoutCeilingMs: Number(customScopeDraft.timeoutCeilingMs || 0),
                requireConfirmation: customScopeDraft.requireConfirmation !== false,
            };
            const result = await window.electron.plugin.upsertPluginCustomProcessScope(plugin?.id, payload);
            if (!result?.success) {
                setCustomScopeError(result?.error || "Could not save custom scope.");
                return;
            }
            (await AppToaster).show({
                message: `Scope saved for ${plugin.id}. Grant required capabilities manually in Capabilities.`,
                intent: "success",
            });
            await refreshRuntimeStatuses?.([plugin.id]);
            setCustomProcessScopes(Array.isArray(result?.scopes) ? result.scopes : []);
            await reloadScopePolicies?.();
            resetCustomScopeDraft();
            setShowCustomScopeEditor(false);
        } finally {
            setCustomScopeSaving(false);
        }
    };

    const handleEditCustomScope = (scope) => {
        setEditingCustomScopeId(scope?.scope || "");
        setCustomScopeDraft({
            scope: String(scope?.scope || ""),
            title: scope?.title || "",
            description: scope?.description || "",
            allowedExecutables: Array.isArray(scope?.allowedExecutables) ? scope.allowedExecutables : [],
            allowedCwdRoots: Array.isArray(scope?.allowedCwdRoots) ? scope.allowedCwdRoots : [],
            allowedEnvKeys: Array.isArray(scope?.allowedEnvKeys) ? scope.allowedEnvKeys : [],
            timeoutCeilingMs: scope?.timeoutCeilingMs ? String(scope.timeoutCeilingMs) : "30000",
            requireConfirmation: scope?.requireConfirmation !== false,
        });
        setCustomScopeError("");
        setCustomScopeInputs({
            allowedExecutables: "",
            allowedCwdRoots: "",
            allowedEnvKeys: "",
        });
        setCustomScopeInputErrors({
            allowedExecutables: "",
            allowedCwdRoots: "",
            allowedEnvKeys: "",
        });
        setShowCustomScopeEditor(true);
    };

    const handleCloneCustomScope = (scope) => {
        setEditingCustomScopeId("");
        const clonedScopeSlug = normalizeCustomScopeSlugInput(String(scope?.scope || ""));
        setCustomScopeDraft({
            scope: `${clonedScopeSlug || "scope"}-copy`,
            title: scope?.title ? `${scope.title} Copy` : "Copied Scope",
            description: scope?.description || "",
            allowedExecutables: Array.isArray(scope?.allowedExecutables) ? scope.allowedExecutables : [],
            allowedCwdRoots: Array.isArray(scope?.allowedCwdRoots) ? scope.allowedCwdRoots : [],
            allowedEnvKeys: Array.isArray(scope?.allowedEnvKeys) ? scope.allowedEnvKeys : [],
            timeoutCeilingMs: scope?.timeoutCeilingMs ? String(scope.timeoutCeilingMs) : "30000",
            requireConfirmation: scope?.requireConfirmation !== false,
        });
        setCustomScopeError("");
        setCustomScopeInputs({
            allowedExecutables: "",
            allowedCwdRoots: "",
            allowedEnvKeys: "",
        });
        setCustomScopeInputErrors({
            allowedExecutables: "",
            allowedCwdRoots: "",
            allowedEnvKeys: "",
        });
        setShowCustomScopeEditor(true);
    };

    const handleDeleteCustomScope = async (scopeId) => {
        if (typeof window?.electron?.plugin?.deletePluginCustomProcessScope !== "function") {
            return;
        }
        const normalizedScopeId = toCustomScopeIdFromSlug(String(scopeId || "")) || String(scopeId || "").trim();
        const scopeCapabilityToRemove = normalizedScopeId ? `system.process.scope.${normalizedScopeId}` : "";
        const result = await window.electron.plugin.deletePluginCustomProcessScope(plugin?.id, scopeId);
        if (!result?.success) {
            setCustomScopeError(result?.error || "Could not delete custom scope.");
            (await AppToaster).show({
                message: `Could not delete scope: ${result?.error || "unknown error"}`,
                intent: "danger",
            });
            return;
        }
        if (scopeCapabilityToRemove && typeof window?.electron?.plugin?.setCapabilities === "function") {
            const nextCapabilities = [...new Set((Array.isArray(capabilitiesDraft) ? capabilitiesDraft : [])
                .filter((capability) => capability !== scopeCapabilityToRemove))];
            const hasChanges = JSON.stringify([...new Set(capabilitiesDraft)].sort()) !== JSON.stringify([...nextCapabilities].sort());
            if (hasChanges) {
                const capabilitiesResult = await window.electron.plugin.setCapabilities(plugin?.id, nextCapabilities);
                if (capabilitiesResult?.success) {
                    setCapabilitiesDraft(Array.isArray(capabilitiesResult?.capabilities)
                        ? capabilitiesResult.capabilities
                        : nextCapabilities);
                    await refreshPluginsState?.();
                    await refreshRuntimeStatuses?.([plugin.id]);
                    const wasActive = activePlugins?.some((item) => item.id === plugin.id);
                    const wasSelected = selectedTabId === plugin.id;
                    if (wasActive) {
                        window.setTimeout(() => {
                            selectPlugin(plugin, {open: wasSelected});
                        }, 0);
                    }
                }
            }
        }
        await refreshRuntimeStatuses?.([plugin.id]);
        setCustomProcessScopes(Array.isArray(result?.scopes) ? result.scopes : []);
        await reloadScopePolicies?.();
        if (toCustomScopeIdFromSlug(customScopeDraft.scope) === normalizedScopeId || customScopeDraft.scope === scopeId) {
            resetCustomScopeDraft();
            setShowCustomScopeEditor(false);
        }
        (await AppToaster).show({
            message: `Scope deleted for ${plugin?.id || "plugin"}.`,
            intent: "success",
        });
    };

    const METRIC_COLORS = {
        "CPU Percent": "#FF5733", // Red-Orange
        "CPU Cumulative": "#C70039", // Deep Red
        "Idle WakeUPs": "#900C3F", // Dark Red
        "Memory Working Set": "#3498db", // Blue
        "Memory Peak": "#2ecc71", // Green
        "Memory Private": "#f1c40f", // Yellow
        "Other": "#8e44ad", // Purple (for unknown metrics)
    };

    const updateTimeRange = (preset) => {
        let newStart;
        let newEnd = new Date();

        switch (preset) {
            case "Last 5 mins":
                newStart = addMinutes(new Date(), -5);
                break;
            case "Last 15 mins":
                newStart = addMinutes(new Date(), -15);
                break;
            case "Last 30 mins":
                newStart = addMinutes(new Date(), -30);
                break;
            case "Last hour":
                newStart = addHours(new Date(), -1);
                break;
            case "Last 2 hours":
                newStart = addHours(new Date(), -2);
                break;
            case "Start of Day":
                newStart = startOfDay(new Date());
                break;
            default:
                return;
        }

        setTimeRange([newStart, newEnd]);
        setLocalTimeRange([format(newStart, "HH:mm"), format(newEnd, "HH:mm")]); // Update local display
    };

    const handlePresetChange = (e) => {
        setSelectedPreset(e.target.value);
        setIsStatic(false); // Allow live updates
        updateTimeRange(e.target.value);
    };

    // Debounced function for setting time after user stops typing
    const debouncedSetTimeRange = useCallback(
        debounce((index, value) => {
            setIsStatic(true);
            const parsedTime = parse(value, "HH:mm", new Date());
            const [start, end] = timeRange;

            if (index === 0) {
                setTimeRange([parsedTime, end]);
            } else {
                setTimeRange([start, parsedTime]);
            }
            setMetrics([])
            fetchMetrics();
        }, 500), // 500ms debounce
        [timeRange]
    );

    const handleManualChange = (index, value) => {
        setLocalTimeRange((prev) => {
            const newTimes = [...prev];
            newTimes[index] = value;
            return newTimes;
        });

        debouncedSetTimeRange(index, value);
    };

    const fetchMetrics = () => {
        setRefreshCountdownLoading(true)
        const fromTime = timeRangeRef.current[0].getTime();
        const toTime = timeRangeRef.current[1].getTime();
        window.electron.system.getPluginMetric(plugin.id, fromTime, toTime).then((data) => {
            if (data.length === 0) return;
            if (!creationTime && data[0]?.metric?.creationTime) {
                setCreationTime(data[0].metric.creationTime);
            }

            // Convert bytes to MB and create a normalized dataset
            const processedData = data.map(({date, metric}) => {
                let convertedMetrics = {date};

                if (metric.cpu) {
                    convertedMetrics["CPU Percent"] = metric.cpu.percentCPUUsage || 0;
                    convertedMetrics["CPU Cumulative"] = metric.cpu.cumulativeCPUUsage || 0;
                    convertedMetrics["Idle WakeUPs"] = Math.min(metric.cpu.idleWakeupsPerSecond, 10000) || 0;
                }

                if (metric.memory) {
                    convertedMetrics["Memory Working Set"] = (metric.memory.workingSetSize || 0) / (1024 * 1024); // Convert to MB
                    convertedMetrics["Memory Peak"] = (metric.memory.peakWorkingSetSize || 0) / (1024 * 1024); // Convert to MB
                    convertedMetrics["Memory Private"] = (metric.memory.privateBytes || 0) / (1024 * 1024); // Convert to MB
                }

                return convertedMetrics;
            });

            setMetrics((prevMetrics) => {
                const existingEntries = new Map(prevMetrics.map((m) => [m.date, JSON.stringify(m)])); // Hash existing metrics

                const uniqueData = processedData.filter((entry) => {
                    const entryHash = JSON.stringify(entry);
                    return !existingEntries.has(entry.date) || existingEntries.get(entry.date) !== entryHash;
                });

                if (uniqueData.length === 0) {
                    return prevMetrics;
                }

                const durationMs = timeRangeRef.current[1].getTime() - timeRangeRef.current[0].getTime();
                const interval = metricDensityReductionInterval(durationMs)

                // ✅ Merge old & new data, filter outdated data, reduce density, and sort
                const newStartTime = timeRangeRef.current[0].getTime();
                return [...prevMetrics, ...uniqueData]
                    .filter((m) => new Date(m.date).getTime() >= newStartTime) // Remove outdated data
                    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
                    .filter((_, index) => index % Math.floor(interval / 1000) === 0);
            });

            const metricKeys = Object.keys(processedData[0]).filter((key) => key !== "date");

            // Preserve existing selected metrics, add new ones if found
            setAvailableMetrics((prevMetrics) => {
                const newMetrics = metricKeys.filter((key) => !prevMetrics.includes(key));
                return [...prevMetrics, ...newMetrics];
            });

            setSelectedLines((prevSelected) => {
                let updatedSelection = {...prevSelected};
                metricKeys.forEach((key) => {
                    if (!(key in prevSelected)) {
                        updatedSelection[key] = true; // Default new metrics to "selected"
                    }
                });
                return updatedSelection;
            });
        })
        setRefreshCountdown(5);
        setRefreshCountdownLoading(false)
    };

    const handleRemovePlugin = () => {
        setIsLoadingClean(true)
        deselectPlugin(plugin)
        localStorage.removeItem("sandbox_" + plugin.id)
        removePlugin(plugin.id)
        window.electron.plugin.remove(plugin.id).then((result) => {
            if (!result.success) {
                (AppToaster).show({
                    message: `Error: Failed to remove plugin: ${result.error}`,
                    intent: "danger"
                });
                setIsOpenRemove(false)
                setSortedPlugins(prevSorted => {
                    const newSorted = prevSorted.filter(p => p.id !== plugin.id);

                    // If the currently selected tab is removed, switch to the first available one
                    if (selectedTabId === plugin.id) {
                        setSelectedTabId(newSorted.length > 0 ? newSorted[0].id : null);
                    }

                    return newSorted;
                });
            }
        })
        setIsLoadingClean(false)
    }

    useEffect(() => {
        if (!isStatic) {
            const interval = setInterval(() => {
                updateTimeRange(selectedPreset);
            }, 1000); // Update every second

            return () => clearInterval(interval);
        }
    }, [isStatic, selectedPreset]);

    const timeRangeRef = useRef(timeRange);
    useEffect(() => {
        timeRangeRef.current = timeRange;
    }, [timeRange]);

    useEffect(() => {
        if (!plugin) return;
        fetchMetrics();
        const interval = setInterval(fetchMetrics, 5000);

        window.electron.plugin.verifySignature(plugin.id).then((r) => {
            setPluginVerification(r)
        })

        return () => {
            setMetrics([])
            clearInterval(interval)
        };
    }, [plugin]);

    useEffect(() => {
        const countdownTimer = setInterval(() => {
            setRefreshCountdown((prev) => (prev > 1 ? prev - 1 : 5));
        }, 1000);

        return () => clearInterval(countdownTimer);
    }, []);

    // Toggle line visibility dynamically
    const handleToggle = (metric) => {
        setSelectedLines((prev) => ({...prev, [metric]: !prev[metric]}));
    };

    const memoizedMetrics = useMemo(() => metrics, [metrics]);
    const chartTickFormatter = useMemo(() => (
        (tick) => new Date(tick).toLocaleTimeString("en-GB", {hour: "2-digit", minute: "2-digit"})
    ), []);
    const chartTooltipLabelFormatter = useMemo(() => (
        (label) => new Date(label).toLocaleString("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
        })
    ), []);
    const renderedMetricLines = useMemo(() => (
        Object.entries(selectedLines).map(([metricKey, isVisible]) =>
            isVisible && (
                <Line
                    key={metricKey}
                    yAxisId={metricKey.includes("CPU") || metricKey.includes("Idle") ? "right" : "left"}
                    type="monotone"
                    dataKey={metricKey}
                    stroke={METRIC_COLORS[metricKey] || METRIC_COLORS["Other"]}
                    strokeWidth={2}
                    name={metricKey}
                    isAnimationActive={false}
                    animationDuration={0}
                />
            )
        )
    ), [selectedLines]);

    return (
        <Card className={styles["card-panel"]}>
            <div className={styles["card-setting-header"]}>
                <span className={"bp6-heading"}
                      style={{fontSize: "1rem", margin: "0"}}>{plugin.name} {pluginVerification?.success ? (
                    <Tag intent="success" icon="shield" style={{verticalAlign: "bottom"}}>Certified</Tag>
                ) : (
                    <TooltipBP
                        content={pluginVerification?.error}
                        intent="warning"
                        placement="bottom"
                    >
                        <Tag intent="warning" icon="warning-sign" style={{verticalAlign: "bottom"}}>Uncertified</Tag>
                    </TooltipBP>
                )}</span>
                {(creationTime && activePlugins?.some((p) => p.id === plugin.id)) && (
                    <span className={"bp6-code"}
                          style={{marginLeft: "auto"}}>Started {formatDistanceToNow(creationTime, {addSuffix: true})}</span>
                )}
            </div>
            <span className={classNames("bp6-text-small", "bp6-text-muted")}>{plugin.description}</span>
            <Divider/>
            <div style={{display: "flex", alignItems: "center", justifyContent: "space-between"}}>
                <div style={{flex: "1", minWidth: "0", width: "0"}}>
                    <div>
                        Loaded from: <TooltipBP content={plugin.home}><i className={"bp6-heading"} style={{wordBreak: "break-all"}}>{plugin.home}</i></TooltipBP>
                    </div>
                    <Switch size="medium" style={{marginTop: "15px"}} labelElement={<strong
                        style={{color: activePlugins?.some((p) => p.id === plugin.id) ? "green" : "red"}}>Enabled</strong>}
                            innerLabelChecked="yes :)" innerLabel="no :("
                            checked={activePlugins?.some((p) => p.id === plugin.id)}
                            onChange={() => {
                                if (activePlugins?.some((p) => p.id === plugin.id)) {
                                    deselectPlugin(plugin)
                                } else {
                                    selectPlugin(plugin, {open: true})
                                }
                            }}
                    />
                </div>
                <Button
                    icon="archive"
                    text={"Export"}
                    intent="success"
                    loading={exportProgress}
                    style={{marginLeft: "auto", alignSelf: "center"}}
                    onClick={async () => {
                        setExportProgress(true)
                        const data = await window.electron.plugin.export(plugin.id)
                        console.log(data)
                        if (data) {
                            const blob = new Blob([data], {type: 'application/zip'});
                            const url = window.URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = `${plugin.name}.zip`;
                            document.body.appendChild(a);
                            a.click();
                            window.URL.revokeObjectURL(url);
                            document.body.removeChild(a);
                        }
                        setExportProgress(false)
                    }}
                />
            </div>
            <Divider/>
            <div style={{display: "flex", alignItems: "center", justifyContent: "space-between"}}>
                <div style={{flex: "1", minWidth: "0", width: "0"}}>
                    <span>Status: </span> {pluginVerification?.success ? (
                    <Icon icon={"endorsed"} intent={"success"}/>
                ) : (
                    <Icon icon={"cross-circle"} intent="warning"/>
                )}
                    {pluginVerification?.success && (
                        <>
                            <div><span>Signed by <i
                                className={"bp6-running-text"}>{pluginVerification.commonName?.value}</i></span></div>
                            <div className={"bp6-text-overflow-ellipsis"}><span>CA is <i
                                className={"bp6-running-text"}>{pluginVerification.signer?.label || "Unknown signer"}</i></span>
                            </div>
                            {pluginVerification.signer ? (
                                <CertificateValidComponent cert={pluginVerification.signer}/>
                            ) : null}
                        </>
                    )}
                </div>
                <Button
                    icon="annotation"
                    text={"ReSign"}
                    intent="primary"
                    loading={resignProgress}
                    onClick={async () => {
                        setResignProgress(true)
                        const rootCerts = await window.electron.settings.certificates.getRoot()
                        setRootCertificates(rootCerts)
                        if (rootCerts.length === 0) {
                            (AppToaster).show({
                                message: `No root certificate found. Please add one.`,
                                intent: "danger"
                            });
                            return
                        }

                        let selectedLabel = rootCerts[0].label;
                        if (rootCerts.length > 1) {
                            selectedLabel = await selectRootCert(setShowRootCertificateDialog, rememberedRootCertificate, rememberChoiceRef, setRememberedRootCertificate, setOnRootCertificateSelected);
                        }


                        if (!selectedLabel) {
                            setResignProgress(false)
                            return
                        }

                        window.electron.plugin.sign(plugin.id, selectedLabel).then(async (response) => {
                            if (!response.success) {
                                (AppToaster).show({
                                    message: `Failed to resign plugin: ${response.error}`,
                                    intent: "danger"
                                });
                            } else {
                                window.electron.plugin.verifySignature(plugin.id).then((r) => {
                                    setPluginVerification(r)
                                })
                            }
                        })
                        setResignProgress(false)
                    }}
                    style={{marginLeft: "auto", alignSelf: "center"}}
                />
            </div>
            <Divider/>
            <ControlGroup vertical={false}>
                <Switch size="medium" style={{marginTop: "15px"}} labelElement={<strong
                    style={{color: localStorage.getItem("sandbox_" + plugin.id) ? "red" : "green"}}>{localStorage.getItem("sandbox_" + plugin.id) ? "Sandboxed" : "No sandbox"}</strong>}
                        innerLabelChecked="yes :(" innerLabel="no :)"
                        checked={!!localStorage.getItem("sandbox_" + plugin.id)}
                        disabled={true}
                />
                {localStorage.getItem("sandbox_" + plugin.id) ? (
                    <>
                        <Button text={"Clean"} style={{marginLeft: "10px"}} intent={"warning"} endIcon={"clean"}
                                onClick={() => setIsOpenClean(true)}
                        />
                        <Button text={"Open"} style={{marginLeft: "10px"}} intent={"primary"} endIcon={"share"}
                                onClick={() => window.electron.system.openEditorWindow({name: plugin.id})}/>
                    </>
                ) : (
                    <Button text={"Open in"} style={{marginLeft: "10px"}} intent={"primary"} endIcon={"share"}
                            loading={openEditorProgress}
                            onClick={async () => {
                                setOpenEditorProgress(true)
                                const selectedEditor = await selectCodeEditor(setShowCodeEditorDialog, rememberedEditor, rememberEditorRef, setRememberedEditor, setOnCodeEditorSelected)
                                if (!selectedEditor) {
                                    setOpenEditorProgress(false)
                                    return
                                }
                                const result = await window.electron.system.openPluginInEditor(selectedEditor, plugin.id)
                                if (!result.success) {
                                    (AppToaster).show({
                                        message: `Failed to open plugin in editor: ${result.error}`,
                                        intent: "danger"
                                    });
                                }
                                setOpenEditorProgress(false)
                            }}/>
                )}
            </ControlGroup>
            <Divider/>
            <Card style={{marginTop: "15px", marginBottom: "15px", border: "1px solid #d4d5d7"}}>
                <div style={{display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap"}}>
                    <div>
                        <div className={"bp6-heading"} style={{fontSize: "0.95rem"}}>Declared Capability Intent</div>
                        <div className={classNames("bp6-text-small", "bp6-text-muted")}>
                            `declareCapabilities()` is an early intent manifest for preflight and diagnostics. Grants still decide what this plugin can actually execute.
                        </div>
                    </div>
                    <Tag minimal intent={capabilityIntentSummary.intent === "none" ? "primary" : capabilityIntentSummary.intent}>
                        {capabilityIntentSummary.title}
                    </Tag>
                </div>
                <div style={{display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", marginTop: "8px"}}>
                    <div className={classNames("bp6-text-small", "bp6-text-muted")} style={{flex: "1 1 auto"}}>
                        {capabilityIntentSummary.summary}
                    </div>
                    <Button
                        minimal
                        small
                        icon={showCapabilityIntent ? "chevron-up" : "chevron-down"}
                        onClick={() => setShowCapabilityIntent((prev) => !prev)}
                    >
                        {showCapabilityIntent ? "Hide details" : "Show details"}
                    </Button>
                </div>
                {showCapabilityIntent && capabilityIntent ? (
                    <>
                        <div style={{display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "10px", marginBottom: "8px"}}>
                            <Tag minimal>Declared: {capabilityIntent.declared.length}</Tag>
                            <Tag minimal intent={capabilityIntent.missingDeclared.length > 0 ? "warning" : "success"}>
                                Missing declared: {capabilityIntent.missingDeclared.length}
                            </Tag>
                            <Tag minimal intent={capabilityIntent.undeclaredGranted.length > 0 ? "primary" : "success"}>
                                Granted but undeclared: {capabilityIntent.undeclaredGranted.length}
                            </Tag>
                        </div>
                        {[
                            ["Declared by plugin", capabilityIntent.declared, "primary"],
                            ["Missing for full feature set", capabilityIntent.missingDeclared, "warning"],
                            ["Granted by host but undeclared", capabilityIntent.undeclaredGranted, "none"],
                        ].map(([label, values, intent]) => (
                            <div key={label} style={{marginTop: "10px"}}>
                                <div className={"bp6-text-small"} style={{fontWeight: 600, marginBottom: "6px"}}>{label}</div>
                                {values.length > 0 ? (
                                    <div style={{display: "flex", gap: "6px", flexWrap: "wrap"}}>
                                        {values.map((capability) => {
                                            const presentation = getCapabilityPresentation(capability, scopePolicies);
                                            return (
                                                <Tag key={`${label}-${capability}`} minimal intent={intent}>
                                                    {presentation.title} <code>{capability}</code>
                                                </Tag>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <div className={classNames("bp6-text-small", "bp6-text-muted")}>None.</div>
                                )}
                            </div>
                        ))}
                    </>
                ) : showCapabilityIntent ? (
                    <div className={classNames("bp6-text-small", "bp6-text-muted")} style={{marginTop: "10px"}}>
                        No runtime capability declaration diagnostics are available yet for this plugin.
                    </div>
                ) : null}
            </Card>
            <Divider/>
            <Card style={{marginTop: "15px", marginBottom: "15px", border: "1px solid #d4d5d7"}}>
                <div style={{display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", flexWrap: "wrap"}}>
                    <div>
                        <div className={"bp6-heading"} style={{fontSize: "0.95rem"}}>Plugin-Specific Process Scopes</div>
                        <div className={classNames("bp6-text-small", "bp6-text-muted")}>
                            Host-managed custom scopes reserved for this plugin when no curated family, shared scope, or built-in fallback scope fits.
                        </div>
                    </div>
                    <Button
                        small
                        icon="add"
                        onClick={() => {
                            resetCustomScopeDraft();
                            setShowCustomScopeEditor(true);
                        }}
                    >
                        Add Plugin Scope
                    </Button>
                </div>
                <div className={classNames("bp6-text-small", "bp6-text-muted")} style={{marginTop: "8px"}}>
                    These scopes are owned by this plugin. Other plugins do not see them in their capability settings and cannot use them at runtime.
                </div>
                {customProcessScopes.length > 0 ? (
                    <div style={{display: "flex", flexDirection: "column", gap: "8px", marginTop: "12px"}}>
                        {Object.values(groupedCustomProcessScopes).map(({meta, scopes}) => (
                            <Card key={meta.label} style={{border: "1px solid #eef0f2", background: "#fcfcfd"}}>
                                <div style={{display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", flexWrap: "wrap", marginBottom: "8px"}}>
                                    <div>
                                        <div className={"bp6-text-small"} style={{fontWeight: 600}}>{meta.label}</div>
                                        <div className={classNames("bp6-text-small", "bp6-text-muted")}>{meta.description}</div>
                                    </div>
                                    <Tag minimal intent={meta.intent}>{scopes.length} scope{scopes.length === 1 ? "" : "s"}</Tag>
                                </div>
                                <div style={{display: "flex", flexDirection: "column", gap: "8px"}}>
                                    {scopes.map((scope) => {
                                        return (
                                            <Card key={scope.scope} style={{border: "1px solid #eef0f2", background: "#fafbfc"}}>
                                                <div style={{display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", flexWrap: "wrap"}}>
                                                    <div>
                                                        <div className={"bp6-text-small"} style={{fontWeight: 600}}>
                                                            {scope.title || scope.scope}
                                                        </div>
                                                        <div className={classNames("bp6-text-small", "bp6-text-muted")}>
                                                            Capability: <code>{`system.process.scope.${scope.scope}`}</code>
                                                        </div>
                                                    </div>
                                                    <div style={{display: "flex", gap: "6px", alignItems: "center"}}>
                                                        <Button small minimal icon="duplicate" onClick={() => handleCloneCustomScope(scope)}>Clone</Button>
                                                        <Button small minimal icon="edit" onClick={() => handleEditCustomScope(scope)}>Edit</Button>
                                                        <Button small minimal intent="danger" icon="trash" onClick={() => handleDeleteCustomScope(scope.scope)}>Delete</Button>
                                                    </div>
                                                </div>
                                                <div className={classNames("bp6-text-small", "bp6-text-muted")} style={{marginTop: "6px"}}>
                                                    {scope.description}
                                                </div>
                                                <div style={{display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "8px"}}>
                                                    <Tag minimal>{(scope.allowedExecutables || []).length} command path{(scope.allowedExecutables || []).length === 1 ? "" : "s"}</Tag>
                                                    <Tag minimal>timeout max: {scope.timeoutCeilingMs || 30000}ms</Tag>
                                                    <Tag minimal>confirm: {scope.requireConfirmation ? "required" : "no"}</Tag>
                                                    <Tag minimal intent="primary">Plugin-owned scope</Tag>
                                                </div>
                                                {Array.isArray(scope.allowedExecutables) && scope.allowedExecutables.length > 0 ? (
                                                    <div className={classNames("bp6-text-small", "bp6-text-muted")} style={{marginTop: "8px"}}>
                                                        Allowed commands: {scope.allowedExecutables.slice(0, 3).join(", ")}
                                                        {scope.allowedExecutables.length > 3 ? ` +${scope.allowedExecutables.length - 3} more` : ""}
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
                    <div className={classNames("bp6-text-small", "bp6-text-muted")} style={{marginTop: "12px"}}>
                        No plugin-specific process scopes yet. Add one when this plugin needs a host-approved command family that should not be shared with other plugins.
                    </div>
                )}
            </Card>
            <Dialog
                isOpen={showCustomScopeEditor}
                onClose={() => {
                    setShowCustomScopeEditor(false);
                    resetCustomScopeDraft();
                }}
                title={editingCustomScopeId ? "Edit Plugin-Specific Scope" : "Create Plugin-Specific Scope"}
                canEscapeKeyClose={true}
                canOutsideClickClose={!customScopeSaving}
                style={{width: "680px", maxWidth: "calc(100vw - 80px)"}}
            >
                <div className="bp6-dialog-body">
                    <div style={{display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", marginBottom: "10px", flexWrap: "wrap"}}>
                        <div className={classNames("bp6-text-small", "bp6-text-muted")}>
                            Define the exact command paths and policy envelope the host should approve for this plugin-owned scope. Plugin code can reference it, but only the host user can change it.
                        </div>
                        <Tag minimal>{editingCustomScopeId ? "Existing scope" : "New scope"}</Tag>
                    </div>
                    <div style={{display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "12px"}}>
                        <Tag minimal>Broad grant: <code>system.process.exec</code></Tag>
                        <Tag minimal intent="primary">Narrow grant: <code>{capabilityPreviewId}</code></Tag>
                        <Tag minimal intent="warning">Visible only to this plugin</Tag>
                    </div>
                    <div style={{display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "10px"}}>
                        <FormGroup
                            label="Scope ID"
                            helperText="Use any scope ID (for example: internal-runner). Do not paste full capability IDs."
                        >
                            <InputGroup
                                placeholder="internal-runner"
                                value={customScopeDraft.scope}
                                onChange={(event) => {
                                    setCustomScopeDraft((prev) => ({
                                        ...prev,
                                        scope: normalizeCustomScopeSlugInput(event.target.value),
                                    }));
                                }}
                            />
                        </FormGroup>
                        <FormGroup label="Display name">
                            <InputGroup
                                placeholder="Process Monitoring"
                                value={customScopeDraft.title}
                                onChange={(event) => setCustomScopeDraft((prev) => ({...prev, title: event.target.value}))}
                            />
                        </FormGroup>
                    </div>
                    <FormGroup label="Description">
                        <InputGroup
                            placeholder="Explain when plugins should request this scope."
                            value={customScopeDraft.description}
                            onChange={(event) => setCustomScopeDraft((prev) => ({...prev, description: event.target.value}))}
                        />
                    </FormGroup>
                    <TokenListInput
                        label="Allowed executable paths"
                        placeholder="/usr/local/bin/htop"
                        helperText="Use absolute paths. Press Enter or comma to add."
                        tokens={customScopeDraft.allowedExecutables}
                        inputValue={customScopeInputs.allowedExecutables}
                        inputError={customScopeInputErrors.allowedExecutables}
                        onInputChange={(value) => {
                            setCustomScopeInputs((prev) => ({...prev, allowedExecutables: value}));
                            setCustomScopeInputErrors((prev) => ({...prev, allowedExecutables: ""}));
                        }}
                        onAddToken={() => addCustomScopeToken("allowedExecutables")}
                        onRemoveToken={(token) => removeCustomScopeToken("allowedExecutables", token)}
                    />
                    <TokenListInput
                        label="Allowed CWD roots"
                        placeholder="/Users/alex"
                        helperText="Leave empty to use the standard safe roots for this host."
                        tokens={customScopeDraft.allowedCwdRoots}
                        inputValue={customScopeInputs.allowedCwdRoots}
                        inputError={customScopeInputErrors.allowedCwdRoots}
                        onInputChange={(value) => {
                            setCustomScopeInputs((prev) => ({...prev, allowedCwdRoots: value}));
                            setCustomScopeInputErrors((prev) => ({...prev, allowedCwdRoots: ""}));
                        }}
                        onAddToken={() => addCustomScopeToken("allowedCwdRoots")}
                        onRemoveToken={(token) => removeCustomScopeToken("allowedCwdRoots", token)}
                    />
                    <TokenListInput
                        label="Allowed env keys"
                        placeholder="PATH"
                        helperText="Only list env keys this scope actually needs. Press Enter or comma to add."
                        tokens={customScopeDraft.allowedEnvKeys}
                        inputValue={customScopeInputs.allowedEnvKeys}
                        inputError={customScopeInputErrors.allowedEnvKeys}
                        onInputChange={(value) => {
                            setCustomScopeInputs((prev) => ({...prev, allowedEnvKeys: value}));
                            setCustomScopeInputErrors((prev) => ({...prev, allowedEnvKeys: ""}));
                        }}
                        onAddToken={() => addCustomScopeToken("allowedEnvKeys")}
                        onRemoveToken={(token) => removeCustomScopeToken("allowedEnvKeys", token)}
                    />
                    <div style={{display: "grid", gridTemplateColumns: "minmax(220px, 1fr)", gap: "10px", alignItems: "start"}}>
                        <FormGroup label="Timeout ceiling (ms)">
                            <InputGroup
                                type="number"
                                value={customScopeDraft.timeoutCeilingMs}
                                onChange={(event) => setCustomScopeDraft((prev) => ({...prev, timeoutCeilingMs: event.target.value}))}
                            />
                        </FormGroup>
                        <FormGroup
                            label="Approval policy"
                            helperText="Turn this on when operators should explicitly approve commands in this scope."
                        >
                            <Switch
                                checked={customScopeDraft.requireConfirmation}
                                label="Require confirmation before execution"
                                onChange={(event) => setCustomScopeDraft((prev) => ({...prev, requireConfirmation: event.target.checked}))}
                            />
                        </FormGroup>
                    </div>
                    {customScopeError ? (
                        <div className={classNames("bp6-text-small")} style={{color: "#c23030", marginTop: "8px"}}>
                            {customScopeError}
                        </div>
                    ) : null}
                </div>
                <div className="bp6-dialog-footer">
                    <div className={classNames("bp6-text-small", "bp6-text-muted")} style={{paddingBottom: "8px"}}>
                        Plugin request ID:{" "}
                        <code>{`system.process.scope.${toCustomScopeIdFromSlug(customScopeDraft.scope) || "<scope-id>"}`}</code>.
                        {" "}This is a host-managed plugin-specific scope reference. Using it in plugin code does not grant permission by itself, and other plugins cannot use it.
                    </div>
                    <div className="bp6-dialog-footer-actions">
                        <Button minimal onClick={() => {
                            setShowCustomScopeEditor(false);
                            resetCustomScopeDraft();
                        }}>Cancel</Button>
                        <Button intent="primary" loading={customScopeSaving} onClick={handleSaveCustomScope}>
                            {editingCustomScopeId ? "Save Changes" : "Save Scope"}
                        </Button>
                    </div>
                </div>
            </Dialog>
            <Dialog
                isOpen={Boolean(activePolicyDetails)}
                onClose={() => setActivePolicyDetails(null)}
                title={activePolicyDetails?.title || "Scope Policy Details"}
                canEscapeKeyClose={true}
                canOutsideClickClose={true}
                style={{width: "720px", maxWidth: "calc(100vw - 80px)"}}
            >
                <div className="bp6-dialog-body">
                    {activePolicyDetails ? (
                        <>
                            <div className={classNames("bp6-text-small", "bp6-text-muted")} style={{marginBottom: "10px"}}>
                                {activePolicyDetails.description}
                            </div>
                            <div style={{display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "12px"}}>
                                <Tag minimal>Technical ID: <code>{activePolicyDetails.capability}</code></Tag>
                                <Tag minimal>Depends on: <code>{activePolicyDetails.baseCapability}</code></Tag>
                                <Tag minimal>confirm: {activePolicyDetails.requireConfirmation ? "required" : "no"}</Tag>
                                {activePolicyDetails.timeoutCeilingMs ? (
                                    <Tag minimal>timeout max: {activePolicyDetails.timeoutCeilingMs}ms</Tag>
                                ) : null}
                                {activePolicyDetails.userDefined === true ? (
                                    <Tag minimal intent={activePolicyDetails.shared === true ? "success" : "primary"}>
                                        {activePolicyDetails.shared === true ? "Shared custom scope (cross-plugin)" : "Plugin-specific custom scope"}
                                    </Tag>
                                ) : null}
                            </div>
                            <Card style={{background: "#fafbfc", border: "1px solid #eef0f2", boxShadow: "none"}}>
                                <PolicyDetailList label="Roots" values={activePolicyDetails.allowedRoots} maxVisible={12}/>
                                <PolicyDetailList label="Operations" values={activePolicyDetails.allowedOperationTypes} maxVisible={12}/>
                                <PolicyDetailList label="Commands" values={activePolicyDetails.allowedExecutables} maxVisible={12}/>
                                <PolicyDetailList label="CWD roots" values={activePolicyDetails.allowedCwdRoots} maxVisible={12}/>
                                <PolicyDetailList label="Env keys" values={activePolicyDetails.allowedEnvKeys} maxVisible={12}/>
                            </Card>
                        </>
                    ) : null}
                </div>
                <div className="bp6-dialog-footer">
                    <div className="bp6-dialog-footer-actions">
                        <Button minimal onClick={() => setActivePolicyDetails(null)}>Close</Button>
                    </div>
                </div>
            </Dialog>
            <Card style={{marginTop: "15px", marginBottom: "15px", border: "1px solid #d4d5d7"}}>
                <div style={{display: "flex", alignItems: "center", justifyContent: "space-between"}}>
                    <div>
                        <div className={"bp6-heading"} style={{fontSize: "0.95rem"}}>Capabilities & Privileged Access</div>
                        <div className={classNames("bp6-text-small", "bp6-text-muted")}>
                            Default is deny-by-default. Grant only what this plugin needs.
                        </div>
                    </div>
                    <Button
                        intent="primary"
                        icon="floppy-disk"
                        loading={isSavingCapabilities}
                        disabled={!hasUnsavedCapabilityChanges}
                        onClick={saveCapabilities}
                    >
                        {hasUnsavedCapabilityChanges ? "Save Capabilities" : "Saved"}
                    </Button>
                </div>
                <div style={{display: "flex", gap: "10px", alignItems: "center", justifyContent: "space-between", marginTop: "12px", marginBottom: "8px", flexWrap: "wrap"}}>
                    <div style={{display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap", flex: "1 1 auto"}}>
                    <InputGroup
                        leftIcon="filter"
                        placeholder="Filter scopes, commands, capability IDs"
                        value={capabilityFilter}
                        onChange={(event) => setCapabilityFilter(event.target.value)}
                        fill={true}
                        style={{flex: "1 1 420px", minWidth: "360px", maxWidth: "560px"}}
                    />
                        <TooltipBP content={`${trustTier.title}. ${trustTier.description}`}>
                            <Tag minimal intent={trustTier.intent}>
                                Trust tier: {getShortTrustTierLabel(trustTier)}
                            </Tag>
                        </TooltipBP>
                    <Tag minimal>
                        Selected scopes: {selectedScopeCount}
                    </Tag>
                    <Tag minimal>
                        Available scopes: {availableChildCapabilityCount}
                    </Tag>
                    </div>
                    <Button
                        minimal
                        small
                        icon={showCapabilitiesPanel ? "chevron-up" : "chevron-down"}
                        onClick={() => setShowCapabilitiesPanel((prev) => !prev)}
                    >
                        {showCapabilitiesPanel ? "Collapse" : "Expand"}
                    </Button>
                </div>
                <div className={classNames("bp6-text-small", "bp6-text-muted")} style={{marginBottom: "8px"}}>
                    {trustTier.description}
                </div>
                {showCapabilitiesPanel ? (
                <>
                <Divider style={{marginTop: "10px", marginBottom: "10px"}}/>
                {BASE_PRIVILEGED_CAPABILITIES.map((baseCapability) => {
                    const groupedScopes = filteredScopeCapabilitiesByBase[baseCapability] || [];
                    const baseEnabled = !!baseCapabilityEnabled[baseCapability];
                    const allScopesForBase = capabilityChildrenByBase[baseCapability] || [];
                    const groupedScopesByCategory = groupedScopes.reduce((acc, scopeItem) => {
                        const category = scopeCategoryLabel(scopeItem);
                        if (!acc[category]) {
                            acc[category] = [];
                        }
                        acc[category].push(scopeItem);
                        return acc;
                    }, {});
                    const categoryEntries = Object.entries(groupedScopesByCategory)
                        .sort((left, right) => {
                            const weightDiff = scopeCategorySortWeight(left[0]) - scopeCategorySortWeight(right[0]);
                            if (weightDiff !== 0) return weightDiff;
                            return left[0].localeCompare(right[0]);
                        });

                    return (
                        <Card key={baseCapability} style={{marginBottom: "8px", border: "1px solid #eef0f2"}}>
                            {highlightedSet.has(baseCapability) ? (
                                <Tag intent="warning" minimal style={{marginBottom: "8px"}}>Required to resolve last permission error</Tag>
                            ) : null}
                            <Checkbox
                                checked={baseEnabled}
                                label={getCapabilityPresentation(baseCapability, scopePolicies).title}
                                onChange={(event) => setCapability(baseCapability, event.target.checked)}
                            />
                            <div className={classNames("bp6-text-small", "bp6-text-muted")}>
                                {getCapabilityPresentation(baseCapability, scopePolicies).description}
                            </div>
                            <div className={classNames("bp6-text-small", "bp6-text-muted")}>
                                Technical ID: <code>{baseCapability}</code>
                            </div>
                            {categoryEntries.length > 0 ? (
                                <div style={{marginTop: "10px"}}>
                                    {categoryEntries.map(([categoryLabel, categoryScopes]) => (
                                        <Card key={`${baseCapability}-${categoryLabel}`} style={{marginTop: "8px", border: "1px solid #eef0f2", background: "#fafbfc"}}>
                                            <div style={{display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", marginBottom: "8px"}}>
                                                <div className={"bp6-text-small"} style={{fontWeight: 600}}>{categoryLabel}</div>
                                                <Tag minimal>{categoryScopes.length} scope{categoryScopes.length === 1 ? "" : "s"}</Tag>
                                            </div>
                                            {categoryScopes
                                                .slice()
                                                .sort((left, right) => {
                                                    const leftTitle = getCapabilityPresentation(left.capability, scopePolicies).title;
                                                    const rightTitle = getCapabilityPresentation(right.capability, scopePolicies).title;
                                                    return leftTitle.localeCompare(rightTitle);
                                                })
                                                .map((scopeItem) => {
                                                const presentation = getCapabilityPresentation(scopeItem.capability, scopePolicies);
                                                const scopeSummary = buildScopeSummary(scopeItem);
                                                return (
                                                    <Card
                                                        key={scopeItem.capability}
                                                        style={{
                                                            marginTop: "8px",
                                                            marginBottom: "8px",
                                                            border: highlightedSet.has(scopeItem.capability) ? "1px solid #f6d667" : "1px solid #eef0f2",
                                                            background: highlightedSet.has(scopeItem.capability) ? "#fff8db" : "white",
                                                        }}
                                                    >
                                                        {highlightedSet.has(scopeItem.capability) ? (
                                                            <Tag intent="warning" minimal style={{marginBottom: "8px"}}>Required to resolve last permission error</Tag>
                                                        ) : null}
                                                        <Checkbox
                                                            checked={hasCapability(scopeItem.capability)}
                                                            disabled={!baseEnabled}
                                                            label={presentation.title}
                                                            onChange={(event) => setCapability(scopeItem.capability, event.target.checked)}
                                                        />
                                                        <div className={classNames("bp6-text-small", "bp6-text-muted")}>
                                                            {presentation.description}
                                                        </div>
                                                        <div style={{display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "8px", marginBottom: "6px"}}>
                                                            <Tag minimal>Technical ID: <code>{scopeItem.capability}</code></Tag>
                                                            {scopeItem.userDefined === true ? (
                                                                <Tag minimal intent={scopeItem.shared === true ? "success" : "primary"}>
                                                                    {scopeItem.shared === true ? "Shared custom scope (cross-plugin)" : "Plugin-specific custom scope"}
                                                                </Tag>
                                                            ) : null}
                                                            <Tag minimal>risk: {presentation.risk}</Tag>
                                                            {typeof scopeItem.requireConfirmation === "boolean" ? (
                                                                <Tag minimal>confirm: {scopeItem.requireConfirmation ? "required" : "no"}</Tag>
                                                            ) : null}
                                                            {scopeItem.timeoutCeilingMs ? <Tag minimal>timeout max: {scopeItem.timeoutCeilingMs}ms</Tag> : null}
                                                            {scopeItem.allowedExecutables.length > 0 ? <Tag minimal>{scopeItem.allowedExecutables.length} command path{scopeItem.allowedExecutables.length === 1 ? "" : "s"}</Tag> : null}
                                                        </div>
                                                        {scopeSummary ? (
                                                            <div className={classNames("bp6-text-small", "bp6-text-muted")} style={{marginTop: "4px"}}>
                                                                {scopeSummary}
                                                            </div>
                                                        ) : null}
                                                        {scopeItem.kind !== "capability" ? (
                                                            <div style={{marginTop: "10px"}}>
                                                                <Button
                                                                    minimal
                                                                    small
                                                                    icon="document-open"
                                                                    onClick={() => setActivePolicyDetails({
                                                                        capability: scopeItem.capability,
                                                                        title: presentation.title,
                                                                        description: presentation.description,
                                                                        baseCapability: scopeItem.baseCapability,
                                                                        allowedRoots: scopeItem.allowedRoots,
                                                                        allowedOperationTypes: scopeItem.allowedOperationTypes,
                                                                        allowedExecutables: scopeItem.allowedExecutables,
                                                                        allowedCwdRoots: scopeItem.allowedCwdRoots,
                                                                        allowedEnvKeys: scopeItem.allowedEnvKeys,
                                                                        timeoutCeilingMs: scopeItem.timeoutCeilingMs,
                                                                        requireConfirmation: scopeItem.requireConfirmation,
                                                                        shared: scopeItem.shared,
                                                                        userDefined: scopeItem.userDefined,
                                                                    })}
                                                                    style={{paddingLeft: 0}}
                                                                >
                                                                    View policy details
                                                                </Button>
                                                            </div>
                                                        ) : null}
                                                    </Card>
                                                );
                                            })}
                                        </Card>
                                    ))}
                                </div>
                            ) : normalizedCapabilityFilter ? (
                                <Card style={{border: "1px solid #eef0f2", background: "#fafbfc", marginTop: "8px"}}>
                                    <div className={classNames("bp6-text-small", "bp6-text-muted")}>
                                        No scopes matched the current filter for this capability family.
                                    </div>
                                </Card>
                            ) : null}
                            {!baseEnabled && (selectedScopeCapabilitiesByBase[baseCapability] || []).length > 0 ? (
                                <Card style={{border: "1px solid #f6d667", background: "#fff8db", marginTop: "8px"}}>
                                    <div className={classNames("bp6-text-small")} style={{marginBottom: "8px"}}>
                                        Child capabilities/scopes are present, but base privileged access is disabled.
                                    </div>
                                    <Button
                                        size="small"
                                        intent="warning"
                                        onClick={() => setCapability(baseCapability, true)}
                                    >
                                        Enable required base permission
                                    </Button>
                                </Card>
                            ) : null}
                            {baseEnabled && allScopesForBase.length > 0 && (selectedScopeCapabilitiesByBase[baseCapability] || []).length === 0 ? (
                                <Card style={{border: "1px solid #f6d667", background: "#fff8db", marginTop: "8px"}}>
                                    <div className={classNames("bp6-text-small")}>
                                        {baseCapability === "system.process.exec"
                                            ? "Base tool execution is enabled, but no process scopes are granted yet. Both are required for process execution requests."
                                            : "Base privileged host actions are enabled, but no filesystem/clipboard child grants are selected yet."}
                                    </div>
                                </Card>
                            ) : null}
                        </Card>
                    );
                })}
                </>
                ) : (
                    <div className={classNames("bp6-text-small", "bp6-text-muted")} style={{marginTop: "8px"}}>
                        Expand to review and edit privileged capabilities, process scopes, and policy details.
                    </div>
                )}
            </Card>
            <Divider/>
            <Card style={{marginBottom: "15px", marginTop: "15px", border: "1px solid darkblue"}}>
                <p style={{textAlign: "right"}} className={classNames("bp6-text-small", "bp6-text-muted")}>
                    Next refresh in {refreshCountdownLoading ? "..." : refreshCountdown} sec.
                </p>
                {/* Time Range Picker */}
                <FormGroup label="Time Range:">
                    <ControlGroup fill={true} vertical={false}>
                        <div style={{minWidth: "150px"}}>
                            <HTMLSelect value={selectedPreset} fill={true} onChange={handlePresetChange} options={[
                                "Last 5 mins", "Last 15 mins", "Last 30 mins", "Last hour", "Last 2 hours", "Start of Day"
                            ]}/>
                        </div>
                        <InputGroup fill={true} value={localTimeRange[0]}
                                    onChange={(e) => handleManualChange(0, e.target.value)}
                                    placeholder="Start date..."/>
                        <InputGroup fill={true} value={localTimeRange[1]}
                                    onChange={(e) => handleManualChange(1, e.target.value)} placeholder="End date..."/>
                    </ControlGroup>
                </FormGroup>

                {/* Metric Selection */}
                <FormGroup label="Metrics:">
                    <div style={{
                        maxHeight: "150px",
                        overflowY: "auto",
                        border: "1px solid #d4d5d7",
                        padding: "5px",
                        borderRadius: "4px"
                    }}>
                        {availableMetrics.map((metricKey) => (
                            <Checkbox
                                key={metricKey}
                                checked={selectedLines[metricKey]}
                                label={metricKey}
                                onChange={() => handleToggle(metricKey)}
                            />
                        ))}
                    </div>
                </FormGroup>
                <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={memoizedMetrics} margin={{top: 20, right: 30, left: 20, bottom: 10}}>
                        <CartesianGrid strokeDasharray="3 3"/>

                        {/* X-Axis (Default ID = 0) */}
                        <XAxis
                            dataKey="date"
                            tickFormatter={chartTickFormatter}
                            domain={["auto", "auto"]}
                            xAxisId="0"
                        />

                        {/* Left Y-Axis (Memory MB) */}
                        <YAxis yAxisId="left" domain={[0.01, "auto"]} unit=" MB"/>

                        {/* Right Y-Axis (CPU %, Idle Wakeups) */}
                        <YAxis yAxisId="right" orientation="right" domain={[0, "auto"]}/>

                        {/* Tooltip */}
                        <Tooltip labelFormatter={chartTooltipLabelFormatter}/>

                        {/* Legend */}
                        <Legend verticalAlign="top" layout="horizontal" align="center"
                                wrapperStyle={{paddingBottom: "15px"}}/>

                        {/* Render Lines with Static Colors */}
                        {renderedMetricLines}
                    </LineChart>
                </ResponsiveContainer>

            </Card>
            <Card style={{marginBottom: "15px", marginTop: "15px", border: "1px solid red"}}>
                <div><Button text={"Remove plugin"} intent={"danger"} loading={isLoadingClean}
                             onClick={() => setIsOpenRemove(true)}/></div>
            </Card>
            <Alert
                cancelButtonText="Cancel"
                canEscapeKeyCancel={true}
                canOutsideClickCancel={true}
                confirmButtonText="Clean"
                icon={"clean"}
                intent={"warning"}
                isOpen={isOpenClean}
                loading={isLoadingClean}
                onCancel={() => setIsOpenClean(false)}
                onConfirm={() => {
                    setIsLoadingClean(true)
                    localStorage.removeItem("sandbox_" + plugin.id)
                    setIsLoadingClean(false)
                    setIsOpenClean(false)
                }}
                className={styles["alert-clean"]}
            >
                <p style={{color: "white"}}>
                    All snapshots will be deleted. Make sure to save plugin first. Proceed?
                </p>
            </Alert>
            <Alert
                cancelButtonText="Cancel"
                canEscapeKeyCancel={true}
                canOutsideClickCancel={true}
                confirmButtonText="Remove"
                icon={"trash"}
                intent={"danger"}
                isOpen={isOpenRemove}
                loading={isLoadingClean}
                onCancel={() => setIsOpenRemove(false)}
                onConfirm={handleRemovePlugin}
                className={styles["alert-clean"]}
            >
                <p style={{color: "white"}}>
                    Plugin will be removed. Proceed?
                </p>
            </Alert>
            <RootCertificateSelectionComponent
                show={showRootCertificateDialog}
                setShow={setShowRootCertificateDialog}
                rootCertificates={rootCertificates}
                rememberRef={rememberChoiceRef}
                setRememberRootCert={setRememberedRootCertificate}
                onRootSelectedCert={onRootCertificateSelected}
                setOnRootSelectedCert={setOnRootCertificateSelected}
            />
            <CodeEditorSelectionComponent
                show={showCodeEditorDialog}
                setShow={setShowCodeEditorDialog}
                onEditorSelected={onCodeEditorSelected}
                setOnEditorSelected={setOnCodeEditorSelected}
                rememberRef={rememberEditorRef}
                setRememberEditor={setRememberedEditor}
            />
        </Card>
    )
}
SelectPluginPanel.propTypes = {
    plugin: PropTypes.object,
    plugins: PropTypes.array,
    activePlugins: PropTypes.array,
    selectPlugin: PropTypes.func,
    deselectPlugin: PropTypes.func,
    removePlugin: PropTypes.func,
    setSelectedTabId: PropTypes.func,
    selectedTabId: PropTypes.string,
    setSortedPlugins: PropTypes.func,
    scopePolicies: PropTypes.array,
    refreshPluginsState: PropTypes.func,
    reloadScopePolicies: PropTypes.func,
    highlightedCapabilityIds: PropTypes.array,
}
