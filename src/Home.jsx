import React, {lazy, Suspense, useCallback, useEffect, useRef, useState} from 'react'
import classNames from "classnames";
import {
    Alignment,
    Button,
    Card,
    Dialog,
    HotkeysTarget,
    Icon,
    InputGroup,
    Menu,
    MenuItem,
    Navbar,
    NavbarDivider,
    NavbarGroup,
    Popover,
    Tag,
} from "@blueprintjs/core";
import * as styles from './Home.module.scss'
import {NavigationPluginsButton} from "./components/NavigationPluginsButton.jsx";
import {AppToaster} from "./components/AppToaster.jsx";
import {PluginContainer} from "./components/PluginContainer.jsx";
import {SideBar} from "./components/SideBar.jsx";
import {CommandBar} from "./components/CommandBar.jsx";
import {generateActionId} from "./utils/generateActionId";
import {NotificationsPanel} from "./components/NotificationsPanel.jsx";
import {pluginTrace} from "./utils/pluginTrace";
import {classifyPluginError} from "./utils/pluginErrorClassification";
import {getCapabilityPresentation} from "./utils/capabilityPresentation";
import {parseMissingCapabilityDiagnosticsFromError} from "./utils/parseMissingCapabilitiesFromError";
import {classifyPrivilegedActionIssue, extractPrivilegedActionDiagnostics} from "./utils/privilegedActionIssuePresentation";
import {getPluginTrustTier} from "./utils/pluginTrustTier";
import {buildCapabilityDeclarationSummary} from "./utils/pluginCapabilityDeclaration";
import {resolveBlueprintIcon, sanitizeBlueprintIcon} from "./utils/blueprintIcons";

// Lazy load settings dialog (only needed when opened)
const SettingsDialog = lazy(() => import("./components/settings/SettingsDialog.jsx").then(m => ({default: m.SettingsDialog})));
const AiChatDialog = lazy(() => import("./components/ai-chat/AiChatDialog.jsx").then(m => ({default: m.AiChatDialog})));

function summarizeWorkflowContracts(events = []) {
    const workflowEvents = (Array.isArray(events) ? events : []).filter((event) => typeof event?.workflowId === "string" && event.workflowId.trim());
    const grouped = workflowEvents.reduce((acc, event) => {
        const workflowId = event.workflowId.trim();
        if (!acc.has(workflowId)) {
            acc.set(workflowId, []);
        }
        acc.get(workflowId).push(event);
        return acc;
    }, new Map());

    return [...grouped.entries()].map(([workflowId, workflowEntries]) => {
        const ordered = workflowEntries.slice().sort((left, right) => String(left?.timestamp || "").localeCompare(String(right?.timestamp || "")));
        const latest = ordered[ordered.length - 1] || {};
        const approvalEvent = ordered.find((entry) => typeof entry?.confirmationDecision === "string" && entry.confirmationDecision.trim());
        const stepEvents = ordered.filter((entry) => entry?.stepId || entry?.stepTitle);
        const stepMap = new Map();
        stepEvents.forEach((entry) => {
            const key = String(entry.stepId || entry.stepTitle || "").trim() || `step-${stepMap.size + 1}`;
            stepMap.set(key, entry);
        });
        const steps = [...stepMap.values()];
        const failedSteps = steps.filter((entry) => entry?.stepStatus === "error" || entry?.error?.code || entry?.error?.message);
        const completedSteps = steps.filter((entry) => entry?.stepStatus === "ok");
        return {
            workflowId,
            title: latest.workflowTitle || ordered.find((entry) => entry?.workflowTitle)?.workflowTitle || "",
            kind: latest.workflowKind || ordered.find((entry) => entry?.workflowKind)?.workflowKind || "",
            scope: latest.scope || ordered.find((entry) => entry?.scope)?.scope || "",
            status: latest.workflowStatus || (latest.success === true ? "completed" : latest.success === false ? "failed" : ""),
            approval: approvalEvent?.confirmationDecision || "",
            startedAt: ordered[0]?.timestamp || "",
            lastUpdatedAt: latest.timestamp || "",
            steps,
            completedStepCount: completedSteps.length,
            failedStepCount: failedSteps.length,
        };
    }).sort((left, right) => String(right.lastUpdatedAt || "").localeCompare(String(left.lastUpdatedAt || "")));
}

function getCompactTrustTierLabel(trustTier = {}) {
    switch (trustTier?.id) {
        case "high-trust-administrative":
            return "Admin";
        case "scoped-operator":
            return "Operator";
        default:
            return "Basic";
    }
}

function getCompactCapabilityIntentLabel(summary = {}) {
    switch (summary?.status) {
        case "aligned":
            return "Aligned";
        case "missing":
            return "Missing grants";
        case "extra-grants":
            return "Extra grants";
        case "undeclared":
            return "No intent";
        default:
            return "Intent";
    }
}

function getPluginStatusChip(selectedPluginTrustTier = {}, selectedPluginCapabilityIntentSummary = null, hasCapabilityIntent = false) {
    const trustLabel = getCompactTrustTierLabel(selectedPluginTrustTier);
    if (!hasCapabilityIntent || !selectedPluginCapabilityIntentSummary) {
        return {
            intent: selectedPluginTrustTier.intent === "none" ? "primary" : selectedPluginTrustTier.intent,
            label: trustLabel,
            tooltip: selectedPluginTrustTier.title || trustLabel,
        };
    }

    const chipIntent = selectedPluginCapabilityIntentSummary.intent && selectedPluginCapabilityIntentSummary.intent !== "none"
        ? selectedPluginCapabilityIntentSummary.intent
        : (selectedPluginTrustTier.intent === "none" ? "primary" : selectedPluginTrustTier.intent);
    const capabilityLabel = getCompactCapabilityIntentLabel(selectedPluginCapabilityIntentSummary);
    return {
        intent: chipIntent,
        label: `${trustLabel} · ${capabilityLabel}`,
        tooltip: `${selectedPluginTrustTier.title}. ${selectedPluginCapabilityIntentSummary.title}. ${selectedPluginCapabilityIntentSummary.summary}`,
    };
}

function shouldShowPluginStatusIndicator(summary = null, hasCapabilityIntent = false) {
    if (!hasCapabilityIntent || !summary) {
        return false;
    }
    return summary.status === "missing" || summary.status === "extra-grants" || summary.status === "undeclared";
}

function classifyValidationScenario(event = {}) {
    const errorCode = String(event?.error?.code || "").trim();
    if (errorCode === "CAPABILITY_DENIED") return "Capability denial";
    if (errorCode === "PROCESS_SPAWN_ENOENT" || errorCode === "STEP_PROCESS_SPAWN_ENOENT") return "Missing CLI";
    if (errorCode === "SCOPE_VIOLATION" || errorCode === "STEP_SCOPE_VIOLATION" || errorCode === "SCOPE_DENIED") return "Scope policy rejection";
    if (errorCode === "CLIPBOARD_UNSUPPORTED") return "Clipboard unavailable";
    if (errorCode === "CLIPBOARD_READ_FAILED" || errorCode === "CLIPBOARD_WRITE_FAILED") return "Clipboard operation failed";
    if (errorCode === "CANCELLED" || String(event?.confirmationDecision || "") === "denied") return "Confirmation rejected";
    if (event?.workflowId) {
        if (event?.workflowStatus === "completed") return "Workflow success";
        if (event?.workflowStatus === "partial") return "Workflow partial failure";
        if (event?.workflowStatus === "failed") return "Workflow failure";
        return "Workflow execution";
    }
    if (event?.action === "system.process.exec" && event?.success === true) return "Single action success";
    if (event?.action === "system.process.exec" && event?.success === false) return "Single action failure";
    if (event?.action === "system.clipboard.read" && event?.success === true) return "Clipboard read success";
    if (event?.action === "system.clipboard.read" && event?.success === false) return "Clipboard read failure";
    if (event?.action === "system.clipboard.write" && event?.success === true) return "Clipboard write success";
    if (event?.action === "system.clipboard.write" && event?.success === false) return "Clipboard write failure";
    if (event?.success === true) return "Privileged action success";
    if (event?.success === false) return "Privileged action failure";
    return "Observed activity";
}

