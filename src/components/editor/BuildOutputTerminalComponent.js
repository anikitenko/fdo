import {Callout, Classes, Divider, Intent, Popover, ProgressBar, Tab, Tabs} from "@blueprintjs/core";
import React from "react";
import {AnsiOutput} from "./AnsiOutput";
import {useEffect, useRef, useState} from 'react';
import virtualFS from "./utils/VirtualFS";
import {PropTypes} from 'prop-types';
import * as styles from "./EditorPage.module.css";
import {AppToaster} from "../AppToaster.jsx";
import {v4 as uuidv4} from 'uuid';
import AiCodingAgentPanel from "./AiCodingAgentPanel.jsx";

function formatHistoryTimestamp(ts) {
    if (!ts) return "";
    try {
        return new Date(ts).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
        });
    } catch {
        return "";
    }
}

function withToaster(callback) {
    Promise.resolve(AppToaster)
        .then((toaster) => {
            if (toaster) {
                callback(toaster);
            }
        })
        .catch(() => {});
}

const ActivityDots = ({testId}) => (
    <span className={styles["ai-activity-dots"]} data-testid={testId} aria-hidden="true">
        <span/><span/><span/>
    </span>
);

function formatAiActivityElapsed(elapsedMs = 0) {
    const totalSeconds = Math.max(0, Math.floor(Number(elapsedMs || 0) / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = String(totalSeconds % 60).padStart(2, "0");
    return minutes > 0 ? `${minutes}m ${seconds}s` : `${totalSeconds}s`;
}

const ActivityStatusPopover = ({activity, label, testId, stageTiming = false}) => (
    <div className={styles["ai-agent-status-popover"]} data-testid={testId} role="dialog" aria-label={`${label} status`}>
        <div className={styles["ai-agent-status-popover-heading"]}>
            <strong>{activity.error ? `${label} Error` : (activity.isLoading ? activity.stage || "Working on your request" : activity.stage || "Finished")}</strong>
            {(stageTiming || !activity.error) && <time>{stageTiming ? "Stage: " : ""}{formatAiActivityElapsed(stageTiming ? activity.stageElapsedMs : activity.elapsedMs)} elapsed</time>}
        </div>
        <p role="status" aria-live="polite" aria-atomic="true">{activity.error || activity.latestStatus || (activity.isLoading ? "Processing your request…" : "No work is running.")}</p>
    </div>
);

const ActivityTabTitle = ({activity, label, id}) => {
    const [isOpen, setIsOpen] = useState(false);
    const lastRunningActivity = useRef(activity);
    if (activity.isLoading) lastRunningActivity.current = activity;
    const displayedActivity = activity.isLoading ? activity : {...activity, elapsedMs: lastRunningActivity.current.elapsedMs,
        stageElapsedMs: activity.stageElapsedMs ?? lastRunningActivity.current.stageElapsedMs};
    return (
    <span className={styles["ai-agent-tab-title"]}>
        <span>{label}</span>
        {(activity.isLoading || isOpen) && (
            <span
                onClick={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") event.stopPropagation();
                }}
                onKeyPress={(event) => {
                    // Tabs treats keypress as tab selection. Leave the button's
                    // native activation intact without selecting its parent tab.
                    if (event.key === "Enter" || event.key === " ") event.stopPropagation();
                }}
            >
                <Popover
                    content={<ActivityStatusPopover activity={displayedActivity} label={label} testId={`${id}-status-popover`} stageTiming={id === "ai-agent"}/>}
                    isOpen={isOpen}
                    onInteraction={setIsOpen}
                    interactionKind="click"
                    placement="bottom"
                    popupKind="dialog"
                    canEscapeKeyClose={true}
                    // Native buttons already synthesize clicks for Enter/Space.
                    targetProps={{onKeyDown: undefined}}
                    popoverClassName={styles["ai-agent-status-popover-surface"]}
                    usePortal={true}
                >
                    <button
                        type="button"
                        aria-label={`Show ${label} status`}
                        className={`${styles["ai-agent-status-trigger"]} ${id === "ai-agent" ? styles["ai-agent-status-trigger-with-time"] : ""}`}
                        aria-describedby={id === "ai-agent" ? `${id}-overall-elapsed` : undefined}
                        data-testid={`${id}-status-trigger`}
                    >
                        {activity.isLoading ? <ActivityDots testId={`${id}-working-dots`}/> : <span aria-hidden="true">•</span>}
                        {id === "ai-agent" && (
                            <time id={`${id}-overall-elapsed`} className={styles["ai-agent-overall-elapsed"]}>
                                Overall: {formatAiActivityElapsed(displayedActivity.elapsedMs)}
                            </time>
                        )}
                    </button>
                </Popover>
            </span>
        )}
    </span>
    );
};

const BuildOutputTerminalComponent = ({selectedTabId, setSelectedTabId, codeEditor}) => {
    const [markers, setMarkers] = useState(virtualFS.tabs.listMarkers());
    const [buildOutputStatus, setBuildOutputStatus] = useState(virtualFS.build.status());
    const [buildOutput, setBuildOutput] = useState(virtualFS.build.getHistory(80, "build"));
    const [testOutput, setTestOutput] = useState(virtualFS.build.getHistory(80, "test"));
    const [buildOutputIntent, setBuildOutputIntent] = useState("primary");
    const [testOutputIntent, setTestOutputIntent] = useState("primary");
    const [codingAiResponse, setCodingAiResponse] = useState("");
    const [aiActivity, setAiActivity] = useState({
        isLoading: false,
        hasResponse: false,
        error: "",
        latestStatus: "",
        stage: "",
        elapsedMs: 0,
    });
    const totalMarkers = markers.reduce((acc, marker) => {
        return acc + marker.markers.length
    }, 0)
    const isTestRunning = buildOutputStatus?.inProgress && buildOutputStatus?.message?.kind === "test";
    const isBuildRunning = buildOutputStatus?.inProgress && !isTestRunning;

    const operationKind = isTestRunning ? "test" : isBuildRunning ? "build" : "";
    const [operationElapsedMs, setOperationElapsedMs] = useState(0);
    useEffect(() => {
        setOperationElapsedMs(0);
        if (!operationKind) return undefined;
        const startedAt = Date.now();
        const timer = setInterval(() => setOperationElapsedMs(Date.now() - startedAt), 1000);
        return () => clearInterval(timer);
    }, [operationKind]);
    const operationActivity = {
        isLoading: !!operationKind,
        stage: isTestRunning ? "Running plugin tests" : "Building plugin",
        latestStatus: buildOutputStatus?.message?.message || "",
        elapsedMs: operationElapsedMs,
    };

    useEffect( () => {
        if (buildOutputStatus) {
            const isErrorIntent = buildOutputStatus.message.error ? Intent.DANGER : Intent.PRIMARY;
            if (buildOutputStatus.message.message) {
                const nextBuildHistory = virtualFS.build.getHistory(80, "build");
                const nextTestHistory = virtualFS.build.getHistory(80, "test");
                setBuildOutput(nextBuildHistory);
                setTestOutput(nextTestHistory);
                if (buildOutputStatus.message.kind === "test") {
                    setTestOutputIntent(buildOutputStatus.message.error ? "danger" : "primary");
                } else {
                    setBuildOutputIntent(buildOutputStatus.message.error ? "danger" : "primary");
                }
            }
            if (buildOutputStatus.inProgress) {
                withToaster((toaster) => toaster.show?.({
                    icon: buildOutputStatus.message.kind === "test" ? "endorsed" : "build",
                    message: (
                        <ProgressBar
                            intent={buildOutputStatus.progress < 100 ? isErrorIntent : Intent.SUCCESS}
                            value={buildOutputStatus.progress / 100}
                        />
                    ),
                    timeout: 60000
                }, 'build-output'))
            } else {
                withToaster((toaster) => toaster.dismiss?.('build-output'))
            }
        }
    }, [buildOutputStatus]);

    useEffect(() => {
        const unsubscribe = virtualFS.notifications.subscribe("listMarkers", setMarkers)
        const unsubscribeBuildOutput = virtualFS.notifications.subscribe("buildOutputUpdate", setBuildOutputStatus)

        return () => {
            unsubscribe()
            unsubscribeBuildOutput()
        }
    }, []);
    return (
        <div className={styles["build-output-container"]}>
            <div className={styles["build-output-tabs-container"]}>
                {aiActivity.isLoading && <div className={styles["ai-activity-glow"]} aria-hidden="true"/>}
                <Tabs
                    animate={true}
                    id="CodeEditorTabs"
                    renderActiveTabPanelOnly={false}
                    key={"horizontal"}
                    vertical={false}
                    fill={true}
                    onChange={setSelectedTabId} selectedTabId={selectedTabId}
                >
                    <Tab id="problems" title="Problems" tagContent={totalMarkers} tagProps={
                        {
                            intent: (totalMarkers > 0 ? "danger" : "success")
                        }
                    }/>
                    <Tab
                        id="output"
                        title={<ActivityTabTitle label="Build" id="build" activity={{...operationActivity, isLoading: isBuildRunning, ...(!isBuildRunning ? {stage: "Build finished", latestStatus: ""} : {})}}/>}
                    />
                    <Tab
                        id="tests"
                        title={<ActivityTabTitle label="Test" id="test" activity={{...operationActivity, isLoading: isTestRunning, ...(!isTestRunning ? {stage: "Tests finished", latestStatus: ""} : {})}}/>}
                    />
                    <Tab
                        id="ai-agent"
                        title={<ActivityTabTitle label="AI Coding Agent" id="ai-agent" activity={aiActivity}/>}
                    />
                </Tabs>
                <Divider/>
            </div>
            {selectedTabId !== "ai-agent" && aiActivity.error && (
                <div
                    className={styles["ai-agent-activity-summary"]}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedTabId("ai-agent")}
                    onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setSelectedTabId("ai-agent");
                        }
                    }}
                    title="Open AI Coding Agent"
                >
                    <Callout
                        style={{margin: "10px", borderRadius: "5px"}}
                        intent="danger"
                        icon="error"
                    >
                    <div className={Classes.HEADING}>
                        AI Coding Agent Error
                    </div>
                    <div>{aiActivity.error}</div>
                    </Callout>
                </div>
            )}
            {selectedTabId === "problems" && (<ProblemsPanel markers={markers}/>)}
            {selectedTabId === "output" && (<OutputPanel intent={buildOutputIntent} entries={buildOutput} emptyMessage="Build output will be here..." />)}
            {selectedTabId === "tests" && (<OutputPanel intent={testOutputIntent} entries={testOutput} emptyMessage="Test output will be here..." />)}
            <div
                className={`${styles["build-output-panel"]} ${styles["ai-agent-panel-host"]}`}
                style={{ display: selectedTabId === "ai-agent" ? "block" : "none" }}
                aria-hidden={selectedTabId === "ai-agent" ? "false" : "true"}
            >
                <AiCodingAgentPanel codeEditor={codeEditor} response={codingAiResponse}
                                    setResponse={setCodingAiResponse}
                                    onActivityChange={setAiActivity}/>
            </div>
        </div>
    )
}
BuildOutputTerminalComponent.propTypes = {
    selectedTabId: PropTypes.string.isRequired,
    setSelectedTabId: PropTypes.func.isRequired,
    codeEditor: PropTypes.object,
}

