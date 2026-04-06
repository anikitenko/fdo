import React, {lazy, Suspense, useCallback, useEffect, useRef, useState} from 'react'
import classNames from "classnames";
import {
    Alignment,
    Button,
    Dialog,
    HotkeysTarget,
    Icon,
    InputGroup,
    Navbar,
    NavbarDivider,
    NavbarGroup,
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

// Lazy load settings dialog (only needed when opened)
const SettingsDialog = lazy(() => import("./components/settings/SettingsDialog.jsx").then(m => ({default: m.SettingsDialog})));
const AiChatDialog = lazy(() => import("./components/ai-chat/AiChatDialog.jsx").then(m => ({default: m.AiChatDialog})));

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
    });

    const buttonMenuRef = useRef(null)
    const prevPluginReadinessRef = useRef(new Map());
    const selectedPluginRef = useRef("");
    const pluginLastActivationMsRef = useRef(new Map());
    const pendingActivationStartedAtRef = useRef(new Map());
    const pluginToastDedupRef = useRef(new Map());
    const pendingDeactivateTimersRef = useRef(new Map());

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
                    icon: <Icon icon={plugin.icon} size={24}/>,
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
            // Remove only "navigate-active-" actions for plugins that are no longer active
            const filteredActions = prev.filter(action =>
                !action.id.startsWith("navigate-active-") ||
                state.activePlugins.some(plugin => new RegExp(`^navigate-active-.*-${plugin.id}$`).test(action.id))
            );
            if (state.activePlugins.length === 0) {
                return filteredActions.filter(action => !action.id.startsWith("navigate-active-"));
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

        const result = await window.electron.plugin.getRuntimeStatus(ids);
        if (!result?.success || !Array.isArray(result.statuses)) return;

        const statusById = new Map(result.statuses.map((item) => [item.id, item]));
        setPluginReadiness((prev) => {
            const next = new Map(prev);
            result.statuses.forEach((status) => {
                if (status?.id && status.ready) {
                    next.set(status.id, true);
                }
            });
            return next;
        });
        setPluginInitStatus((prev) => {
            const next = new Map(prev);
            result.statuses.forEach((status) => {
                if (status?.id && status.inited) {
                    next.set(status.id, true);
                }
            });
            return next;
        });
        setState(prevState => ({
            ...prevState,
            activePlugins: prevState.activePlugins.map((plugin) => {
                const runtimeStatus = statusById.get(plugin.id);
                if (!runtimeStatus) return plugin;
                return {
                    ...plugin,
                    loading: !!runtimeStatus.loading || (!runtimeStatus.loaded && !runtimeStatus.ready),
                };
            })
        }));
    };

    const pluginsInitialLoad = useRef(false);
    const refreshPluginsState = useCallback(async () => {
        const [allPlugins, activePlugins] = await Promise.all([
            window.electron.plugin.getAll(),
            window.electron.plugin.getActivated(),
        ]);

        const allPluginRecords = (allPlugins?.plugins || []).map((plugin) => ({
            ...plugin,
            ...plugin.metadata,
            capabilities: Array.isArray(plugin.capabilities) ? plugin.capabilities : [],
            loading: true,
        }));
        const activatedIds = new Set(activePlugins?.plugins || []);

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

    useEffect(() => {
        syncActivePluginLoadingState(state.activePlugins);
    }, [state.activePlugins.length]);

    useEffect(() => {
        if (selectedPluginStatusMessage) return;

        const activeIds = state.activePlugins.map((item) => item.id).filter(Boolean);
        if (activeIds.length === 0) {
            return;
        }

        if (!plugin) {
            handlePluginChange(activeIds[0]);
        }
    }, [plugin, state.activePlugins, selectedPluginStatusMessage]);

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
            const result = await window.electron.system.openPluginLogs();
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
            if (quickActions) {
                quickActions.forEach((action) => {
                    setSearchActions((prev) => {
                        if (prev.some(a => a.id === `navigate-active-${generateActionId(action.name)}-${id}`)) return prev;

                        return [
                            ...prev,
                            {
                                id: `navigate-active-${generateActionId(action.name)}-${id}`,
                                name: action.name,
                                subtitle: action.subtitle,
                                keywords: action.name + action.subtitle,
                                icon: <Icon icon={action.icon ? action.icon : "dot"} size={16}/>,
                                perform: () => {
                                    console.log(action.message_type)
                                },
                                section: state.activePlugins.some(item => item.id === id).name,
                            }
                        ];
                    });
                })
            }
            if (sidePanelActions) {
                setSideBarActionItems((prevState) => {
                    if (prevState.some(a => a.id === id)) return prevState;
                    return [
                        ...prevState,
                        {
                            id,
                            icon: sidePanelActions.icon,
                            name: sidePanelActions.label,
                            submenu_list: sidePanelActions.submenu_list
                        }
                    ]
                })
            }
        }

        const onPluginLoaded = (loadedPlugin) => {
            if (isProcessingPluginFromEditor.current) return;
            isProcessingPluginFromEditor.current = true;
            if (loadedPlugin) {
                window.electron.plugin.get(loadedPlugin).then((loadedPlugin) => {
                    const newPlugin = {...loadedPlugin.plugin, ...loadedPlugin.plugin.metadata, loading: true};
                    setState(prevState => {
                        // Check if plugin already exists
                        const pluginExists = prevState.plugins.some(item => item.id === newPlugin.id);

                        if (pluginExists) {
                            // Keep UX stable when plugin is redeployed from editor:
                            // don't force a deselect/reselect cycle that can blank the view.
                            selectPlugin(newPlugin, {open: true});
                            return prevState;
                        }

                        selectPlugin(newPlugin, {open: true});
                        return {
                            ...prevState,
                            plugins: [...prevState.plugins, newPlugin]
                        };
                    });
                })
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

    const handlePluginChange = (newPlugin) => {
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
    };

    useEffect(() => {
        window.__homeTestApi = {
            openPluginById: (pluginId) => handlePluginChange(pluginId),
            getSelectedPlugin: () => selectedPluginRef.current,
            getActivePluginIds: () => state.activePlugins.map((item) => item.id),
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
        return () => {
            for (const timerId of pendingDeactivateTimersRef.current.values()) {
                clearTimeout(timerId);
            }
            pendingDeactivateTimersRef.current.clear();
            if (window.__homeTestApi) {
                delete window.__homeTestApi;
            }
        };
    }, [state.activePlugins, state.plugins]);

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
        });
        setCapabilityDeniedNotice((prev) => ({...prev, open: false}));
    };

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

    const selectedPluginRecord = state.activePlugins.find((item) => item.id === plugin)
        || state.plugins.find((item) => item.id === plugin)
        || null;
    const selectedPluginLabel = selectedPluginRecord?.name || plugin || "";

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
            <div className={classNames("bp6-dark", styles["main-container"])}>
                {state.activePlugins.length > 0 && (
                    <SideBar position={"left"} menuItems={state.activePlugins} click={handlePluginChange} activeItemId={plugin}/>
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
                        />
                        {selectedPluginLabel && (
                            <Tag
                                minimal={true}
                                intent="primary"
                                icon={selectedPluginRecord?.icon || "cube"}
                                className={styles["active-plugin-tag"]}
                                title={`Loaded plugin: ${selectedPluginLabel}`}
                                data-active-plugin={plugin}
                            >
                                {selectedPluginLabel}
                            </Tag>
                        )}
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
                    <SideBar position={"right"} menuItems={sideBarActionItems} click={handleSideBarItemsClick}/>
                )}
                <div style={{
                    marginLeft: (state.plugins.length > 0 ? "50px" : ""),
                    marginRight: (showRightSideBar ? "50px" : "")
                }}>
                    {plugin && <PluginContainer
                        key={plugin}
                        plugin={plugin}
                        onStageChange={setSelectedPluginLifecycleStage}
                        onCapabilityDenied={(payload) => {
                            const missingCapabilities = Array.isArray(payload?.missingCapabilities)
                                ? payload.missingCapabilities
                                : [];
                            const missingCapabilityDiagnostics = Array.isArray(payload?.missingCapabilityDiagnostics)
                                ? payload.missingCapabilityDiagnostics
                                : parseMissingCapabilityDiagnosticsFromError(payload?.details || payload?.error || "");
                            const details = String(payload?.details || payload?.error || "Capability denied.");
                            setCapabilityDeniedNotice({
                                open: true,
                                pluginId: payload?.pluginId || plugin,
                                missingCapabilities,
                                missingCapabilityDiagnostics,
                                details,
                            });
                        }}
                    />}
                </div>
            <NotificationsPanel notificationsShow={notificationsShow} setNotificationsShow={setNotificationsShow} notifications={notifications} />
            <Dialog
                isOpen={capabilityDeniedNotice.open}
                onClose={() => setCapabilityDeniedNotice((prev) => ({...prev, open: false}))}
                title="Permission Required"
                canEscapeKeyClose={true}
                canOutsideClickClose={true}
            >
                <div className="bp6-dialog-body">
                    <p>
                        Plugin <code>{capabilityDeniedNotice.pluginId || "unknown"}</code> requested a privileged action that is not currently granted.
                    </p>
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
                        {capabilityDeniedNotice.missingCapabilities?.length === 0 && (
                            <Tag minimal>Not parsed from host message</Tag>
                        )}
                    </div>
                    <div className="bp6-text-small bp6-text-muted">
                        {capabilityDeniedNotice.details}
                    </div>
                </div>
                <div className="bp6-dialog-footer">
                    <div className="bp6-dialog-footer-actions">
                        <Button onClick={handleCopyCapabilityDeniedDetails}>Copy Details</Button>
                        <Button intent="primary" onClick={handleOpenCapabilitiesFromDenied}>Open Capabilities</Button>
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
