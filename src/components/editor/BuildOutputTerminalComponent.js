import {Callout, Classes, Divider, Intent, ProgressBar, Tab, Tabs} from "@blueprintjs/core";
import {useEffect, useRef, useState} from 'react';
import virtualFS from "./utils/VirtualFS";
import {PropTypes} from 'prop-types';
import styles from "./EditorPage.module.css";
import {AppToaster} from "../AppToaster.jsx";

const BuildOutputTerminalComponent = ({selectedTabId, setSelectedTabId}) => {
    const [markers, setMarkers] = useState(virtualFS.tabs.listMarkers())
    const [buildOutputStatus, setBuildOutputStatus] = useState(virtualFS.build.status())
    const [buildOutput, setBuildOutput] = useState([])
    const [buildOutputIntent, setBuildOutputIntent] = useState("primary")
    const totalMarkers = markers.reduce((acc, marker) => {
        return acc + marker.markers.length
    }, 0)

    useEffect( () => {
        if (buildOutputStatus) {
            const isErrorIntent = buildOutputStatus.message.error ? Intent.DANGER : Intent.PRIMARY;
            if (buildOutputStatus.message.message) {
                setBuildOutput((prevState) => [...prevState, buildOutputStatus.message])
                if (buildOutputStatus.message.error) {
                    setBuildOutputIntent("danger")
                } else {
                    setBuildOutputIntent("primary")
                }
            }
            if (buildOutputStatus.inProgress) {
                (AppToaster).show({
                    icon: "build",
                    message: (
                        <ProgressBar
                            intent={buildOutputStatus.progress < 100 ? isErrorIntent : Intent.SUCCESS}
                            value={buildOutputStatus.progress / 100}
                        />
                    ),
                    timeout: 60000
                }, 'build-output')
            } else {
                (AppToaster).dismiss('build-output')
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
                    renderActiveTabPanelOnly={true}
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
                    <Tab id="output" title="Output"/>
                </Tabs>
                <Divider/>
            </div>
            {selectedTabId === "problems" && (<ProblemsPanel markers={markers}/>)}
            {selectedTabId === "output" && (<OutputPanel buildOutputIntent={buildOutputIntent} buildOutput={buildOutput}/>)}
        </div>
    )
}
BuildOutputTerminalComponent.propTypes = {
    selectedTabId: PropTypes.string.isRequired,
    setSelectedTabId: PropTypes.func.isRequired
}

const ProblemsPanel = ({markers}) => {
    return (
        <div className={styles["build-output-panel"]}>
            {markers?.length === 0 && <div className={styles["build-output"]}>
                <Callout style={{margin: "10px", borderRadius: "5px"}} intent="success">
                    <div>
                        <span className={Classes.HEADING}>No problems found</span>
                    </div>
                </Callout>
            </div>}
            {markers?.map((marker) => {
                return (
                    <div key={marker.id}>
                        {marker.markers.map((m) => {
                            return (
                                <Callout key={marker.id + m.startLineNumber + m.startColumn}
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

const OutputPanel = ({buildOutputIntent, buildOutput}) => {
    const outputRef = useRef(null);
    useEffect(() => {
        if (outputRef.current) {
            outputRef.current.scrollTo({top: outputRef.current.scrollHeight, behavior: "smooth"});
        }
    }, [buildOutput]);
    return (
        <div ref={outputRef} className={styles["build-output-panel"]}>
            <div className={styles["build-output"]}>
                <Callout style={{margin: "10px", borderRadius: "5px"}} intent={buildOutputIntent}>
                    {buildOutput.length === 0 && <div>
                        <span>Build output will be here...</span>
                    </div>}
                    {buildOutput.length > 0 && buildOutput.map((m, i) => {
                        return (
                            <div key={i+1}>
                                <span style={{color: m.error ? "red" : "white"}}>{m.message}</span>
                            </div>
                        )
                    })}
                </Callout>
            </div>
        </div>
    )
}
OutputPanel.propTypes = {
    buildOutputIntent: PropTypes.string.isRequired,
    buildOutput: PropTypes.array
}

export default BuildOutputTerminalComponent;