import {Callout, Classes, Divider, Intent, ProgressBar, Tab, Tabs} from "@blueprintjs/core";
import React from "react";
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
    });
    const totalMarkers = markers.reduce((acc, marker) => {
        return acc + marker.markers.length
    }, 0)

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
                    <Tab id="output" title="Build"/>
                    <Tab id="tests" title="Tests"/>
                    <Tab
                        id="ai-agent"
                        title="AI Coding Agent"
                        tagContent={aiActivity.isLoading ? "..." : undefined}
                        tagProps={aiActivity.isLoading ? { intent: "primary" } : undefined}
                    />
                </Tabs>
                <Divider/>
            </div>
            {selectedTabId !== "ai-agent" && (aiActivity.isLoading || aiActivity.error) && (
                <Callout
                    style={{margin: "10px", borderRadius: "5px"}}
                    intent={aiActivity.error ? "danger" : "primary"}
                    icon={aiActivity.error ? "error" : "time"}
                >
                    <div className={Classes.HEADING}>
                        {aiActivity.error ? "AI Coding Agent Error" : "AI Coding Agent Running"}
                    </div>
                    <div>{aiActivity.error || aiActivity.latestStatus || "Processing your request..."}</div>
                </Callout>
            )}
            {selectedTabId === "problems" && (<ProblemsPanel markers={markers}/>)}
            {selectedTabId === "output" && (<OutputPanel intent={buildOutputIntent} entries={buildOutput} emptyMessage="Build output will be here..." />)}
            {selectedTabId === "tests" && (<OutputPanel intent={testOutputIntent} entries={testOutput} emptyMessage="Test output will be here..." />)}
            <div
                className={styles["build-output-panel"]}
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
                                <span style={{color: m.error ? "red" : "white", whiteSpace: "pre-wrap"}}>{m.message}</span>
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