function summarizeValidationScenarios(events = []) {
    const grouped = new Map();
    (Array.isArray(events) ? events : []).forEach((event) => {
        const label = classifyValidationScenario(event);
        if (!grouped.has(label)) {
            grouped.set(label, []);
        }
        grouped.get(label).push(event);
    });

    return [...grouped.entries()].map(([label, scenarioEvents]) => {
        const ordered = scenarioEvents.slice().sort((left, right) => String(right?.timestamp || "").localeCompare(String(left?.timestamp || "")));
        const latest = ordered[0] || {};
        return {
            label,
            count: ordered.length,
            latest,
            scopes: [...new Set(ordered.map((entry) => String(entry?.scope || "").trim()).filter(Boolean))],
            workflows: [...new Set(ordered.map((entry) => String(entry?.workflowId || "").trim()).filter(Boolean))],
            codes: [...new Set(ordered.map((entry) => String(entry?.error?.code || "").trim()).filter(Boolean))],
        };
    }).sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

function collectMissingProcessScopeIds({
    missingCapabilities = [],
    missingCapabilityDiagnostics = [],
    details = "",
    extraDetails = null,
} = {}) {
    const normalizeProcessScopeId = (value = "") => String(value || "")
        .trim()
        .replace(/^system\.process\.scope\./i, "")
        .replace(/^[`"'“”‘’([{]+|[`"'“”‘’)\]}]+$/g, "")
        .replace(/[.,;:!?]+$/g, "")
        .trim();
    const processScopeIdsFromCapabilities = (Array.isArray(missingCapabilities) ? missingCapabilities : [])
        .map((item) => String(item || "").trim())
        .filter((item) => item.startsWith("system.process.scope."))
        .map((item) => normalizeProcessScopeId(item))
        .filter(Boolean);
    const processScopeIdsFromDiagnostics = (Array.isArray(missingCapabilityDiagnostics) ? missingCapabilityDiagnostics : [])
        .map((item) => String(item?.capability || "").trim())
        .filter((item) => item.startsWith("system.process.scope."))
        .map((item) => normalizeProcessScopeId(item))
        .filter(Boolean);
    const processScopeIdsFromDetails = [...String(details || "").matchAll(/system\.process\.scope\.([a-zA-Z0-9._-]+)/g)]
        .map((match) => normalizeProcessScopeId(match?.[1]))
        .filter(Boolean);
    const processScopeIdsFromUnknownScopeDetails = [...String(details || "").matchAll(/process scope "([a-zA-Z0-9._-]+)"/gi)]
        .map((match) => normalizeProcessScopeId(match?.[1]))
        .filter(Boolean);
    const processScopeIdsFromExtraDetails = [
        extraDetails?.scope,
        extraDetails?.workflow?.scope,
    ]
        .map((item) => normalizeProcessScopeId(item))
        .filter(Boolean);

    return [...new Set([
        ...processScopeIdsFromCapabilities,
        ...processScopeIdsFromDiagnostics,
        ...processScopeIdsFromDetails,
        ...processScopeIdsFromUnknownScopeDetails,
        ...processScopeIdsFromExtraDetails,
    ])];
}

function isScopedCapability(capabilityId = "") {
    const normalizedCapabilityId = String(capabilityId || "").trim();
    return normalizedCapabilityId.startsWith("system.process.scope.")
        || normalizedCapabilityId.startsWith("system.fs.scope.");
}

function getRequestedCommandPathFromIssue({
    code = "",
    details = "",
    extraDetails = null,
} = {}) {
    const diagnostics = extractPrivilegedActionDiagnostics({
        code,
        details,
        extraDetails,
    });
    return String(
        diagnostics?.command?.command
        || (diagnostics?.command?.text || "").trim().split(/\s+/)[0]
        || ""
    ).trim();
}

export const Home = () => {
    const [searchActions, setSearchActions] = useState([])
    const [state, setState] = useState({
        plugins: [],
        activePlugins: [],
    });
    const [plugin, setPlugin] = useState("");
    const [selectedPluginStatusMessage, setSelectedPluginStatusMessage] = useState("");
    const [selectedPluginLifecycleStage, setSelectedPluginLifecycleStage] = useState("");
    const [showRightSideBar, setShowRightSideBar] = useState(() => {
        return localStorage.getItem("showRightSideBar") === "true";
    });
    const [showCommandSearch, setShowCommandSearch] = useState(false)
    const [notifications, setNotifications] = useState([]);
    const [pluginReadiness, setPluginReadiness] = useState(new Map());
    const [pluginInitStatus, setPluginInitStatus] = useState(new Map());
    const [pluginRuntimeStatuses, setPluginRuntimeStatuses] = useState(new Map());
    const [pluginRenderEpochs, setPluginRenderEpochs] = useState(new Map());
    const [sideBarActionItems, setSideBarActionItems] = useState([
        {id: "system-notifications", icon: "notifications", name: "Notifications", notifications},
        {id: "system-settings", icon: "settings", name: "Settings"},
        {id: "system-ai-chat", icon: "chat", name: "Chat with AI Assistant"},
    ])
    const [notificationsShow, setNotificationsShow] = useState(false)
    const [showSettingsDialog, setShowSettingsDialog] = useState(false)
    const [showAiChatDialog, setShowAiChatDialog] = useState(false)
    const [capabilityFocusRequest, setCapabilityFocusRequest] = useState(null);
    const [capabilityDeniedNotice, setCapabilityDeniedNotice] = useState({
        open: false,
        pluginId: "",
        missingCapabilities: [],
        missingCapabilityDiagnostics: [],
        details: "",
        code: "",
        correlationId: "",
        extraDetails: null,
    });
    const [pendingPluginScopeSuggestions, setPendingPluginScopeSuggestions] = useState({});
    const [isGrantingMissingCapabilities, setIsGrantingMissingCapabilities] = useState(false);
    const [privilegedAuditDialog, setPrivilegedAuditDialog] = useState({
        open: false,
        pluginId: "",
        loading: false,
        error: "",
        events: [],
    });
    const [runtimeValidationDialog, setRuntimeValidationDialog] = useState({
        open: false,
        pluginId: "",
        loading: false,
        error: "",
        events: [],
    });

    const buttonMenuRef = useRef(null)
    const prevPluginReadinessRef = useRef(new Map());
    const selectedPluginRef = useRef("");
    const pluginLastActivationMsRef = useRef(new Map());
    const pendingActivationStartedAtRef = useRef(new Map());
    const pluginToastDedupRef = useRef(new Map());
    const pendingDeactivateTimersRef = useRef(new Map());
    const stateRef = useRef(state);
    const searchActionsRef = useRef(searchActions);
    const sideBarActionItemsRef = useRef(sideBarActionItems);
    const showRightSideBarRef = useRef(showRightSideBar);

    useEffect(() => {
        stateRef.current = state;
    }, [state]);
    useEffect(() => {
        searchActionsRef.current = searchActions;
    }, [searchActions]);
    useEffect(() => {
        sideBarActionItemsRef.current = sideBarActionItems;
    }, [sideBarActionItems]);
    useEffect(() => {
        showRightSideBarRef.current = showRightSideBar;
    }, [showRightSideBar]);

    const deniedCapabilityItems = ((capabilityDeniedNotice.missingCapabilityDiagnostics || []).length > 0
        ? capabilityDeniedNotice.missingCapabilityDiagnostics
        : (capabilityDeniedNotice.missingCapabilities || []).map((capability) => ({
            capability,
            label: getCapabilityPresentation(capability).title,
            description: getCapabilityPresentation(capability).description,
            remediation: `Grant "${capability}" in Manage Plugins -> Capabilities.`,
            category: getCapabilityPresentation(capability).category,
            action: "",
    }))).map((item) => ({
        ...item,
        id: item.capability,
    }));
    const privilegedIssuePresentation = classifyPrivilegedActionIssue({
        code: capabilityDeniedNotice.code,
        missingCapabilities: capabilityDeniedNotice.missingCapabilities,
        details: capabilityDeniedNotice.details,
        detailsText: capabilityDeniedNotice.details,
        extraDetails: capabilityDeniedNotice.extraDetails,
    });
    const privilegedIssueDiagnostics = extractPrivilegedActionDiagnostics({
        code: capabilityDeniedNotice.code,
        details: capabilityDeniedNotice.details,
        extraDetails: capabilityDeniedNotice.extraDetails,
    });
    const missingProcessScopeIds = collectMissingProcessScopeIds(capabilityDeniedNotice);
    const normalizedMissingCapabilities = [...new Set(
        (Array.isArray(capabilityDeniedNotice.missingCapabilities) ? capabilityDeniedNotice.missingCapabilities : [])
            .map((item) => String(item || "").trim())
            .filter(Boolean)
    )];
    const missingScopedCapabilities = normalizedMissingCapabilities.filter((item) => isScopedCapability(item));
    const autoGrantableMissingCapabilities = normalizedMissingCapabilities.filter(
        (item) => !isScopedCapability(item)
    );
    const hasManualProcessScopeRemediation = missingProcessScopeIds.length > 0;
    const hasManualScopeRemediation = missingScopedCapabilities.length > 0;
    const requestedCommandPath = getRequestedCommandPathFromIssue({
        code: capabilityDeniedNotice.code,
        details: capabilityDeniedNotice.details,
        extraDetails: capabilityDeniedNotice.extraDetails,
    });
    const privilegedWorkflowContracts = summarizeWorkflowContracts(privilegedAuditDialog.events);
    const runtimeValidationScenarios = summarizeValidationScenarios(runtimeValidationDialog.events);
    const runtimeValidationStatus = runtimeValidationDialog.pluginId
        ? (pluginRuntimeStatuses.get(runtimeValidationDialog.pluginId) || null)
        : null;
    const runtimeValidationSummary = runtimeValidationStatus?.diagnosticsSummary || null;
    const getPluginDisplayName = useCallback((pluginId = "") => {
        const resolvedId = String(pluginId || "").trim();
        if (!resolvedId) {
            return "Active plugin";
        }
        const pluginRecord = (stateRef.current?.plugins || []).find((item) => item?.id === resolvedId);
        const name = String(pluginRecord?.name || "").trim();
        return name || resolvedId;
    }, []);

    const openPrivilegedAuditDialog = useCallback(async (pluginId) => {
        const targetPluginId = String(pluginId || "").trim();
        if (!targetPluginId || typeof window?.electron?.plugin?.getPrivilegedAudit !== "function") {
            return;
        }
        setPrivilegedAuditDialog({
            open: true,
            pluginId: targetPluginId,
            loading: true,
            error: "",
            events: [],
        });
        try {
            const result = await window.electron.plugin.getPrivilegedAudit(targetPluginId, {limit: 40});
            setPrivilegedAuditDialog({
                open: true,
                pluginId: targetPluginId,
                loading: false,
                error: result?.success ? "" : (result?.error || "Could not load privileged audit trail."),
                events: Array.isArray(result?.events) ? result.events : [],
            });
        } catch (error) {
            setPrivilegedAuditDialog({
                open: true,
                pluginId: targetPluginId,
                loading: false,
                error: error?.message || String(error),
                events: [],
            });
        }
    }, []);

    const openRuntimeValidationDialog = useCallback(async (pluginId) => {
        const targetPluginId = String(pluginId || "").trim();
        if (!targetPluginId || typeof window?.electron?.plugin?.getPrivilegedAudit !== "function") {
            return;
        }
        setRuntimeValidationDialog({
            open: true,
            pluginId: targetPluginId,
            loading: true,
            error: "",
            events: [],
        });
        try {
            const result = await window.electron.plugin.getPrivilegedAudit(targetPluginId, {limit: 80});
            setRuntimeValidationDialog({
                open: true,
                pluginId: targetPluginId,
                loading: false,
                error: result?.success ? "" : (result?.error || "Could not load runtime validation evidence."),
                events: Array.isArray(result?.events) ? result.events : [],
            });
        } catch (error) {
            setRuntimeValidationDialog({
                open: true,
                pluginId: targetPluginId,
                loading: false,
                error: error?.message || String(error),
                events: [],
            });
        }
    }, []);

    useEffect(() => {
        selectedPluginRef.current = plugin;
    }, [plugin]);

    const isPluginInit = (pluginID) => {
        return pluginInitStatus.get(pluginID) ?? false;
    };

    const markPluginReady = (pluginID) => {
        setPluginReadiness((prev) => {
            // Create a new Map to avoid mutating the state directly
            const newReadiness = new Map(prev);

            // Only update if the plugin exists and is not already ready
            if (newReadiness.has(pluginID) && !newReadiness.get(pluginID)) {
                newReadiness.set(pluginID, true);
            }

            return newReadiness;
        });
        setState(prevState => ({
            ...prevState,
            activePlugins: prevState.activePlugins.map(plugin =>
                plugin.id === pluginID ? {...plugin, loading: false} : plugin
            )
        }));
    };

    const markPluginInitComplete = (pluginID) => {
        setPluginInitStatus((prev) => {
            // Create a new Map to avoid mutating the state directly
            const status = new Map(prev);

            // Only update if the plugin exists and is not already ready
            if (status.has(pluginID) && !status.get(pluginID)) {
                status.set(pluginID, true);
            }
            return status;
        });
        setState(prevState => {
            return {
                ...prevState,
                activePlugins: prevState.activePlugins.map(plugin =>
                    plugin.id === pluginID ? {...plugin, loading: false} : plugin
                )
            };
        });
    };

    useEffect(() => {
        setSearchActions((prev) => {
            // Remove actions for plugins that are no longer installed
            const filteredActions = prev.filter(action =>
                !action.id.startsWith("navigate-") || state.plugins.some(plugin => action.id === `navigate-${plugin.id}`)
            );

            // Extract existing action IDs for quick lookup
            const existingActionIds = new Set(filteredActions.map(action => action.id));

            // Add new actions for plugins that are not yet registered
            const newActions = state.plugins
                .filter(plugin => !existingActionIds.has(`navigate-${plugin.id}`))
                .map(plugin => ({
                    id: `navigate-${plugin.id}`,
                    name: plugin.name,
                    subtitle: `${plugin.author} | ${plugin.version}`,
                    keywords: plugin.description,
                    perform: () => {
                        buttonMenuRef.current.click();
                        setTimeout(() => {
                            const targetElement = document.querySelector(`[data-plugin="${plugin.name}"]`);
                            if (targetElement) {
                                targetElement.scrollIntoView({behavior: "smooth", block: "start"});

                                // Add wiggle effect
                                targetElement.classList.add(styles["wiggle"]);

                                // Remove wiggle effect after 1.5s
                                setTimeout(() => {
                                    targetElement.classList.remove(styles["wiggle"]);
                                }, 1500);
                            }
                        }, 300);
                    },
                    icon: <Icon icon={sanitizeBlueprintIcon(plugin.icon)} size={24}/>,
                    section: "Installed plugins",
                }));

            return [...filteredActions, ...newActions];
        });
    }, [state.plugins]);

    useEffect(() => {
        // Track plugin activation and deactivation
        setPluginInitStatus((prev) => {
            const status = new Map(prev);

            // Add new plugins with INIT as false
            state.activePlugins.forEach((plugin) => {
                if (!status.has(plugin.id)) {
                    status.set(plugin.id, false);
                }
            });

            // Remove plugins that are no longer active
            prev.forEach((_, pluginID) => {
                if (!state.activePlugins.some((p) => p.id === pluginID)) {
                    status.delete(pluginID);
                }
            });

            return status;
        });

        setPluginReadiness((prev) => {
            const newReadiness = new Map(prev);

            // Add new plugins with readiness as false
            state.activePlugins.forEach((plugin) => {
                if (!newReadiness.has(plugin.id)) {
                    newReadiness.set(plugin.id, false);
                }
            });

            // Remove plugins that are no longer active
            prev.forEach((_, pluginID) => {
                if (!state.activePlugins.some((p) => p.id === pluginID)) {
                    newReadiness.delete(pluginID);
                }
            });

            return newReadiness;
        });

        setSearchActions((prev) => {
            // Remove active plugin actions for plugins that are no longer active.
            const filteredActions = prev.filter(action =>
                !(
                    (action.id.startsWith("navigate-active-") || action.id.startsWith("plugin-action-")) &&
                    !state.activePlugins.some(plugin =>
                        action.pluginId
                            ? action.pluginId === plugin.id
                            : new RegExp(`^navigate-active-.*-${plugin.id}$`).test(action.id)
                    )
                )
            );
            if (state.activePlugins.length === 0) {
                return filteredActions.filter(
                    action => !action.id.startsWith("navigate-active-") && !action.id.startsWith("plugin-action-")
                );
            }

            // Add new actions for plugins that are not yet registered
            const newActionsOpen = state.activePlugins
                .filter(plugin => !filteredActions.some(action => action.id === `navigate-active-open-${plugin.id}`))
                .map(plugin => ({
                    id: `navigate-active-open-${plugin.id}`,
                    name: "Open",
                    subtitle: "Open plugin page",
                    icon: <Icon icon={"share"} size={16}/>,
                    perform: () => handlePluginChange(plugin.id),
                    section: plugin.name,
                    sectionPriorityKey: "Active plugin actions",
                }));

            return [...filteredActions, ...newActionsOpen];
        });
        setSideBarActionItems((prev) => {
            const filteredSidePanel = prev.filter(action =>
                action.id.startsWith("system-") ||
                state.activePlugins.some(plugin => new RegExp(`^${plugin.id}$`).test(action.id))
            );
            if (state.activePlugins.length === 0) {
                return filteredSidePanel.filter(action => action.id.startsWith("system-"));
            }
            return [...filteredSidePanel];
        })
    }, [state.activePlugins]);

    useEffect(() => {
        const prevReadiness = prevPluginReadinessRef.current;
        const newlyReadyPlugins = [];

        pluginReadiness.forEach((ready, pluginID) => {
            if (ready && (!prevReadiness.has(pluginID) || !prevReadiness.get(pluginID))) {
                newlyReadyPlugins.push(pluginID);
            }
        });

        // Update previous readiness ref
        prevPluginReadinessRef.current = new Map(pluginReadiness);

        // Perform actions only for newly ready plugins
        if (newlyReadyPlugins.length > 0) {
            for (const pluginID of newlyReadyPlugins) {
                window.electron.plugin.init(pluginID)
            }
        }
    }, [pluginReadiness]);

    const deselectAllPlugins = () => {
        // Deactivate all plugins in Electron
        const pluginIds = state.activePlugins.map(plugin => plugin.id);
        pluginIds.forEach((id) => expectedManualUnloadRef.current.add(id));
        pluginTrace("home.deselectAll.request", {ids: pluginIds});

        Promise.all(pluginIds.map(id => window.electron.plugin.deactivate(id)))
            .then(async (results) => {
                // Check if all plugins were successfully deactivated
                const allSuccessful = results.every(result => result && result.success);

                if (allSuccessful) {
                    setState(prevState => ({
                        ...prevState,
                        activePlugins: []
                    }));
                } else {
                    pluginIds.forEach((id) => expectedManualUnloadRef.current.delete(id));
                    // Find which plugins failed to deactivate
                    const failedPlugins = results
                        .map((result, index) => !result.success ? pluginIds[index] : null)
                        .filter(Boolean);

                    (await AppToaster).show({
                        message: `Error: Failed to deactivate plugins: ${failedPlugins.join(", ")}`,
                        intent: "danger"
                    });
                }
                setPlugin("")
                setSelectedPluginStatusMessage("")
                setSelectedPluginLifecycleStage("")
            })
            .catch(async () => {
                pluginIds.forEach((id) => expectedManualUnloadRef.current.delete(id));
                (await AppToaster).show({
                    message: `Failed to deactivate plugins`,
                    intent: "danger"
                });
            });
    };

    const deselectPlugin = (plugin) => {
        const MIN_UPTIME_BEFORE_DEACTIVATE_MS = 1500;
        const lastActivatedAt = pluginLastActivationMsRef.current.get(plugin.id) || 0;
        const deactivateNow = () => window.electron.plugin.deactivate(plugin.id).then(async (result) => {
            if (result) {
                if (result.success) {
                    setState(prevState => {
                        // Check if plugin exists
                        const pluginExists = prevState.activePlugins.some(item => item.id === plugin.id);

                        if (pluginExists) {
                            // Remove the plugin
                            return {
                                ...prevState,
                                activePlugins: prevState.activePlugins.filter(item => item.id !== plugin.id)
                            }
                        } else {
                            return prevState;
                        }
                    });
                    if (selectedPluginRef.current === plugin.id) {
                        setPlugin("")
                        setSelectedPluginStatusMessage("")
                        setSelectedPluginLifecycleStage("")
                    }
                } else {
                    expectedManualUnloadRef.current.delete(plugin.id);
                    (await AppToaster).show({message: `Error: ${result.error}`, intent: "danger"});
                }
            } else {
                expectedManualUnloadRef.current.delete(plugin.id);
                (await AppToaster).show({message: `Failed to deactivate plugin`, intent: "danger"});
            }
        });

        const pendingTimer = pendingDeactivateTimersRef.current.get(plugin.id);
        if (pendingTimer) {
            clearTimeout(pendingTimer);
            pendingDeactivateTimersRef.current.delete(plugin.id);
        }

        expectedManualUnloadRef.current.add(plugin.id);
        const elapsed = Date.now() - lastActivatedAt;
        if (lastActivatedAt > 0 && elapsed < MIN_UPTIME_BEFORE_DEACTIVATE_MS) {
            const remaining = Math.max(0, MIN_UPTIME_BEFORE_DEACTIVATE_MS - elapsed);
            pluginTrace("home.deselectPlugin.deferred.cooldown", {id: plugin.id, delayMs: remaining});

            // Keep plugin marked active until deactivation actually completes.
            // Removing it early causes rapid re-open to issue a duplicate activate
            // while runtime is still alive, leading to unstable render lifecycle.
            if (selectedPluginRef.current === plugin.id) {
                setPlugin("");
                setSelectedPluginStatusMessage("");
                setSelectedPluginLifecycleStage("");
            }

            const timerId = window.setTimeout(() => {
                pendingDeactivateTimersRef.current.delete(plugin.id);
                deactivateNow().catch(() => {});
            }, remaining + 20);
            pendingDeactivateTimersRef.current.set(plugin.id, timerId);
            return;
        }

        pluginTrace("home.deselectPlugin.request", {id: plugin.id});
        deactivateNow().catch(() => {});
    }

    const selectPlugin = (plugin, options = {}) => {
        const { open = false } = options;
        const pendingTimer = pendingDeactivateTimersRef.current.get(plugin.id);
        if (pendingTimer) {
            clearTimeout(pendingTimer);
            pendingDeactivateTimersRef.current.delete(plugin.id);
            expectedManualUnloadRef.current.delete(plugin.id);
            pluginTrace("home.selectPlugin.cancelPendingDeactivate", {id: plugin.id});
        }
        pluginTrace("home.selectPlugin.request", {id: plugin.id, open, selected: selectedPluginRef.current || ""});
        const alreadyActive = state.activePlugins.some((item) => item.id === plugin.id);

        if (alreadyActive) {
            pendingActivationStartedAtRef.current.delete(plugin.id);
            if (open || !selectedPluginRef.current) {
                pluginTrace("home.selectPlugin.alreadyActive.open", {id: plugin.id});
                handlePluginChange(plugin.id);
            }
            return;
        }

        pendingActivationStartedAtRef.current.set(plugin.id, Date.now());
        window.electron.plugin.activate(plugin.id).then(async (result) => {
            if (result) {
                if (result.success) {
                    setState(prevState => {
                        // Check if plugin already exists
                        const pluginExists = prevState.activePlugins.some(item => item.id === plugin.id);

                        if (pluginExists) {
                            return prevState;
                        }
                        return {
                            ...prevState,
                            activePlugins: [...prevState.activePlugins, plugin]
                        };
                    });
                    if (open || !selectedPluginRef.current) {
                        pluginTrace("home.selectPlugin.activated.open", {id: plugin.id});
                        handlePluginChange(plugin.id);
                    }
                } else {
                    pendingActivationStartedAtRef.current.delete(plugin.id);
                    (await AppToaster).show({message: `Error: ${result.error}`, intent: "danger"});
                }
            } else {
                pendingActivationStartedAtRef.current.delete(plugin.id);
                (await AppToaster).show({message: `Failed to activate plugin`, intent: "danger"});
            }
        });
    };

    const syncActivePluginLoadingState = async (activePlugins = []) => {
        const ids = (activePlugins || []).map((item) => item.id).filter(Boolean);
        if (ids.length === 0) return;

        const hasRecentPendingActivation = (id) => {
            const activationStartedAt = Number(pendingActivationStartedAtRef.current.get(id) || 0);
            if (!(activationStartedAt > 0)) {
                return false;
            }
            return (Date.now() - activationStartedAt) <= 12000;
        };

        const result = await window.electron.plugin.getRuntimeStatus(ids).catch(() => null);
        if (!result?.success || !Array.isArray(result.statuses)) {
            setState((prevState) => ({
                ...prevState,
                activePlugins: (() => {
                    let changed = false;
                    const nextActive = prevState.activePlugins.map((plugin) => {
                        const nextLoading = hasRecentPendingActivation(plugin.id);
                        if (plugin.loading !== nextLoading) {
                            changed = true;
                            return {
                                ...plugin,
                                loading: nextLoading,
                            };
                        }
                        return plugin;
                    });
                    return changed ? nextActive : prevState.activePlugins;
                })(),
            }));
            return;
        }

        const statusById = new Map(result.statuses.map((item) => [item.id, item]));
        setPluginRuntimeStatuses((prev) => {
            if (prev.size !== statusById.size) {
                return statusById;
            }
            for (const [id, nextStatus] of statusById.entries()) {
                const prevStatus = prev.get(id);
                if (
                    !prevStatus
                    || !!prevStatus.loading !== !!nextStatus.loading
                    || !!prevStatus.loaded !== !!nextStatus.loaded
                    || !!prevStatus.ready !== !!nextStatus.ready
                    || !!prevStatus.inited !== !!nextStatus.inited
                ) {
                    return statusById;
                }
            }
            return prev;
        });
        setPluginReadiness((prev) => {
            const next = new Map(prev);
            let changed = false;
            result.statuses.forEach((status) => {
                if (status?.id && status.ready && next.get(status.id) !== true) {
                    next.set(status.id, true);
                    changed = true;
                }
            });
            return changed ? next : prev;
        });
        setPluginInitStatus((prev) => {
            const next = new Map(prev);
            let changed = false;
            result.statuses.forEach((status) => {
                if (status?.id && status.inited && next.get(status.id) !== true) {
                    next.set(status.id, true);
                    changed = true;
                }
            });
            return changed ? next : prev;
        });
        setState(prevState => {
            let changed = false;
            const nextActive = prevState.activePlugins.map((plugin) => {
                const runtimeStatus = statusById.get(plugin.id);
                if (!runtimeStatus) return plugin;
                if (runtimeStatus.loaded || runtimeStatus.ready || runtimeStatus.inited) {
                    pendingActivationStartedAtRef.current.delete(plugin.id);
                }
                const activationStartedAt = Number(pendingActivationStartedAtRef.current.get(plugin.id) || 0);
                const activationAgeMs = activationStartedAt > 0 ? Date.now() - activationStartedAt : Number.POSITIVE_INFINITY;
                const withinActivationWindow = activationAgeMs <= 12000;
                const nextLoading = withinActivationWindow && (!!runtimeStatus.loading || (!runtimeStatus.loaded && !runtimeStatus.ready));
                if (plugin.loading !== nextLoading) {
                    changed = true;
                    return {
                        ...plugin,
                        loading: nextLoading,
                    };
                }
                return plugin;
            });
            if (!changed) {
                return prevState;
            }
            return {
                ...prevState,
                activePlugins: nextActive,
            };
        });
    };

    const pluginsInitialLoad = useRef(false);
    const refreshPluginsState = useCallback(async () => {
        const [allPlugins, activePlugins] = await Promise.all([
            window.electron.plugin.getAll(),
            window.electron.plugin.getActivated(),
        ]);

        const activatedIds = new Set(activePlugins?.plugins || []);
        const activePluginIds = [...activatedIds].filter(Boolean);
        const runtimeStatusResult = activePluginIds.length > 0
            ? await window.electron.plugin.getRuntimeStatus(activePluginIds).catch(() => null)
            : null;
        const runtimeStatusById = new Map(
            Array.isArray(runtimeStatusResult?.statuses)
                ? runtimeStatusResult.statuses.map((status) => [status.id, status])
                : []
        );

        const allPluginRecords = (allPlugins?.plugins || []).map((plugin) => ({
            ...plugin,
            ...plugin.metadata,
            capabilities: Array.isArray(plugin.capabilities) ? plugin.capabilities : [],
            loading: activatedIds.has(plugin.id)
                ? (() => {
                    const runtimeStatus = runtimeStatusById.get(plugin.id);
                    if (!runtimeStatus) return false;
                    if (runtimeStatus.loading && !pendingActivationStartedAtRef.current.get(plugin.id)) {
                        pendingActivationStartedAtRef.current.set(plugin.id, Date.now());
                    }
                    if (runtimeStatus.loaded || runtimeStatus.ready || runtimeStatus.inited) {
                        pendingActivationStartedAtRef.current.delete(plugin.id);
                    }
                    const activationStartedAt = Number(pendingActivationStartedAtRef.current.get(plugin.id) || 0);
                    const activationAgeMs = activationStartedAt > 0 ? Date.now() - activationStartedAt : Number.POSITIVE_INFINITY;
                    const withinActivationWindow = activationAgeMs <= 12000;
                    return withinActivationWindow && (!!runtimeStatus.loading || (!runtimeStatus.loaded && !runtimeStatus.ready));
                })()
                : false,
        }));

        setPluginRuntimeStatuses((prev) => {
            if (prev.size !== runtimeStatusById.size) {
                return runtimeStatusById;
            }
            for (const [id, nextStatus] of runtimeStatusById.entries()) {
                const prevStatus = prev.get(id);
                if (
                    !prevStatus
                    || !!prevStatus.loading !== !!nextStatus.loading
                    || !!prevStatus.loaded !== !!nextStatus.loaded
                    || !!prevStatus.ready !== !!nextStatus.ready
                    || !!prevStatus.inited !== !!nextStatus.inited
                ) {
                    return runtimeStatusById;
                }
            }
            return prev;
        });
        setPluginReadiness((prev) => {
            const next = new Map(prev);
            let changed = false;
            runtimeStatusById.forEach((status, id) => {
                if (status?.ready && next.get(id) !== true) {
                    next.set(id, true);
                    changed = true;
                }
            });
            return changed ? next : prev;
        });
        setPluginInitStatus((prev) => {
            const next = new Map(prev);
            let changed = false;
            runtimeStatusById.forEach((status, id) => {
                if (status?.inited && next.get(id) !== true) {
                    next.set(id, true);
                    changed = true;
                }
            });
            return changed ? next : prev;
        });

        setState((prevState) => ({
            ...prevState,
            plugins: allPluginRecords,
            activePlugins: allPluginRecords.filter((plugin) => activatedIds.has(plugin.id)),
        }));
    }, []);

    useEffect(() => {
        if (pluginsInitialLoad.current) return;
        pluginsInitialLoad.current = true;
        refreshPluginsState();

    }, [refreshPluginsState]);

    const activePluginIdsKey = state.activePlugins.map((item) => item.id).filter(Boolean).join("|");
    const activePluginsLoadingKey = state.activePlugins.map((item) => `${item.id}:${item.loading ? 1 : 0}`).join("|");

    useEffect(() => {
        syncActivePluginLoadingState(state.activePlugins);
    }, [activePluginIdsKey]);

    useEffect(() => {
        if (state.activePlugins.length === 0) {
            return;
        }

        let cancelled = false;
        let intervalId = null;

        const poll = async () => {
            if (cancelled) return;
            await syncActivePluginLoadingState(state.activePlugins);
        };

        // Immediate reconciliation after active set changes.
        poll().catch(() => {});

        // Keep reconciling while any plugin still reports loading to prevent stale spinners.
        if (state.activePlugins.some((item) => item.loading)) {
            intervalId = window.setInterval(() => {
                poll().catch(() => {});
            }, 900);
        }

        return () => {
            cancelled = true;
            if (intervalId) {
                window.clearInterval(intervalId);
            }
        };
    }, [activePluginIdsKey, activePluginsLoadingKey]);

    useEffect(() => {
        const activeIds = state.activePlugins.map((item) => item.id).filter(Boolean);
        if (activeIds.length === 0) {
            return;
        }

        const hasSelectedActivePlugin = !!plugin && activeIds.includes(plugin);
        if (!hasSelectedActivePlugin) {
            handlePluginChange(activeIds[0]);
        }
    }, [plugin, activePluginIdsKey]);

    useEffect(() => {
        if (!plugin) return;
        if (isPluginInit(plugin)) return;
        if (!state.activePlugins.some((item) => item.id === plugin)) return;

        let cancelled = false;
        let attempts = 0;

        const pollRuntimeStatus = async () => {
            if (cancelled) return;
            attempts += 1;
            await syncActivePluginLoadingState(state.activePlugins.filter((item) => item.id === plugin));
            if (cancelled || attempts >= 8) return;
            if (!pluginInitStatus.get(plugin)) {
                setTimeout(pollRuntimeStatus, 250);
            }
        };

        pollRuntimeStatus();

        return () => {
            cancelled = true;
        };
    }, [plugin, state.activePlugins, pluginInitStatus]);

    const isProcessingPluginFromEditor = useRef(false);
    const isUnloading = useRef(false);
    const expectedManualUnloadRef = useRef(new Set());
    const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
    const UNLOAD_STALE_GUARD_MS = 2500;
    const UNEXPECTED_MANUAL_UNLOAD_IGNORE_WINDOW_MS = 6000;
    const TOAST_DEDUP_MS = 3500;

    const isRuntimeStatusActive = (status) => {
        if (!status) return false;
        return !!(status.loading || status.loaded || status.ready || status.inited);
    };

    const showPluginErrorToast = async ({pluginId, reason, details, allowRetry = true}) => {
        const dedupeKey = `${pluginId}:${reason}:${details || ""}`;
        const now = Date.now();
        const lastAt = pluginToastDedupRef.current.get(dedupeKey) || 0;
        if (now - lastAt < TOAST_DEDUP_MS) {
            return;
        }
        pluginToastDedupRef.current.set(dedupeKey, now);

        const errorClassification = classifyPluginError(reason, details);
        const summary = errorClassification.summary;
        const canRetry = allowRetry && errorClassification.retryable;
        const pluginRecord = state.plugins.find((item) => item.id === pluginId);

        const openLogs = async () => {
            const result = await window.electron.system.openPluginLogs(pluginId);
            if (!result?.success) {
                (await AppToaster).show({
                    message: `Could not open logs folder: ${result?.error || "unknown error"}`,
                    intent: "warning",
                });
            }
        };

        const reportIssue = async () => {
            const runtimeStatusResult = await window.electron.plugin.getRuntimeStatus([pluginId]).catch(() => null);
            const runtimeStatus = runtimeStatusResult?.statuses?.[0] || null;
            const payload = [
                `Plugin: ${pluginId}`,
                `Reason: ${reason}`,
                `Details: ${details || ""}`,
                `Runtime status: ${runtimeStatus ? JSON.stringify(runtimeStatus) : "unavailable"}`,
                `Latest privileged audit: ${runtimeStatus?.lastPrivilegedAudit ? JSON.stringify(runtimeStatus.lastPrivilegedAudit) : "none"}`,
                `Timestamp: ${new Date().toISOString()}`,
            ].join("\n");
            try {
                await navigator.clipboard.writeText(payload);
                (await AppToaster).show({
                    message: `${pluginId}: diagnostic report copied to clipboard.`,
                    intent: "success",
                });
            } catch (error) {
                (await AppToaster).show({
                    message: `${pluginId}: failed to copy report. ${error?.message || String(error)}`,
                    intent: "warning",
                });
            }
        };

        const retryPluginOpen = () => {
            if (pluginRecord) {
                selectPlugin(pluginRecord, {open: true});
                return;
            }
            window.electron.plugin.activate(pluginId).then(async (result) => {
                if (!result?.success) {
                    (await AppToaster).show({
                        message: `${pluginId}: retry failed. ${result?.error || "unknown error"}`,
                        intent: "danger",
                    });
                    return;
                }
                handlePluginChange(pluginId);
            });
        };

        (await AppToaster).show({
            intent: "danger",
            timeout: 10000,
            message: (
                <div style={{display: "flex", flexDirection: "column", gap: "8px"}}>
                    <div>{pluginId}: {summary}</div>
                    <div style={{display: "flex", gap: "8px", flexWrap: "wrap"}}>
                        {canRetry && (
                            <Button small={true} minimal={true} icon="refresh" onClick={retryPluginOpen}>
                                Retry
                            </Button>
                        )}
                        <Button small={true} minimal={true} icon="document-open" onClick={openLogs}>
                            Open logs
                        </Button>
                        <Button small={true} minimal={true} icon="issue" onClick={reportIssue}>
                            Report issue
                        </Button>
                    </div>
                </div>
            ),
        });
    };

    useEffect(() => {
        const onPluginReady = (pluginID) => {
            pluginTrace("home.event.ready", {id: pluginID});
            pluginLastActivationMsRef.current.set(pluginID, Date.now());
            pendingActivationStartedAtRef.current.delete(pluginID);
            setState((prevState) => {
                const alreadyActive = prevState.activePlugins.some((item) => item.id === pluginID);
                if (alreadyActive) {
                    return prevState;
                }

                const pluginRecord = prevState.plugins.find((item) => item.id === pluginID);
                if (!pluginRecord) {
                    return prevState;
                }

                return {
                    ...prevState,
                    activePlugins: [...prevState.activePlugins, pluginRecord],
                };
            });
            if (!selectedPluginRef.current) {
                handlePluginChange(pluginID);
            }
            markPluginReady(pluginID)
        }

        const onPluginInit = (response) => {
            const {id, quickActions, sidePanelActions} = response
            markPluginInitComplete(id)
            if (id && !selectedPluginRef.current) {
                handlePluginChange(id);
            }
            const pluginSection = getPluginDisplayName(id);
            setSearchActions((prev) => {
                const base = prev.filter((action) => !(action.source === "plugin-init" && action.pluginId === id));
                if (!Array.isArray(quickActions) || quickActions.length === 0) {
                    return base;
                }
                const mapped = quickActions.map((action) => {
                    const actionName = String(action?.name || "").trim() || "Action";
                    const actionSubtitle = String(action?.subtitle || "").trim();
                    return {
                        id: `plugin-action-${id}-${generateActionId(actionName)}`,
                        name: actionName,
                        subtitle: actionSubtitle,
                        keywords: [actionName, actionSubtitle].filter(Boolean).join(" "),
                        icon: <Icon icon={sanitizeBlueprintIcon(action?.icon, "dot")} size={16}/>,
                        perform: () => {
                            console.log(action?.message_type);
                        },
                        section: pluginSection,
                        sectionPriorityKey: "Active plugin actions",
                        pluginId: id,
                        source: "plugin-init",
                    };
                });
                return [...base, ...mapped];
            });
            setSideBarActionItems((prevState) => {
                const base = prevState.filter((item) => item.id !== id);
                if (!sidePanelActions) {
                    return base;
                }
                const resolvedSidePanelIcon = resolveBlueprintIcon(sidePanelActions.icon, "panel-stats");
                if (resolvedSidePanelIcon.usedFallback && typeof sidePanelActions.icon === "string" && sidePanelActions.icon.trim()) {
                    const dedupeKey = `invalid-sidepanel-icon:${id}:${String(sidePanelActions.icon).trim().toLowerCase()}`;
                    const lastAt = pluginToastDedupRef.current.get(dedupeKey) || 0;
                    const now = Date.now();
                    if (now - lastAt > TOAST_DEDUP_MS) {
                        pluginToastDedupRef.current.set(dedupeKey, now);
                        pluginTrace("home.plugin.invalid_sidepanel_icon", {
                            pluginId: id,
                            providedIcon: sidePanelActions.icon,
                            fallbackIcon: resolvedSidePanelIcon.icon,
                            reason: resolvedSidePanelIcon.reason,
                        });
                        Promise.resolve(AppToaster).then((toaster) => {
                            toaster.show({
                                intent: "warning",
                                message: `${getPluginDisplayName(id)} uses unsupported side panel icon "${sidePanelActions.icon}". Fallback "${resolvedSidePanelIcon.icon}" was applied.`,
                            });
                        });
                    }
                }
                return [
                    ...base,
                    {
                        id,
                        icon: resolvedSidePanelIcon.icon,
                        name: sidePanelActions.label,
                        submenu_list: sidePanelActions.submenu_list
                    }
                ];
            });
        }

        const onPluginLoaded = (loadedPlugin) => {
            if (isProcessingPluginFromEditor.current) return;
            isProcessingPluginFromEditor.current = true;
            if (loadedPlugin) {
                window.electron.plugin.get(loadedPlugin).then((loadedPlugin) => {
                    const newPlugin = {...loadedPlugin.plugin, ...loadedPlugin.plugin.metadata, loading: true};
                    setSearchActions((prev) => prev.filter((action) => !(action.source === "plugin-init" && action.pluginId === newPlugin.id)));
                    setSideBarActionItems((prev) => prev.filter((item) => item.id !== newPlugin.id));
                    setPluginReadiness((prev) => {
                        const next = new Map(prev);
                        next.set(newPlugin.id, false);
                        return next;
                    });
                    setPluginInitStatus((prev) => {
                        const next = new Map(prev);
                        next.set(newPlugin.id, false);
                        return next;
                    });
                    setPluginRenderEpochs((prev) => {
                        const next = new Map(prev);
                        next.set(newPlugin.id, (next.get(newPlugin.id) || 0) + 1);
                        return next;
                    });
                    setState(prevState => {
                        const pluginExists = prevState.plugins.some(item => item.id === newPlugin.id);
                        const nextPlugins = pluginExists
                            ? prevState.plugins.map((item) => item.id === newPlugin.id ? {...item, ...newPlugin} : item)
                            : [...prevState.plugins, newPlugin];
                        const nextActivePlugins = prevState.activePlugins.some((item) => item.id === newPlugin.id)
                            ? prevState.activePlugins.map((item) => item.id === newPlugin.id ? {...item, ...newPlugin, loading: true} : item)
                            : prevState.activePlugins;
                        selectPlugin(newPlugin, {open: true});
                        return {
                            ...prevState,
                            plugins: nextPlugins,
                            activePlugins: nextActivePlugins,
                        };
                    });
                    const wasActive = stateRef.current.activePlugins.some((item) => item.id === newPlugin.id);
                    if (wasActive) {
                        window.setTimeout(() => {
                            if (typeof window.electron.plugin.init === "function") {
                                window.electron.plugin.init(newPlugin.id).catch(() => {});
                            }
                            if (typeof window.electron.plugin.render === "function") {
                                window.electron.plugin.render(newPlugin.id).catch(() => {});
                            }
                        }, 0);
                    }
                }).finally(() => {
                    isProcessingPluginFromEditor.current = false;
                });
                return;
            }
            isProcessingPluginFromEditor.current = false;
        }

        const onPluginUnloaded = async (unloadedPluginEvent) => {
            if (isUnloading.current) return;
            isUnloading.current = true;
            try {
                const unloadedPlugin = typeof unloadedPluginEvent === "string"
                    ? { id: unloadedPluginEvent, reason: "unloaded", message: "" }
                    : (unloadedPluginEvent || {});
                const unloadedPluginId = unloadedPlugin.id;
                const reason = unloadedPlugin.reason || "unloaded";
                const wasSelectedPlugin = unloadedPluginId && unloadedPluginId === selectedPluginRef.current;
                let isUnexpectedManualUnload = false;
                pluginTrace("home.event.unloaded", {
                    id: unloadedPluginId || "",
                    reason,
                    wasSelected: !!wasSelectedPlugin,
                    selected: selectedPluginRef.current || "",
                });

                if (reason === "manual_unload") {
                    const expected = unloadedPluginId ? expectedManualUnloadRef.current.has(unloadedPluginId) : false;
                    if (!expected) {
                        isUnexpectedManualUnload = true;
                        pluginTrace("home.unload.unexpectedManual", {id: unloadedPluginId || ""});
                    }
                    if (unloadedPluginId) {
                        expectedManualUnloadRef.current.delete(unloadedPluginId);
                    }
                }

                if (unloadedPluginId) {
                    setPluginRenderEpochs((prev) => {
                        const next = new Map(prev);
                        next.set(unloadedPluginId, (next.get(unloadedPluginId) || 0) + 1);
                        return next;
                    });
                    setSearchActions((prev) => prev.filter((action) => !(action.source === "plugin-init" && action.pluginId === unloadedPluginId)));
                    setSideBarActionItems((prev) => prev.filter((item) => item.id !== unloadedPluginId));
                    const activatedAt = pluginLastActivationMsRef.current.get(unloadedPluginId) || 0;
                    const pendingActivationAt = pendingActivationStartedAtRef.current.get(unloadedPluginId) || 0;
                    const openedRecently = activatedAt > 0 && (Date.now() - activatedAt) < UNEXPECTED_MANUAL_UNLOAD_IGNORE_WINDOW_MS;
                    const activationPendingRecently = pendingActivationAt > 0 && (Date.now() - pendingActivationAt) < UNEXPECTED_MANUAL_UNLOAD_IGNORE_WINDOW_MS;
                    if (reason === "manual_unload" && isUnexpectedManualUnload && (openedRecently || activationPendingRecently)) {
                        pluginTrace("home.unload.ignored.unexpectedManual.recentActivation", {
                            id: unloadedPluginId,
                            openedRecently,
                            activationPendingRecently,
                        });
                        return;
                    }
                    try {
                        const activatedRecently = activatedAt > 0 && (Date.now() - activatedAt) < UNLOAD_STALE_GUARD_MS;
                        if (activatedRecently) {
                            await sleep(300);
                        }

                        // Confirm runtime inactivity across a short window to filter stale unload events.
                        for (let attempt = 0; attempt < 3; attempt += 1) {
                            const runtimeStatus = await window.electron.plugin.getRuntimeStatus([unloadedPluginId]);
                            const status = runtimeStatus?.statuses?.[0];
                            pluginTrace("home.unload.runtimeStatus", {
                                id: unloadedPluginId,
                                attempt,
                                loading: !!status?.loading,
                                loaded: !!status?.loaded,
                                ready: !!status?.ready,
                                inited: !!status?.inited,
                            });
                            if (isRuntimeStatusActive(status)) {
                                if (reason === "manual_unload" && isUnexpectedManualUnload) {
                                    pluginTrace("home.unload.ignored.unexpectedManual.stale", {id: unloadedPluginId});
                                }
                                pluginTrace("home.unload.ignored.stale", {id: unloadedPluginId});
                                return;
                            }
                            if (attempt < 2) {
                                await sleep(120);
                            }
                        }
                    } catch (_) {
                        // If status probe fails, fall back to the unload event handling.
                    }

                    window.electron.plugin.deactivateUsers(unloadedPluginId).then(() => {
                    })
                    setState(prevState => {
                        const pluginExists = prevState.activePlugins.some(item => item.id === unloadedPluginId);

                        if (pluginExists) {
                            return {
                                ...prevState,
                                activePlugins: prevState.activePlugins.filter(item => item.id !== unloadedPluginId)
                            }
                        } else {
                            return prevState;
                        }
                    });
                }

                if (wasSelectedPlugin) {
                    const userInitiatedReason = reason === "manual_unload" && !isUnexpectedManualUnload;
                    if (userInitiatedReason) {
                        return;
                    }
                    if (reason === "manual_unload" && isUnexpectedManualUnload) {
                        selectedPluginRef.current = "";
                        setPlugin("");
                        setSelectedPluginLifecycleStage("");
                        setSelectedPluginStatusMessage("");
                        return;
                    }
                    await showPluginErrorToast({
                        pluginId: unloadedPluginId,
                        reason,
                        details: unloadedPlugin.message,
                        allowRetry: reason !== "verification_failed",
                    });
                    pluginTrace("home.unload.toast", {id: unloadedPluginId, reason});
                    setSelectedPluginStatusMessage("");
                    return;
                }
                if (reason !== "manual_unload" && unloadedPluginId) {
                    await showPluginErrorToast({
                        pluginId: unloadedPluginId,
                        reason,
                        details: unloadedPlugin.message,
                        allowRetry: false,
                    });
                }
            } finally {
                isUnloading.current = false;
            }
        }

        window.electron.plugin.on.ready(onPluginReady)
        window.electron.plugin.on.init(onPluginInit)
        window.electron.plugin.on.unloaded(onPluginUnloaded)
        window.electron.plugin.on.deployFromEditor(onPluginLoaded)
        return () => {
            window.electron.plugin.off.ready(onPluginReady)
            window.electron.plugin.off.init(onPluginInit)
            window.electron.plugin.off.deployFromEditor(onPluginLoaded)
            window.electron.plugin.off.unloaded(onPluginUnloaded)
        };
    }, [])

    useEffect(() => {
        const handleNotificationsUpdate = (_, updatedNotifications) => {
            setNotifications(updatedNotifications);

            setSideBarActionItems(prev =>
                prev.map(item =>
                    item.id === "system-notifications"
                        ? { ...item, notifications: updatedNotifications }
                        : item
                )
            );
        };

        // Fetch initial notifications without the IPC event parameter
        window.electron.notifications.get().then((notifications) => {
            handleNotificationsUpdate(null, notifications);
        });

        window.electron.notifications.on.updated(handleNotificationsUpdate);

        return () => {
            window.electron.notifications.off.updated(handleNotificationsUpdate);
        };
    }, []);

    const handlePluginChange = (newPlugin, actionId = "") => {
        pluginTrace("home.handlePluginChange", {next: newPlugin || "", prev: selectedPluginRef.current || ""});
        setSelectedPluginStatusMessage("");
        if (!newPlugin) {
            selectedPluginRef.current = "";
            setPlugin("");
            setSelectedPluginLifecycleStage("");
            return;
        }

        selectedPluginRef.current = newPlugin;
        setSelectedPluginLifecycleStage("selected");
        setPlugin((prev) => {
            if (prev === newPlugin) {
                return prev;
            }
            return newPlugin;
        });
        syncActivePluginLoadingState(state.activePlugins.filter((item) => item.id === newPlugin));

        if (actionId === "plugin-audit") {
            openPrivilegedAuditDialog(newPlugin);
        } else if (actionId === "plugin-validate") {
            openRuntimeValidationDialog(newPlugin);
        } else if (actionId === "plugin-capabilities") {
            setCapabilityFocusRequest({
                requestId: `${Date.now()}`,
                pluginId: newPlugin,
                capabilityIds: [],
            });
        }
    };

    useEffect(() => {
        window.__homeTestApi = {
            openPluginById: (pluginId) => handlePluginChange(pluginId),
            getSelectedPlugin: () => selectedPluginRef.current,
            getActivePluginIds: () => state.activePlugins.map((item) => item.id),
            getSearchActionsSnapshot: () => searchActionsRef.current.map((action) => ({
                id: action?.id || "",
                name: action?.name || "",
                subtitle: action?.subtitle || "",
                section: action?.section || "",
                sectionPriorityKey: action?.sectionPriorityKey || "",
                pluginId: action?.pluginId || "",
                source: action?.source || "",
                keywords: action?.keywords || "",
            })),
            getRightSidebarItemsSnapshot: () => sideBarActionItemsRef.current.map((item) => ({
                id: item?.id || "",
                icon: item?.icon || "",
                name: item?.name || "",
                submenu_list: Array.isArray(item?.submenu_list)
                    ? item.submenu_list.map((subItem) => ({
                        id: subItem?.id || "",
                        name: subItem?.name || "",
                        message_type: subItem?.message_type || "",
                    }))
                    : [],
            })),
            isRightSidebarVisible: () => !!showRightSideBarRef.current,
            selectPluginById: (pluginId, options = {open: true}) => {
                const target = state.plugins.find((item) => item.id === pluginId);
                if (!target) return false;
                selectPlugin(target, options);
                return true;
            },
            deselectPluginById: (pluginId) => {
                const target = state.activePlugins.find((item) => item.id === pluginId)
                    || state.plugins.find((item) => item.id === pluginId);
                if (!target) return false;
                deselectPlugin(target);
                return true;
            },
        };
    }, [state.activePlugins, state.plugins]);

    useEffect(() => {
        return () => {
            for (const timerId of pendingDeactivateTimersRef.current.values()) {
                clearTimeout(timerId);
            }
            pendingDeactivateTimersRef.current.clear();
            if (window.__homeTestApi) {
                delete window.__homeTestApi;
            }
        };
    }, []);

    const handleSideBarItemsClick = (id) => {
        if (id === "system-notifications") {
            setNotificationsShow(true);
        } else if (id === "system-settings") {
            setShowSettingsDialog(true);
        } else if (id === "system-ai-chat") {
            setShowAiChatDialog(true)
        }
    };

    const removePlugin = (pluginId) => {
        setState(prevState => ({
            ...prevState,
            plugins: prevState.plugins.filter(plugin => plugin.id !== pluginId)
        }));
    };

    const handleOpenCapabilitiesFromDenied = () => {
        if (!capabilityDeniedNotice.pluginId) {
            setCapabilityDeniedNotice((prev) => ({...prev, open: false}));
            return;
        }
        setCapabilityFocusRequest({
            requestId: `${Date.now()}`,
            pluginId: capabilityDeniedNotice.pluginId,
            capabilityIds: capabilityDeniedNotice.missingCapabilities,
            focusSection: "capabilities",
        });
        setCapabilityDeniedNotice((prev) => ({...prev, open: false}));
    };

    const handleOpenProcessAccessFromDenied = () => {
        if (!capabilityDeniedNotice.pluginId) {
            setCapabilityDeniedNotice((prev) => ({...prev, open: false}));
            return;
        }
        const suggestedScopeId = missingProcessScopeIds[0] || "";
        setCapabilityFocusRequest({
            requestId: `${Date.now()}`,
            pluginId: capabilityDeniedNotice.pluginId,
            capabilityIds: capabilityDeniedNotice.missingCapabilities,
            focusSection: "pluginScopes",
            scopeIds: missingProcessScopeIds,
            suggestedScope: suggestedScopeId ? {
                scopeId: suggestedScopeId,
                commandPath: requestedCommandPath,
            } : null,
        });
        setCapabilityDeniedNotice((prev) => ({...prev, open: false}));
    };

    const handleCapabilityFocusRequestConsumed = (requestId) => {
        const normalizedRequestId = String(requestId || "").trim();
        if (!normalizedRequestId) {
            return;
        }
        setCapabilityFocusRequest((prev) => {
            if (!prev?.requestId || String(prev.requestId) !== normalizedRequestId) {
                return prev;
            }
            return null;
        });
    };

    const clearPendingPluginScopeSuggestion = useCallback((pluginId) => {
        const normalizedPluginId = String(pluginId || "").trim();
        if (!normalizedPluginId) {
            return;
        }
        setPendingPluginScopeSuggestions((prev) => {
            if (!prev?.[normalizedPluginId]) {
                return prev;
            }
            const next = {...prev};
            delete next[normalizedPluginId];
            return next;
        });
    }, []);

    const handleCopyCapabilityDeniedDetails = async () => {
        try {
            const details = capabilityDeniedNotice.details || "Capability denied.";
            await navigator.clipboard.writeText(details);
            (await AppToaster).show({
                message: "Permission error details copied to clipboard.",
                intent: "success",
            });
        } catch (_) {
            (await AppToaster).show({
                message: "Unable to copy details to clipboard.",
                intent: "warning",
            });
        }
    };

    const handleGrantMissingCapabilitiesFromDenied = async () => {
        const pluginId = String(capabilityDeniedNotice.pluginId || "").trim();
        if (!pluginId) {
            return;
        }
        if (autoGrantableMissingCapabilities.length === 0) {
            (await AppToaster).show({
                message: hasManualScopeRemediation
                    ? "Scope permissions must be reviewed manually in Manage Plugins."
                    : "No missing capabilities were detected for this request.",
                intent: "warning",
            });
            return;
        }

        const pluginRecord = stateRef.current.plugins.find((item) => item.id === pluginId)
            || stateRef.current.activePlugins.find((item) => item.id === pluginId)
            || null;
        const existingCapabilities = Array.isArray(pluginRecord?.capabilities) ? pluginRecord.capabilities : [];
        const nextCapabilities = [...new Set([...existingCapabilities, ...autoGrantableMissingCapabilities])];
        const hasNewCapabilities = nextCapabilities.length !== existingCapabilities.length;
        if (!hasNewCapabilities) {
            (await AppToaster).show({
                message: "All listed capabilities are already granted.",
                intent: "primary",
            });
            return;
        }

        setIsGrantingMissingCapabilities(true);
        try {
            const result = await window.electron.plugin.setCapabilities(pluginId, nextCapabilities);
            if (!result?.success) {
                (await AppToaster).show({
                    message: `Failed to grant missing capabilities: ${result?.error || "unknown error"}`,
                    intent: "danger",
                });
                return;
            }

            await refreshPluginsState?.();
            await syncActivePluginLoadingState(stateRef.current.activePlugins);
            setCapabilityDeniedNotice((prev) => ({...prev, open: false}));
            (await AppToaster).show({
                message: `Granted ${autoGrantableMissingCapabilities.length} capability${autoGrantableMissingCapabilities.length > 1 ? "ies" : "y"} for ${pluginId}.`,
                intent: "success",
            });
        } finally {
            setIsGrantingMissingCapabilities(false);
        }
    };
    const hasCapabilitiesFixAction = !!privilegedIssuePresentation.showCapabilitiesButton;
    const hasPluginScopeFixAction = hasManualProcessScopeRemediation;
    const canAutoGrantMissingCapabilities = hasCapabilitiesFixAction
        && !hasManualScopeRemediation
        && autoGrantableMissingCapabilities.length > 0;
    const capabilityDeniedPrimaryAction = hasPluginScopeFixAction
        ? {
            label: "Fix Process Access",
            onClick: handleOpenProcessAccessFromDenied,
        }
        : (hasCapabilitiesFixAction
        ? {
            label: "Open Capabilities",
            onClick: handleOpenCapabilitiesFromDenied,
        }
        : null);
    const capabilityDeniedMoreActions = [
        ...(canAutoGrantMissingCapabilities ? [{
            key: "grant-missing-capabilities",
            text: "Grant Missing Capabilities",
            intent: "success",
            onClick: handleGrantMissingCapabilitiesFromDenied,
            disabled: isGrantingMissingCapabilities,
        }] : []),
        ...(capabilityDeniedNotice.pluginId ? [{
            key: "open-audit-trail",
            text: "Open Audit Trail",
            onClick: () => openPrivilegedAuditDialog(capabilityDeniedNotice.pluginId),
        }, {
            key: "open-validation",
            text: "Open Validation",
            onClick: () => openRuntimeValidationDialog(capabilityDeniedNotice.pluginId),
        }] : []),
    ];

    const selectedPluginRecord = state.activePlugins.find((item) => item.id === plugin)
        || state.plugins.find((item) => item.id === plugin)
        || null;
    const selectedPluginIsActive = state.activePlugins.some((item) => item.id === plugin);
    const activePluginSidebarItems = state.activePlugins.map((pluginItem) => {
        const runtimeStatus = pluginRuntimeStatuses.get(pluginItem.id) || null;
        const diagnosticsSummary = runtimeStatus?.diagnosticsSummary || {};
        const capabilityIntentSummary = buildCapabilityDeclarationSummary(runtimeStatus?.capabilityIntent || {});
        const trustTier = getPluginTrustTier(pluginItem?.capabilities || []);
        const statusChip = getPluginStatusChip(trustTier, capabilityIntentSummary, !!runtimeStatus?.capabilityIntent);
        const capabilityNeedsAttention = shouldShowPluginStatusIndicator(
            capabilityIntentSummary,
            !!runtimeStatus?.capabilityIntent
        );
        const runtimeNeedsReview = Number(diagnosticsSummary?.failureCount || 0) > 0;
        const sidebarIntent = runtimeNeedsReview
            ? "warning"
            : "none";

        return {
            ...pluginItem,
            intent: sidebarIntent,
            tooltip: runtimeNeedsReview
                ? "Runtime issues detected. Open Runtime Validation."
                : (capabilityNeedsAttention
                    ? "Capability intent differs from current grants. Review in Capabilities."
                    : pluginItem.name),
            popupActions: [
                {
                    id: "plugin-validate",
                    icon: "endorsed",
                    name: "Runtime Validation",
                    labelElement: runtimeNeedsReview ? <Tag minimal intent="warning">Needs review</Tag> : null,
                },
                {
                    id: "plugin-capabilities",
                    icon: "shield",
                    name: "Capabilities",
                    labelElement: capabilityNeedsAttention ? <Tag minimal intent={statusChip.intent || "primary"}>Review</Tag> : null,
                },
                {
                    id: "plugin-audit",
                    icon: "history",
                    name: "Audit Trail",
                },
            ],
        };
    });
    const pluginContextBarHeight = 50;
    const rightSidebarMenuItems = [...sideBarActionItems];

    return (
        <HotkeysTarget
            hotkeys={[
                {
                    combo: "cmd + k",
                    global: true,
                    label: "Show Command Bar",
                    onKeyDown: () => setShowCommandSearch(true),
                    preventDefault: true,
                    stopPropagation: true,
                },
            ]}
        >
            <CommandBar show={showCommandSearch} actions={searchActions} setShow={setShowCommandSearch}/>
            <div className={classNames("bp6-dark", styles["main-container"])} data-testid="fdo-main-container">
                {state.activePlugins.length > 0 && (
                    <SideBar
                        position={"left"}
                        menuItems={activePluginSidebarItems}
                        click={handlePluginChange}
                        activeItemId={plugin}
                        topOffset={pluginContextBarHeight}
                    />
                )}
                <Navbar fixedToTop={true}>
                    <NavbarGroup className={styles["nav-center"]}>
                        <NavigationPluginsButton active={state.activePlugins} all={state.plugins}
                                                 buttonMenuRef={buttonMenuRef}
                                                 selectPlugin={selectPlugin} deselectPlugin={deselectPlugin}
                                                 deselectAllPlugins={deselectAllPlugins} removePlugin={removePlugin}
                                                 setSearchActions={setSearchActions}
                                                 refreshPluginsState={refreshPluginsState}
                                                 capabilityFocusRequest={capabilityFocusRequest}
                                                 onCapabilityFocusRequestConsumed={handleCapabilityFocusRequestConsumed}
                                                 pendingPluginScopeSuggestions={pendingPluginScopeSuggestions}
                                                 onPendingPluginScopeSuggestionResolved={clearPendingPluginScopeSuggestion}
                        />
                    </NavbarGroup>
                    <NavbarGroup align={Alignment.END}>
                        <InputGroup
                            leftIcon={"search"} placeholder={"Search..."} inputClassName={styles["header-search"]}
                            rightElement={<Tag minimal={true} className={"bp6-monospace-text"}
                                               style={{fontSize: "0.6rem", background: "black"}}>Cmd+K</Tag>}
                            onClick={() => setShowCommandSearch(true)}
                            value=""
                            onKeyDown={() => setShowCommandSearch(true)}
                        />
                        <NavbarDivider/>
                        <div className={styles["notification-container"]}>
                            <Button variant={"minimal"} icon={showRightSideBar ? "menu-open" : "menu-closed"}
                                    onClick={() => {
                                        setShowRightSideBar(!showRightSideBar);
                                        localStorage.setItem("showRightSideBar", !showRightSideBar)
                                    }}/>
                            <span
                                className={styles["notification-dot"]}
                                hidden={!notifications || notifications.filter(n => !n.read).length === 0 || showRightSideBar}
                            />
                        </div>
                    </NavbarGroup>
                </Navbar>
                {showRightSideBar && (
                    <SideBar
                        position={"right"}
                        menuItems={rightSidebarMenuItems}
                        click={handleSideBarItemsClick}
                        topOffset={pluginContextBarHeight}
                    />
                )}
                <div style={{
                    marginLeft: (state.plugins.length > 0 ? "50px" : ""),
                    marginRight: (showRightSideBar ? "50px" : ""),
                    marginTop: "0"
                }}>
                    <div className={styles["plugin-workspace"]} data-testid="fdo-plugin-workspace">
                        {state.activePlugins.map((activePlugin) => {
                            const pluginId = activePlugin.id;
                            const isSelected = pluginId === plugin;
                            return (
                                <PluginContainer
                                    key={`${pluginId}:${pluginRenderEpochs.get(pluginId) || 0}`}
                                    plugin={pluginId}
                                    active={isSelected}
                                    onStageChange={isSelected ? setSelectedPluginLifecycleStage : undefined}
                                    onRequestCommandBar={() => setShowCommandSearch(true)}
                                    onCapabilityDenied={(payload) => {
                                const structuredMissingCapabilities = Array.isArray(payload?.extraDetails?.missingCapabilities)
                                    ? payload.extraDetails.missingCapabilities
                                    : [];
                                const resolvedPluginId = payload?.pluginId || pluginId;
                                const missingCapabilities = [...new Set([
                                    ...(Array.isArray(payload?.missingCapabilities) ? payload.missingCapabilities : []),
                                    ...structuredMissingCapabilities,
                                ].filter((item) => typeof item === "string" && item.trim()))];
                                const parsedMissingCapabilityDiagnostics = Array.isArray(payload?.missingCapabilityDiagnostics)
                                    ? payload.missingCapabilityDiagnostics
                                    : parseMissingCapabilityDiagnosticsFromError(payload?.details || payload?.error || "");
                                const missingCapabilityDiagnostics = parsedMissingCapabilityDiagnostics.length > 0
                                    ? parsedMissingCapabilityDiagnostics
                                    : parseMissingCapabilityDiagnosticsFromError(
                                        structuredMissingCapabilities.length > 0
                                            ? `Missing required capabilities: ${structuredMissingCapabilities.join(", ")}.`
                                            : ""
                                    );
                                const details = String(payload?.details || payload?.error || "Capability denied.");
                                const extraDetails = payload?.extraDetails || null;
                                const detectedMissingProcessScopeIds = collectMissingProcessScopeIds({
                                    missingCapabilities,
                                    missingCapabilityDiagnostics,
                                    details,
                                    extraDetails,
                                });
                                if (detectedMissingProcessScopeIds.length > 0) {
                                    const suggestedScopeId = detectedMissingProcessScopeIds[0] || "";
                                    const commandPath = getRequestedCommandPathFromIssue({
                                        code: String(payload?.code || ""),
                                        details,
                                        extraDetails,
                                    });
                                    setPendingPluginScopeSuggestions((prev) => ({
                                        ...prev,
                                        [resolvedPluginId]: {
                                            scopeIds: detectedMissingProcessScopeIds,
                                            suggestedScope: suggestedScopeId ? {
                                                scopeId: suggestedScopeId,
                                                commandPath,
                                            } : null,
                                        },
                                    }));
                                }
                                setCapabilityDeniedNotice({
                                    open: true,
                                    pluginId: resolvedPluginId,
                                    missingCapabilities,
                                    missingCapabilityDiagnostics,
                                    details,
                                    code: String(payload?.code || ""),
                                    correlationId: String(payload?.correlationId || ""),
                                    extraDetails,
                                });
                                    }}
                                />
                            );
                        })}
                    </div>
                </div>
            <NotificationsPanel notificationsShow={notificationsShow} setNotificationsShow={setNotificationsShow} notifications={notifications} />
            <Dialog
                isOpen={capabilityDeniedNotice.open}
                onClose={() => setCapabilityDeniedNotice((prev) => ({...prev, open: false}))}
                title={privilegedIssuePresentation.title}
                canEscapeKeyClose={true}
                canOutsideClickClose={true}
            >
                <div className="bp6-dialog-body">
                    <p>
                        Plugin <code>{capabilityDeniedNotice.pluginId || "unknown"}</code>: {privilegedIssuePresentation.summary}
                    </p>
                    <p className="bp6-text-muted" style={{marginBottom: "8px"}}>
                        Fix: {privilegedIssuePresentation.remediation}
                    </p>
                    {deniedCapabilityItems.length > 0 ? (
                        <>
                            <p className="bp6-text-muted" style={{marginBottom: "8px"}}>
                                Missing capabilities:
                            </p>
                            <div style={{display: "flex", flexDirection: "column", gap: "8px", marginBottom: "12px"}}>
                                {deniedCapabilityItems.map(({id, label, description, remediation, action}) => (
                                    <div key={id}>
                                        <Tag intent="warning" minimal>{label}</Tag>
                                        <div className="bp6-text-small bp6-text-muted" style={{marginTop: "4px"}}>
                                            {description}
                                        </div>
                                        <div className="bp6-text-small bp6-text-muted">
                                            Technical ID: <code>{id}</code>
                                        </div>
                                        {action ? (
                                            <div className="bp6-text-small bp6-text-muted">
                                                Required for: {action}
                                            </div>
                                        ) : null}
                                        {remediation ? (
                                            <div className="bp6-text-small bp6-text-muted">
                                                Fix: {remediation}
                                            </div>
                                        ) : null}
                                    </div>
                                ))}
                            </div>
                        </>
                    ) : null}
                    {missingProcessScopeIds.length > 0 ? (
                        <Card style={{marginTop: "10px", marginBottom: "10px", border: "1px solid #d4d5d7"}}>
                            <div className="bp6-text-small" style={{fontWeight: 600}}>
                                Required Plugin-Specific Process Scope Setup
                            </div>
                            <div className="bp6-text-small bp6-text-muted" style={{marginTop: "6px"}}>
                                1. Use <strong>Fix Process Access</strong> to open Manage Plugins for <code>{capabilityDeniedNotice.pluginId || "this plugin"}</code>.
                            </div>
                            <div className="bp6-text-small bp6-text-muted">
                                2. In Capabilities, keep broad grant <code>system.process.exec</code> enabled.
                            </div>
                            <div className="bp6-text-small bp6-text-muted">
                                3. In Plugin-Specific Process Scopes, add scope ID <code>{missingProcessScopeIds[0]}</code> (and any other listed below).
                            </div>
                            <div className="bp6-text-small bp6-text-muted">
                                4. In Allowed executable paths, include <code>{requestedCommandPath || "/absolute/path/to/tool"}</code>.
                            </div>
                            <div className="bp6-text-small bp6-text-muted">
                                5. Review cwd roots, env keys, and timeout manually. This dialog never auto-creates or auto-grants process scopes.
                            </div>
                            <div className="bp6-text-small bp6-text-muted" style={{marginTop: "6px"}}>
                                Missing scopes: <code>{missingProcessScopeIds.join(", ")}</code>
                            </div>
                        </Card>
                    ) : null}
                    <div className="bp6-text-small bp6-text-muted">
                        {capabilityDeniedNotice.details}
                    </div>
                    {privilegedIssueDiagnostics.command ? (
                        <div className="bp6-text-small bp6-text-muted" style={{marginTop: "8px"}}>
                            Requested command: <code>{privilegedIssueDiagnostics.command.text || privilegedIssueDiagnostics.command.command}</code>
                            {privilegedIssueDiagnostics.command.cwd ? (
                                <>
                                    {" "}in <code>{privilegedIssueDiagnostics.command.cwd}</code>
                                </>
                            ) : null}
                        </div>
                    ) : null}
                    {privilegedIssueDiagnostics.command?.allowlistedExecutables?.length > 0 ? (
                        <div className="bp6-text-small bp6-text-muted" style={{marginTop: "4px"}}>
                            Allowlisted paths: <code>{privilegedIssueDiagnostics.command.allowlistedExecutables.join(", ")}</code>
                        </div>
                    ) : null}
                    {privilegedIssueDiagnostics.workflow ? (
                        <div style={{marginTop: "12px"}}>
                            <Tag minimal intent="primary">Workflow</Tag>
                            <div className="bp6-text-small bp6-text-muted" style={{marginTop: "4px"}}>
                                ID: <code>{privilegedIssueDiagnostics.workflow.workflowId || "unknown"}</code>
                                {privilegedIssueDiagnostics.workflow.title ? (
                                    <> | Title: <code>{privilegedIssueDiagnostics.workflow.title}</code></>
                                ) : null}
                                {privilegedIssueDiagnostics.workflow.kind ? (
                                    <> | Kind: <code>{privilegedIssueDiagnostics.workflow.kind}</code></>
                                ) : null}
                                {privilegedIssueDiagnostics.workflow.scope ? (
                                    <> | Scope: <code>{privilegedIssueDiagnostics.workflow.scope}</code></>
                                ) : null}
                                {privilegedIssueDiagnostics.workflow.status ? (
                                    <> | Status: <code>{privilegedIssueDiagnostics.workflow.status}</code></>
                                ) : null}
                            </div>
                            {privilegedIssueDiagnostics.workflow.summary ? (
                                <div className="bp6-text-small bp6-text-muted">
                                    Steps: {privilegedIssueDiagnostics.workflow.summary.completedSteps || 0} completed, {privilegedIssueDiagnostics.workflow.summary.failedSteps || 0} failed, {privilegedIssueDiagnostics.workflow.summary.skippedSteps || 0} skipped, {privilegedIssueDiagnostics.workflow.summary.totalSteps || 0} total.
                                </div>
                            ) : null}
                        </div>
                    ) : null}
                    {privilegedIssueDiagnostics.steps.length > 0 ? (
                        <div style={{marginTop: "12px"}}>
                            <Tag minimal intent="danger">Step failures</Tag>
                            <div style={{display: "flex", flexDirection: "column", gap: "8px", marginTop: "8px"}}>
                                {privilegedIssueDiagnostics.steps.map((step) => (
                                    <div key={`${step.stepId}-${step.correlationId || step.command || step.title}`}>
                                        <div className="bp6-text-small">
                                            <strong>{step.title || step.stepId || "Step"}</strong>
                                            {step.stepId ? <> (<code>{step.stepId}</code>)</> : null}
                                            {step.status ? <> | status: <code>{step.status}</code></> : null}
                                            {step.code ? <> | code: <code>{step.code}</code></> : null}
                                        </div>
                                        {step.command ? (
                                            <div className="bp6-text-small bp6-text-muted">
                                                Command: <code>{step.command}</code>
                                                {step.cwd ? <> | cwd: <code>{step.cwd}</code></> : null}
                                            </div>
                                        ) : null}
                                        {step.exitCode !== null && step.exitCode !== undefined ? (
                                            <div className="bp6-text-small bp6-text-muted">
                                                Exit code: <code>{String(step.exitCode)}</code>
                                                {step.durationMs !== null ? <> | Duration: <code>{String(step.durationMs)}ms</code></> : null}
                                                {step.dryRun ? <> | Dry run</> : null}
                                            </div>
                                        ) : null}
                                        {step.error ? (
                                            <div className="bp6-text-small bp6-text-muted">{step.error}</div>
                                        ) : null}
                                        {step.correlationId ? (
                                            <div className="bp6-text-small bp6-text-muted">
                                                Step correlation ID: <code>{step.correlationId}</code>
                                            </div>
                                        ) : null}
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : null}
                    {capabilityDeniedNotice.correlationId ? (
                        <div className="bp6-text-small bp6-text-muted">
                            Correlation ID: <code>{capabilityDeniedNotice.correlationId}</code>
                        </div>
                    ) : null}
                </div>
                <div className="bp6-dialog-footer">
                    <div className="bp6-dialog-footer-actions">
                        <Button minimal onClick={handleCopyCapabilityDeniedDetails}>Copy Details</Button>
                        {capabilityDeniedMoreActions.length > 0 ? (
                            <Popover
                                content={(
                                    <Menu>
                                        {capabilityDeniedMoreActions.map((action) => (
                                            <MenuItem
                                                key={action.key}
                                                text={action.text}
                                                intent={action.intent}
                                                disabled={action.disabled}
                                                onClick={action.onClick}
                                            />
                                        ))}
                                    </Menu>
                                )}
                            >
                                <Button minimal>More Actions</Button>
                            </Popover>
                        ) : null}
                        {capabilityDeniedPrimaryAction ? (
                            <Button intent="primary" onClick={capabilityDeniedPrimaryAction.onClick}>
                                {capabilityDeniedPrimaryAction.label}
                            </Button>
                        ) : (
                            <Button intent="primary" onClick={() => setCapabilityDeniedNotice((prev) => ({...prev, open: false}))}>Close</Button>
                        )}
                    </div>
                </div>
            </Dialog>
            <Dialog
                isOpen={runtimeValidationDialog.open}
                onClose={() => setRuntimeValidationDialog((prev) => ({...prev, open: false}))}
                title={`Runtime Validation${runtimeValidationDialog.pluginId ? `: ${runtimeValidationDialog.pluginId}` : ""}`}
                canEscapeKeyClose={true}
                canOutsideClickClose={true}
            >
                <div className="bp6-dialog-body">
                    {runtimeValidationDialog.loading ? (
                        <p className="bp6-text-muted">Loading runtime validation evidence...</p>
                    ) : null}
                    {!runtimeValidationDialog.loading && runtimeValidationDialog.error ? (
                        <p className="bp6-text-muted">{runtimeValidationDialog.error}</p>
                    ) : null}
                    {!runtimeValidationDialog.loading && !runtimeValidationDialog.error ? (
                        <div className="bp6-text-small bp6-text-muted" style={{marginBottom: "10px"}}>
                            Events: <code>{String(runtimeValidationSummary?.totalEvents || 0)}</code>
                            {" | "}
                            Failures: <code>{String(runtimeValidationSummary?.failureCount || 0)}</code>
                            {" | "}
                            Last failure code: <code>{runtimeValidationSummary?.latestFailureCode || "none"}</code>
                        </div>
                    ) : null}
                    {!runtimeValidationDialog.loading && !runtimeValidationDialog.error ? (
                        <p className="bp6-text-small bp6-text-muted" style={{marginBottom: "10px"}}>
                            Note: runtime validation history is reset when plugin capabilities are changed.
                        </p>
                    ) : null}
                    {!runtimeValidationDialog.loading && !runtimeValidationDialog.error && runtimeValidationScenarios.length === 0 ? (
                        <p className="bp6-text-muted">
                            No privileged runtime evidence recorded yet. Trigger a privileged action (process/workflow/clipboard) and reopen this view.
                        </p>
                    ) : null}
                    {!runtimeValidationDialog.loading && runtimeValidationScenarios.length > 0 ? (
                        <div style={{display: "flex", flexDirection: "column", gap: "12px"}}>
                            {runtimeValidationScenarios.map((scenario) => (
                                <div key={scenario.label} style={{border: "1px solid #eef0f2", borderRadius: "6px", padding: "10px", background: "#fafbfc"}}>
                                    <div className="bp6-text-small">
                                        <strong>{scenario.label}</strong> | occurrences: <code>{String(scenario.count)}</code>
                                    </div>
                                    <div className="bp6-text-small bp6-text-muted">
                                        Latest action: <code>{scenario.latest.action || "unknown"}</code>
                                        {scenario.latest.timestamp ? <> | Last seen: <code>{scenario.latest.timestamp}</code></> : null}
                                        {typeof scenario.latest.success === "boolean" ? <> | Latest outcome: <code>{scenario.latest.success ? "success" : "failure"}</code></> : null}
                                    </div>
                                    {scenario.scopes.length > 0 ? (
                                        <div className="bp6-text-small bp6-text-muted">
                                            Scopes: <code>{scenario.scopes.join(", ")}</code>
                                        </div>
                                    ) : null}
                                    {scenario.workflows.length > 0 ? (
                                        <div className="bp6-text-small bp6-text-muted">
                                            Workflows: <code>{scenario.workflows.join(", ")}</code>
                                        </div>
                                    ) : null}
                                    {scenario.codes.length > 0 ? (
                                        <div className="bp6-text-small bp6-text-muted">
                                            Error codes: <code>{scenario.codes.join(", ")}</code>
                                        </div>
                                    ) : null}
                                </div>
                            ))}
                        </div>
                    ) : null}
                </div>
                <div className="bp6-dialog-footer">
                    <div className="bp6-dialog-footer-actions">
                        <Button intent="primary" onClick={() => setRuntimeValidationDialog((prev) => ({...prev, open: false}))}>Close</Button>
                    </div>
                </div>
            </Dialog>
            <Dialog
                isOpen={privilegedAuditDialog.open}
                onClose={() => setPrivilegedAuditDialog((prev) => ({...prev, open: false}))}
                title={`Privileged Audit Trail${privilegedAuditDialog.pluginId ? `: ${privilegedAuditDialog.pluginId}` : ""}`}
                canEscapeKeyClose={true}
                canOutsideClickClose={true}
            >
                <div className="bp6-dialog-body">
                    {privilegedAuditDialog.loading ? (
                        <p className="bp6-text-muted">Loading privileged audit events...</p>
                    ) : null}
                    {!privilegedAuditDialog.loading && privilegedAuditDialog.error ? (
                        <p className="bp6-text-muted">{privilegedAuditDialog.error}</p>
                    ) : null}
                    {!privilegedAuditDialog.loading && !privilegedAuditDialog.error && privilegedAuditDialog.events.length === 0 ? (
                        <p className="bp6-text-muted">No privileged audit events recorded for this plugin yet.</p>
                    ) : null}
                    {!privilegedAuditDialog.loading && privilegedWorkflowContracts.length > 0 ? (
                        <div style={{marginBottom: "16px"}}>
                            <Tag minimal intent="primary">Workflow Contracts</Tag>
                            <div style={{display: "flex", flexDirection: "column", gap: "12px", marginTop: "8px"}}>
                                {privilegedWorkflowContracts.map((workflow) => (
                                    <div key={workflow.workflowId} style={{border: "1px solid #eef0f2", borderRadius: "6px", padding: "10px", background: "#fafbfc"}}>
                                        <div className="bp6-text-small">
                                            <strong>{workflow.title || workflow.workflowId}</strong>
                                            {workflow.scope ? <> | scope: <code>{workflow.scope}</code></> : null}
                                            {workflow.kind ? <> | kind: <code>{workflow.kind}</code></> : null}
                                            {workflow.status ? <> | status: <code>{workflow.status}</code></> : null}
                                            {workflow.approval ? <> | approval: <code>{workflow.approval}</code></> : null}
                                        </div>
                                        <div className="bp6-text-small bp6-text-muted">
                                            Workflow ID: <code>{workflow.workflowId}</code>
                                            {workflow.startedAt ? <> | Started: <code>{workflow.startedAt}</code></> : null}
                                            {workflow.lastUpdatedAt ? <> | Updated: <code>{workflow.lastUpdatedAt}</code></> : null}
                                        </div>
                                        <div className="bp6-text-small bp6-text-muted">
                                            Steps: <code>{String(workflow.completedStepCount)}</code> completed, <code>{String(workflow.failedStepCount)}</code> failed, <code>{String(workflow.steps.length)}</code> total
                                        </div>
                                        {workflow.steps.length > 0 ? (
                                            <div style={{display: "flex", flexDirection: "column", gap: "6px", marginTop: "8px"}}>
                                                {workflow.steps.map((step) => (
                                                    <div key={`${workflow.workflowId}-${step.stepId || step.stepTitle || "step"}`} className="bp6-text-small bp6-text-muted">
                                                        <strong>{step.stepTitle || step.stepId || "Step"}</strong>
                                                        {step.stepId ? <> (<code>{step.stepId}</code>)</> : null}
                                                        {step.stepStatus ? <> | status: <code>{step.stepStatus}</code></> : null}
                                                        {step.stepCorrelationId ? <> | correlation: <code>{step.stepCorrelationId}</code></> : null}
                                                        {step.error?.code ? <> | code: <code>{step.error.code}</code></> : null}
                                                        {step.error?.message ? <> | {step.error.message}</> : null}
                                                    </div>
                                                ))}
                                            </div>
                                        ) : null}
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : null}
                    {!privilegedAuditDialog.loading && privilegedAuditDialog.events.length > 0 ? (
                        <div style={{display: "flex", flexDirection: "column", gap: "12px"}}>
                            <Tag minimal>Audit Events</Tag>
                            {privilegedAuditDialog.events.map((event, index) => (
                                <div key={`${event.timestamp || "ts"}-${event.correlationId || "corr"}-${index}`}>
                                    <div className="bp6-text-small">
                                        <strong>{event.action || "unknown action"}</strong>
                                        {event.scope ? <> | scope: <code>{event.scope}</code></> : null}
                                        {typeof event.success === "boolean" ? <> | outcome: <code>{event.success ? "success" : "failure"}</code></> : null}
                                        {event.confirmationDecision ? <> | approval: <code>{event.confirmationDecision}</code></> : null}
                                    </div>
                                    <div className="bp6-text-small bp6-text-muted">
                                        Timestamp: <code>{event.timestamp || "unknown"}</code>
                                        {event.correlationId ? <> | Correlation ID: <code>{event.correlationId}</code></> : null}
                                    </div>
                                    {event.workflowId ? (
                                        <div className="bp6-text-small bp6-text-muted">
                                            Workflow: <code>{event.workflowId}</code>
                                            {event.workflowTitle ? <> | Title: <code>{event.workflowTitle}</code></> : null}
                                            {event.workflowKind ? <> | Kind: <code>{event.workflowKind}</code></> : null}
                                            {event.workflowStatus ? <> | Status: <code>{event.workflowStatus}</code></> : null}
                                        </div>
                                    ) : null}
                                    {event.stepId || event.stepTitle ? (
                                        <div className="bp6-text-small bp6-text-muted">
                                            Step: <code>{event.stepId || "unknown"}</code>
                                            {event.stepTitle ? <> | Title: <code>{event.stepTitle}</code></> : null}
                                            {event.stepStatus ? <> | Status: <code>{event.stepStatus}</code></> : null}
                                            {event.stepCorrelationId ? <> | Step correlation ID: <code>{event.stepCorrelationId}</code></> : null}
                                        </div>
                                    ) : null}
                                    {event.command ? (
                                        <div className="bp6-text-small bp6-text-muted">
                                            Command: <code>{[event.command, ...(Array.isArray(event.args) ? event.args : [])].join(" ").trim()}</code>
                                            {event.cwd ? <> | cwd: <code>{event.cwd}</code></> : null}
                                        </div>
                                    ) : null}
                                    {event.error?.code || event.error?.message ? (
                                        <div className="bp6-text-small bp6-text-muted">
                                            Error: <code>{event.error?.code || "unknown"}</code>
                                            {event.error?.message ? <> | {event.error.message}</> : null}
                                        </div>
                                    ) : null}
                                </div>
                            ))}
                        </div>
                    ) : null}
                </div>
                <div className="bp6-dialog-footer">
                    <div className="bp6-dialog-footer-actions">
                        <Button intent="primary" onClick={() => setPrivilegedAuditDialog((prev) => ({...prev, open: false}))}>Close</Button>
                    </div>
                </div>
            </Dialog>
            <Suspense fallback={null}>
                <SettingsDialog setShowSettingsDialog={setShowSettingsDialog} showSettingsDialog={showSettingsDialog} />
                <AiChatDialog setShowAiChatDialog={setShowAiChatDialog} showAiChatDialog={showAiChatDialog} />
            </Suspense>
        </div>
    </HotkeysTarget>
    );
}
