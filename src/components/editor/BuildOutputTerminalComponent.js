import AiCodingConfidence from '../ai/AiCodingConfidence';
import {Callout, Classes, Divider, Intent, PopoverNext as Popover, ProgressBar, Tab, Tabs} from "@blueprintjs/core";
import React from "react";
import AiTimeEstimate from '../ai/AiTimeEstimate';
import {AnsiOutput} from "./AnsiOutput";
import {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';
import virtualFS from "./utils/VirtualFS";
import PropTypes from 'prop-types';
import * as styles from "./EditorPage.module.css";
import {AppToaster} from "../AppToaster.jsx";
import {v4 as uuidv4} from 'uuid';
import AiCodingAgentPanel from "./AiCodingAgentPanel.jsx";
import AiAssistantWindow from './AiAssistantWindow';
import {formatElapsedDuration} from '../../utils/presentation/formatElapsedDuration';
import FdoAiMark from '../ai/FdoAiMark';

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

const ActivityStatusPopover = ({activity, label, testId, stageTiming = false, onClose}) => (
    <div className={styles["ai-agent-status-popover"]} data-testid={testId} role="dialog" aria-label={`${label} status`}>
        <button type="button" className={styles["ai-agent-status-popover-close"]}
                aria-label={`Close ${label} status`} title="Close" onClick={onClose}>
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
                <path d="M3 3l6 6M9 3l-6 6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
        </button>
        <div className={styles["ai-agent-status-popover-heading"]}>
            <strong>{activity.error ? `${label} Error` : (activity.isLoading ? activity.stage || "Working on your request" : activity.stage || "Finished")}</strong>
            {(stageTiming || !activity.error) && <time>{stageTiming ? "Stage: " : ""}{formatElapsedDuration(stageTiming ? activity.stageElapsedMs : activity.elapsedMs)} elapsed</time>}
        </div>
        <p role="status" aria-live="polite" aria-atomic="true">{activity.error || activity.latestStatus || (activity.isLoading ? "Processing your request…" : "No work is running.")}</p>
        <AiCodingConfidence confidence={activity.confidence}/>
        {activity.isLoading && <AiTimeEstimate text={activity.estimate} details={activity.estimateDetails} progress={activity.estimateProgress}/>}
    </div>
);

const ActivityTabTitle = ({activity, label, id, openRequest = 0, onLayoutChange}) => {
    const [isOpen, setIsOpen] = useState(false);
    const statusVisible = activity.isLoading || isOpen;
    // Blueprint measures the indicator on parent updates, but closing this
    // popover changes the tab width through local state alone.
    useLayoutEffect(() => {onLayoutChange?.();}, [statusVisible, onLayoutChange]);
    useEffect(() => {
        if (activity.guideReviewPending) setIsOpen(false);
    }, [activity.guideReviewPending]);
    useEffect(() => {
        if (openRequest && !activity.guideReviewPending) setIsOpen(true);
    }, [openRequest]);
    const lastRunningActivity = useRef(activity);
    if (activity.isLoading) lastRunningActivity.current = activity;
    const displayedActivity = activity.isLoading ? activity : {...activity, elapsedMs: lastRunningActivity.current.elapsedMs,
        stageElapsedMs: activity.stageElapsedMs ?? lastRunningActivity.current.stageElapsedMs};
    return (
    <span className={styles["ai-agent-tab-title"]}>
        {id === 'ai-agent' && <FdoAiMark size={20} active={activity.isLoading}
            data-testid={activity.isLoading ? `${id}-working-dots` : undefined} />}
        <span>{label}</span>
        {statusVisible && (
            <span
                onClick={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                    // Keep button activation from selecting its parent tab.
                    if (event.key === "Enter" || event.key === " ") event.stopPropagation();
                }}
                ref={(node) => {
                    if (!node) return;
                    // Blueprint Tabs still handles keypress. Keep native button
                    // activation without forwarding that event to the tab.
                    const stopTabActivation = (event) => {
                        if (event.key === "Enter" || event.key === " ") event.stopPropagation();
                    };
                    node.addEventListener("keypress", stopTabActivation);
                    return () => node.removeEventListener("keypress", stopTabActivation);
                }}
            >
                <Popover
                    content={<ActivityStatusPopover activity={displayedActivity} label={label} testId={`${id}-status-popover`} stageTiming={id === "ai-agent"} onClose={() => setIsOpen(false)}/>}
                    isOpen={isOpen && !activity.guideReviewPending}
                    onInteraction={nextOpen => setIsOpen(nextOpen && !activity.guideReviewPending)}
                    interactionKind="click"
                    placement="bottom"
                    popupKind="dialog"
                    canEscapeKeyClose={true}
                    shouldReturnFocusOnClose={!activity.guideReviewPending}
                    transitionDuration={activity.guideReviewPending ? 0 : 300}
                    // Native buttons already synthesize clicks for Enter/Space.
                    targetProps={{onKeyDown: undefined}}
                    popoverClassName={styles["ai-agent-status-popover-surface"]}
                    usePortal={true}
                >
                    <button
                        type="button"
                        disabled={!!activity.guideReviewPending}
                        aria-label={`Show ${label} status`}
                        className={`${styles["ai-agent-status-trigger"]} ${id === "ai-agent" ? styles["ai-agent-status-trigger-with-time"] : ""}`}
                        aria-describedby={id === "ai-agent" ? `${id}-overall-elapsed` : undefined}
                        data-testid={`${id}-status-trigger`}
                    >
                        {id !== 'ai-agent' && (activity.isLoading ? <ActivityDots testId={`${id}-working-dots`}/> : <span aria-hidden="true">•</span>)}
                        {id === "ai-agent" && (
                            <>
                                <time id={`${id}-overall-elapsed`} className={styles["ai-agent-overall-elapsed"]}
                                    aria-label={`Total elapsed time: ${formatElapsedDuration(displayedActivity.elapsedMs)}`}>
                                    {formatElapsedDuration(displayedActivity.elapsedMs, {compact: true})}
                                </time>
                                <svg className={styles["ai-agent-status-chevron"]} width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                                    <path d="m2 4 3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                            </>
                        )}
                    </button>
                </Popover>
            </span>
        )}
    </span>
    );
};

