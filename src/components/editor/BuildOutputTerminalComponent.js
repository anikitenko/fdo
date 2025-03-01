import {Callout, Classes, Divider, InputGroup, Tab, Tabs, TabsExpander, Text} from "@blueprintjs/core";
import {useEffect, useState} from 'react';
import virtualFS from "./utils/VirtualFS";
import {PropTypes} from 'prop-types';
import styles from "./EditorPage.module.css";

const BuildOutputTerminalComponent = () => {
    const [markers, setMarkers] = useState(virtualFS.tabs.listMarkers())
    const [selectedTabId, setSelectedTabId] = useState("problems")
    const totalMarkers = markers.reduce((acc, marker) => {
        return acc + marker.markers.length
    }, 0)

    useEffect(() => {
        const unsubscribe = virtualFS.notifications.subscribe("listMarkers", setMarkers)

        return () => {
            unsubscribe()
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
                    <Tab id="codeReference" title="Code reference"/>
                    <Tab id="terminal" title="Terminal"/>
                    <TabsExpander/>
                    <InputGroup placeholder="Search..." type="search" round={false}/>
                </Tabs>
                <Divider/>
            </div>
            {selectedTabId === "problems" && (<ProblemsPanel markers={markers}/>)}
            {selectedTabId === "output" && (<OutputPanel/>)}
            {selectedTabId === "codeReference" && (<CodeReferencePanel/>)}
            {selectedTabId === "terminal" && (<TerminalPanel/>)}
        </div>
    )
}

const ProblemsPanel = ({markers}) => {
    console.log(markers)
    return (
        <div className={styles["build-output-panel"]}>
            {markers?.length === 0 && <div className={styles["build-output"]}>
                <div className={styles["build-output-text"]}>
                    <Text>No problems found</Text>
                </div>
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
    markers: PropTypes.any
}

const OutputPanel = () => {
    return (
        <div className={styles["build-output-panel"]}>
            <div className={styles["build-output"]}>
                <div className={styles["build-output-text"]}>
                    <span>Output</span>
                </div>
            </div>
        </div>
    )
}

const CodeReferencePanel = () => {
    return (
        <div className={styles["build-output-panel"]}>
            <div className={styles["build-output"]}>
                <div className={styles["build-output-text"]}>
                    <span>Code reference</span>
                </div>
            </div>
        </div>
    )
}

const TerminalPanel = () => {
    return (
        <div className={styles["build-output-panel"]}>
            <div className={styles["build-output"]}>
                <div className={styles["build-output-text"]}>
                    <span>Terminal</span>
                </div>
            </div>
        </div>
    )
}

export default BuildOutputTerminalComponent;