const ProblemsPanel = ({markers}) => {
    return (
        <div className={styles["build-output-panel"]}>
            {markers?.length === 0 && <div>
                <Callout style={{margin: "10px", borderRadius: "5px"}} intent="success">
                    <div>
                        <span className={Classes.HEADING}>No problems found</span>
                    </div>
                </Callout>
            </div>}
            {markers?.map((marker) => {
                return (
                    <div key={`${uuidv4()}`}>
                        {marker.markers.map((m) => {
                            return (
                                <Callout key={`${m.id}-${uuidv4()}`}
                                         style={{margin: "10px", borderRadius: "5px"}} intent="danger">
                                    <div>
                                        <span className={Classes.HEADING}>{marker.id}</span>
                                    </div>
                                    <div>
                                        <code className={Classes.TEXT_SMALL}>{m.message}</code>
                                    </div>
                                    <div>
                                        <span>Start line: {m.startLineNumber}, End line: {m.endLineNumber}</span>
                                    </div>
                                    <div>
                                        <span>Start column: {m.startColumn}, End column: {m.endColumn}</span>
                                    </div>
                                </Callout>
                            )
                        })}
                    </div>
                )
            })}
        </div>
    )
}
ProblemsPanel.propTypes = {
    markers: PropTypes.array
}

