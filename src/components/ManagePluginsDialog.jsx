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
                    }
                ];
            }, []);

            return [...prev, ...newActions];
        });
    }, [sortedPlugins, activePlugins]);

    useEffect(() => {
        if (!show) return;
        window.electron.plugin.getScopePolicies().then((result) => {
            if (result?.success) {
                setScopePolicies(Array.isArray(result.scopes) ? result.scopes : []);
                return;
            }
            setScopePolicies([]);
        }).catch(() => {
            setScopePolicies([]);
        });
    }, [show]);

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
                                     <Icon icon={plugin.icon} intent={"primary"}/>
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
                                                    selectPlugin={selectPlugin}
                                                    deselectPlugin={deselectPlugin} removePlugin={removePlugin}
                                                    setSelectedTabId={setSelectedTabId}
                                                    selectedTabId={selectedTabId} setSortedPlugins={setSortedPlugins}
                                                    scopePolicies={scopePolicies}
                                                    refreshPluginsState={refreshPluginsState}
                                                    highlightedCapabilityIds={
                                                        focusRequest?.pluginId === plugin.id
                                                            ? (Array.isArray(focusRequest?.capabilityIds) ? focusRequest.capabilityIds : [])
                                                            : []
                                                    }
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
    focusRequest: PropTypes.shape({
        requestId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
        pluginId: PropTypes.string,
        capabilityIds: PropTypes.array,
    }),
}