const BuildOutputTerminalComponent = ({selectedTabId, setSelectedTabId, codeEditor}) => {
    const [, setTabLayoutRevision] = useState(0);
    const refreshTabLayout = useCallback(() => setTabLayoutRevision(value => value + 1), []);
    const [markers, setMarkers] = useState(virtualFS.tabs.listMarkers());
    const [buildOutputStatus, setBuildOutputStatus] = useState(virtualFS.build.status());
    const [buildOutput, setBuildOutput] = useState(virtualFS.build.getHistory(80, "build"));
    const [testOutput, setTestOutput] = useState(virtualFS.build.getHistory(80, "test"));
    const [buildOutputIntent, setBuildOutputIntent] = useState("primary");
    const [testOutputIntent, setTestOutputIntent] = useState("primary");
    const [codingAiResponse, setCodingAiResponse] = useState("");
    const [activityOpenRequest, setActivityOpenRequest] = useState(0);
    const [selectionFocusRequest, setSelectionFocusRequest] = useState(0);
    const [deploymentReviewRequest,setDeploymentReviewRequest]=useState(null);
    useEffect(() => window.electron?.aiCodingAgent?.onOpenActivity?.(() => {
        setSelectedTabId('ai-agent');
        setActivityOpenRequest(value => value + 1);
    }), [setSelectedTabId]);
    useEffect(() => {
        const unsubscribe = virtualFS.notifications.subscribe('liveUiAiSelection', ({workspaceId,intent,prompt}) => {
        if (workspaceId !== virtualFS.sandboxName) return;
        if(intent==='deployment')setDeploymentReviewRequest({id:Date.now(),workspaceId,prompt});
        setSelectedTabId('ai-agent');
        setSelectionFocusRequest(value => value + 1);
        });
        return () => {unsubscribe();};
    }, [setSelectedTabId]);
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
                        <div>
                            <div>{buildOutputStatus.message.kind === 'test' ? 'Running plugin tests' : 'Building plugin'} · {buildOutputStatus.progress}%</div>
                            <div className="bp6-text-small">{String(buildOutputStatus.message.message || '').split('\n')[0].slice(0, 160)}</div>
                            <ProgressBar intent={buildOutputStatus.progress < 100 ? isErrorIntent : Intent.SUCCESS} value={buildOutputStatus.progress / 100}/>
                        </div>
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
            {aiActivity.isLoading && <div className={styles["ai-activity-glow"]} aria-hidden="true"/>}
            <div className={styles["build-output-tabs-container"]}>
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
                        title={<ActivityTabTitle label="Build" id="build" onLayoutChange={refreshTabLayout} activity={{...operationActivity, isLoading: isBuildRunning, ...(!isBuildRunning ? {stage: "Build finished", latestStatus: ""} : {})}}/>}
                    />
                    <Tab
                        id="tests"
                        title={<ActivityTabTitle label="Test" id="test" onLayoutChange={refreshTabLayout} activity={{...operationActivity, isLoading: isTestRunning, ...(!isTestRunning ? {stage: "Tests finished", latestStatus: ""} : {})}}/>}
                    />
                    <Tab
                        id="ai-agent"
                        title={<ActivityTabTitle label="AI Coding Agent" id="ai-agent" onLayoutChange={refreshTabLayout} activity={aiActivity} openRequest={activityOpenRequest}/>}
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
            {selectedTabId === "output" && (<OutputPanel intent={buildOutputIntent} entries={buildOutput} revealOnMount emptyMessage="Build output will be here..." />)}
            {selectedTabId === "tests" && (<OutputPanel intent={testOutputIntent} entries={testOutput} revealOnMount emptyMessage="Test output will be here..." />)}
            <AiAssistantWindow visible={selectedTabId === 'ai-agent'} focusRequest={activityOpenRequest + selectionFocusRequest} onReturnToTab={() => setSelectedTabId('ai-agent')}>
                {({eventDocument}) => <AiCodingAgentPanel codeEditor={codeEditor} response={codingAiResponse}
                                    selectionFocusRequest={selectionFocusRequest} deploymentReviewRequest={deploymentReviewRequest}
                                    setResponse={setCodingAiResponse}
                                    onActivityChange={setAiActivity}
                                    eventDocument={eventDocument}
                                    onShowTests={() => setSelectedTabId('tests')}/>}
            </AiAssistantWindow>
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

const OutputPanel = ({intent, entries, emptyMessage, revealOnMount = false}) => {
    const outputRef = useRef(null);
    useLayoutEffect(() => {
        if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }, [entries]);
    useLayoutEffect(() => {
        if (revealOnMount) outputRef.current?.scrollIntoView?.({block: "nearest", inline: "nearest"});
    }, [revealOnMount]);
    return (
        <div ref={outputRef} role="region" aria-label={revealOnMount ? "Plugin test output" : "Plugin build output"} className={styles["build-output-panel"]}>
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
    revealOnMount: PropTypes.bool,
    intent: PropTypes.string.isRequired,
    entries: PropTypes.array,
    emptyMessage: PropTypes.string.isRequired,
}

export default BuildOutputTerminalComponent;