const OutputPanel = ({intent, entries, emptyMessage}) => {
    const outputRef = useRef(null);
    useEffect(() => {
        if (outputRef.current && typeof outputRef.current.scrollTo === "function") {
            outputRef.current.scrollTo({top: outputRef.current.scrollHeight, behavior: "smooth"});
        }
    }, [entries]);
    return (
        <div ref={outputRef} className={styles["build-output-panel"]}>
            <div>
                <Callout style={{margin: "10px", borderRadius: "5px", wordBreak: "break-word"}} intent={intent}>
                    {entries.length === 0 && <div>
                        <span>{emptyMessage}</span>
                    </div>}
                    {entries.length > 0 && entries.map((m, i) => {
                        return (
                            <div key={`${i + 1}-${m.ts || i}`} style={{marginBottom: "8px"}}>
                                <div className={Classes.TEXT_SMALL} style={{opacity: 0.8}}>
                                    <span>{formatHistoryTimestamp(m.ts)}</span>
                                    <span style={{marginLeft: "8px"}}>{m.kind === "test" ? "TEST" : "BUILD"}</span>
                                </div>
                                <span style={{color: m.error ? "red" : "white", whiteSpace: "pre-wrap"}}><AnsiOutput text={m.message}/></span>
                            </div>
                        )
                    })}
                </Callout>
            </div>
        </div>
    )
}
OutputPanel.propTypes = {
    intent: PropTypes.string.isRequired,
    entries: PropTypes.array,
    emptyMessage: PropTypes.string.isRequired,
}

export default BuildOutputTerminalComponent;