const SelectPluginPanel = ({
                               plugin,
                               activePlugins,
                               deselectPlugin,
                               selectPlugin,
                               removePlugin,
                               setSelectedTabId,
                               selectedTabId,
                               setSortedPlugins,
                               scopePolicies,
                               refreshPluginsState,
                               highlightedCapabilityIds,
                           }) => {
    const BASE_PRIVILEGED_CAPABILITIES = ["system.hosts.write", "system.process.exec"];
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

    const [exportProgress, setExportProgress] = useState(false)

    useEffect(() => {
        setCapabilitiesDraft(Array.isArray(plugin?.capabilities) ? plugin.capabilities : []);
    }, [plugin?.id, plugin?.capabilities]);

    const hasCapability = (capability) => capabilitiesDraft.includes(capability);

    const setCapability = (capability, checked) => {
        const scopeItem = scopeCapabilities.find((item) => item.capability === capability);
        setCapabilitiesDraft((prev) => applyCapabilityToggle(prev, {
            capability,
            checked,
            baseCapability: scopeItem?.baseCapability || capability,
        }));
    };

    const scopeCapabilities = useMemo(() => buildScopeCapabilities(scopePolicies), [scopePolicies]);
    const scopeCapabilitiesByBase = useMemo(() => {
        return BASE_PRIVILEGED_CAPABILITIES.reduce((groups, baseCapability) => {
            groups[baseCapability] = scopeCapabilities.filter((item) => item.baseCapability === baseCapability);
            return groups;
        }, {});
    }, [scopeCapabilities]);
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
                scopeCapabilitiesByBase[baseCapability] || [],
            );
            return groups;
        }, {});
    }, [capabilitiesDraft, scopeCapabilitiesByBase]);
    const highlightedSet = useMemo(
        () => new Set(Array.isArray(highlightedCapabilityIds) ? highlightedCapabilityIds : []),
        [highlightedCapabilityIds]
    );
    const hasUnsavedCapabilityChanges = useMemo(
        () => hasCapabilitySelectionChanges(plugin?.capabilities, capabilitiesDraft),
        [plugin?.capabilities, capabilitiesDraft]
    );

    const saveCapabilities = async () => {
        setIsSavingCapabilities(true);
        try {
            const nextCapabilities = [...new Set(capabilitiesDraft)];
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
        } finally {
            setIsSavingCapabilities(false);
        }
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
                        Loaded from: <i className={"bp6-heading"}>{plugin.home}</i>
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
                <Divider style={{marginTop: "10px", marginBottom: "10px"}}/>
                {BASE_PRIVILEGED_CAPABILITIES.map((baseCapability) => {
                    const groupedScopes = scopeCapabilitiesByBase[baseCapability] || [];
                    const baseEnabled = !!baseCapabilityEnabled[baseCapability];

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
                            {groupedScopes.map((scopeItem) => (
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
                                        label={getCapabilityPresentation(scopeItem.capability, scopePolicies).title}
                                        onChange={(event) => setCapability(scopeItem.capability, event.target.checked)}
                                    />
                                    <div className={classNames("bp6-text-small", "bp6-text-muted")}>
                                        {getCapabilityPresentation(scopeItem.capability, scopePolicies).description}
                                    </div>
                                    <div className={classNames("bp6-text-small", "bp6-text-muted")}>
                                        Technical ID: <code>{scopeItem.capability}</code>
                                    </div>
                                    <div className={classNames("bp6-text-small", "bp6-text-muted")}>
                                        Depends on: <code>{scopeItem.baseCapability}</code> | risk: {getCapabilityPresentation(scopeItem.capability, scopePolicies).risk}
                                    </div>
                                    {scopeItem.allowedRoots.length > 0 ? (
                                        <div className={classNames("bp6-text-small", "bp6-text-muted")}>
                                            Roots: {scopeItem.allowedRoots.join(", ")}
                                        </div>
                                    ) : null}
                                    {scopeItem.allowedOperationTypes.length > 0 ? (
                                        <div className={classNames("bp6-text-small", "bp6-text-muted")}>
                                            Ops: {scopeItem.allowedOperationTypes.join(", ")} | confirm: {scopeItem.requireConfirmation ? "required" : "no"}
                                        </div>
                                    ) : null}
                                    {scopeItem.allowedExecutables.length > 0 ? (
                                        <div className={classNames("bp6-text-small", "bp6-text-muted")}>
                                            Commands: {scopeItem.allowedExecutables.join(", ")}
                                        </div>
                                    ) : null}
                                    {scopeItem.allowedCwdRoots.length > 0 ? (
                                        <div className={classNames("bp6-text-small", "bp6-text-muted")}>
                                            CWD roots: {scopeItem.allowedCwdRoots.join(", ")}
                                        </div>
                                    ) : null}
                                    {scopeItem.allowedEnvKeys.length > 0 ? (
                                        <div className={classNames("bp6-text-small", "bp6-text-muted")}>
                                            Env keys: {scopeItem.allowedEnvKeys.join(", ")}
                                            {scopeItem.timeoutCeilingMs ? ` | timeout max: ${scopeItem.timeoutCeilingMs}ms` : ""}
                                            {" | "}
                                            confirm: {scopeItem.requireConfirmation ? "required" : "no"}
                                        </div>
                                    ) : null}
                                </Card>
                            ))}
                            {!baseEnabled && (selectedScopeCapabilitiesByBase[baseCapability] || []).length > 0 ? (
                                <Card style={{border: "1px solid #f6d667", background: "#fff8db", marginTop: "8px"}}>
                                    <div className={classNames("bp6-text-small")} style={{marginBottom: "8px"}}>
                                        Scoped capabilities are present, but base privileged access is disabled.
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
                            {baseEnabled && groupedScopes.length > 0 && (selectedScopeCapabilitiesByBase[baseCapability] || []).length === 0 ? (
                                <Card style={{border: "1px solid #f6d667", background: "#fff8db", marginTop: "8px"}}>
                                    <div className={classNames("bp6-text-small")}>
                                        {baseCapability === "system.process.exec"
                                            ? "Base tool execution is enabled, but no process scopes are granted yet. Both are required for process execution requests."
                                            : "Base privileged access is enabled, but no filesystem scopes are granted yet. Both are required for scoped filesystem requests."}
                                    </div>
                                </Card>
                            ) : null}
                        </Card>
                    );
                })}
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
                            tickFormatter={useMemo(() => (tick) =>
                                    new Date(tick).toLocaleTimeString("en-GB", {hour: "2-digit", minute: "2-digit"})
                                , [])}
                            domain={["auto", "auto"]}
                            xAxisId="0"
                        />

                        {/* Left Y-Axis (Memory MB) */}
                        <YAxis yAxisId="left" domain={[0.01, "auto"]} unit=" MB"/>

                        {/* Right Y-Axis (CPU %, Idle Wakeups) */}
                        <YAxis yAxisId="right" orientation="right" domain={[0, "auto"]}/>

                        {/* Tooltip */}
                        <Tooltip labelFormatter={useMemo(() => (label) =>
                                new Date(label).toLocaleString("en-GB", {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                    second: "2-digit"
                                })
                            , [])}/>

                        {/* Legend */}
                        <Legend verticalAlign="top" layout="horizontal" align="center"
                                wrapperStyle={{paddingBottom: "15px"}}/>

                        {/* Render Lines with Static Colors */}
                        {useMemo(() => Object.entries(selectedLines).map(([metricKey, isVisible]) =>
                                isVisible && (
                                    <Line
                                        key={metricKey}
                                        yAxisId={metricKey.includes("CPU") || metricKey.includes("Idle") ? "right" : "left"}
                                        type="monotone"
                                        dataKey={metricKey}
                                        stroke={METRIC_COLORS[metricKey] || METRIC_COLORS["Other"]}
                                        strokeWidth={2}
                                        name={metricKey}
                                        animationDuration={800}
                                    />
                                )
                        ), [selectedLines])}
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
    activePlugins: PropTypes.array,
    selectPlugin: PropTypes.func,
    deselectPlugin: PropTypes.func,
    removePlugin: PropTypes.func,
    setSelectedTabId: PropTypes.func,
    selectedTabId: PropTypes.string,
    setSortedPlugins: PropTypes.func,
    scopePolicies: PropTypes.array,
    refreshPluginsState: PropTypes.func,
    highlightedCapabilityIds: PropTypes.array,
}
