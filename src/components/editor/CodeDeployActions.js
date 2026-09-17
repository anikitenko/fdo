import {Alert, Button, ButtonGroup, Dialog, Divider, HTMLSelect, Switch} from "@blueprintjs/core";
import React, {useEffect, useRef, useState} from "react";
import SidebarSection from "../common/SidebarSection.jsx";

import {formatDistanceToNow} from 'date-fns';
import virtualFS from "./utils/VirtualFS";
import {IconNames} from "@blueprintjs/icons";
import * as styles from "./EditorPage.module.css";

import build from "./utils/build";
import runTests from "./utils/runTests";
import PropTypes from "prop-types";

import classnames from "classnames";
import {AppToaster} from "../AppToaster.jsx";
import {RootCertificateSelectionComponent, selectRootCert} from "./utils/RootCertificateSelectionComponent";

const CodeDeployActions = ({
    setSelectedTabId,
    currentSelectedTabId,
    pluginDirectory,
    renderOnLoadTemplates = [],
    renderOnLoadTemplateId = "",
    onRenderOnLoadTemplateIdChange = () => {},
    renderOnLoadStrictMode = true,
    onRenderOnLoadStrictModeChange = () => {},
    showRenderOnLoadStrictToggle = false,
    renderOnLoadTemplateApplying = false,
    onApplyRenderOnLoadTemplate = async () => {},
    renderOnLoadTemplateError = "",
    highlightRenderOnLoadRecommendation = false,
}) => {
    const [version, setVersion] = useState(virtualFS.fs.version())
    const [newVersion, setNewVersion] = useState(virtualFS.fs.version())
    const [versions, setVersions] = useState(virtualFS.fs.list())
    const [isOpenSwitch, setIsOpenSwitch] = useState(false)
    const [isLoadingSwitch, setIsLoadingSwitch] = useState(false)
    const [versionsDate, setVersionsDate] = useState(Date.now())
    const [prettyVersionDate, setPrettyVersionDate] = useState("")
    const [buildInProgress, setBuildInProgress] = useState(false)
    const [deployInProgress, setDeployInProgress] = useState(false)
    const [testsInProgress, setTestsInProgress] = useState(false)
    const [saveAndCloseInProgress, setSaveAndCloseInProgress] = useState(false)
    const [treeLoading, setTreeLoading] = useState(virtualFS.fs.getLoading())
    const [rootCertificates, setRootCertificates] = useState([])
    const [onRootCertificateSelected, setOnRootCertificateSelected] = useState(null)
    const [showRootCertificateDialog, setShowRootCertificateDialog] = useState(false)
    const [rememberedRootCertificate, setRememberedRootCertificate] = useState(null);
    const [showRenderOnLoadGuide, setShowRenderOnLoadGuide] = useState(false);

    const rememberChoiceRef = useRef(false);
    const versionText = (name, date, prev, pretty = false) => {
        if (!name) return
        if (!date) return
        return (
            <div style={{textAlign: "center"}}>
                <span style={{color: "aquamarine"}}>{name}</span>
                {prev && (
                    <div>
                        <span className={"bp6-text-muted bp6-text-small"}>
                            from <span style={{color: "aquamarine", textDecoration: "underline"}}>{prev}</span>
                        </span>
                    </div>
                )}
                <Divider/>
                <span
                    className={"bp6-text-muted"}>
                    {"(" + (pretty ? date : formatDistanceToNow(new Date(date), {addSuffix: true})) + ")"}
                </span>
            </div>
        )
    }

    useEffect(() => {
        const interval = setInterval(() => {
            setPrettyVersionDate(formatDistanceToNow(new Date(versionsDate), {addSuffix: true}))
        }, 20000);

        return () => {
            clearInterval(interval); // Clean up the interval when the component unmounts
        };
    }, [versionsDate]);

    const saveAll = () => {
        const newVersion = virtualFS.fs.create(
            version.version,
            virtualFS.tabs.get().filter((t) => t.id !== "Untitled").map((t) => {
                return {
                    id: t.id,
                    active: t.active
                }
            }),
            { quiet: true }
        )
        handleSwitchFsVersion(newVersion)
    }

    const handleRootCertificateSelection = async () => {
        const rootCerts = await window.electron.settings.certificates.getRoot()
        setRootCertificates(rootCerts)
        if (rootCerts.length === 0) {
            (AppToaster).show({message: `No root certificate found. Please add one.`, intent: "danger"});
            return null
        }

        let selectedLabel = rootCerts[0].label;

        if (rootCerts.length > 1) {
            selectedLabel = await selectRootCert(setShowRootCertificateDialog, rememberedRootCertificate, rememberChoiceRef, setRememberedRootCertificate, setOnRootCertificateSelected);
        }

        if (!selectedLabel) {
            setDeployInProgress(false)
            return null
        }

        return selectedLabel
    }

    const setFsVersion = (ver) => {
        if (ver.version === version.version) return
        setIsOpenSwitch(true)
        setNewVersion(ver)
    }

    const handleConfirmSwitch = () => {
        setIsLoadingSwitch(true)
        handleSwitchFsVersion(newVersion)
        setIsLoadingSwitch(false)
        setIsOpenSwitch(false)
    }

    const handleSwitchFsVersion = (ver) => {
        const data = virtualFS.fs.set(ver.version)
        if (data.tabs.length > 0) {
            virtualFS.tabs.addMultiple(data.tabs)
        }
        setVersion(ver)
        setVersionsDate(ver.date)
        setPrettyVersionDate(formatDistanceToNow(new Date(ver.date), {addSuffix: true}))
    }

    const triggerBuild = async () => {
        setBuildInProgress(true)
        if (currentSelectedTabId !== "ai-agent") {
            setSelectedTabId("output")
        }
        await build()
        setBuildInProgress(false)
    }

    const triggerRunTests = async () => {
        setTestsInProgress(true)
        if (currentSelectedTabId !== "ai-agent") {
            setSelectedTabId("tests")
        }
        await runTests()
        setTestsInProgress(false)
    }

    const triggerDeploy = async () => {
        setDeployInProgress(true)
        const name = virtualFS.treeObject[0].label
        try {
            await triggerBuild()
        } catch (e) {
            setDeployInProgress(false)
            (await AppToaster).show({message: `Build failed: ${e.message}`, intent: "danger"});
            return
        }

        let selectedLabel = await handleRootCertificateSelection()

        if (!selectedLabel) {
            setDeployInProgress(false)
            return
        }

        const metadata = await virtualFS.build.getMetadata()
        if (!metadata) {
            (await AppToaster).show({message: `No metadata found.`, intent: "danger"});
            return
        }

        const result = await window.electron.plugin.deployToMainFromEditor({
            name,
            sandbox: virtualFS.sandboxName,
            entrypoint: virtualFS.build.getEntrypoint(),
            metadata,
            content: virtualFS.build.getContent(),
            rootCert: selectedLabel
        })
        if (!result.success) {
            (await AppToaster).show({message: `${result.error}`, intent: "danger"});
        }
        setDeployInProgress(false)
    }

    const triggerSaveAndClose = async () => {
        setSaveAndCloseInProgress(true)
        const name = virtualFS.treeObject[0].label

        let selectedLabel = await handleRootCertificateSelection()

        if (!selectedLabel) {
            setDeployInProgress(false)
            return
        }

        const content = []
        virtualFS.listModels().forEach((model) => {
            const modelUri = model.uri.toString(true).replace("file://", "")
            if (modelUri.includes("/node_modules/")) {
                return
            }
            content.push({
                path: modelUri,
                content: model.getValue(),
            })
        })

        const metadata = await virtualFS.build.getMetadata()
        if (!metadata) {
            (await AppToaster).show({message: `No metadata found.`, intent: "danger"});
            return
        }

        const result = await window.electron.plugin.saveAndCloseFromEditor({
            name,
            sandbox: virtualFS.sandboxName,
            entrypoint: virtualFS.build.getEntrypoint(),
            metadata,
            dir: pluginDirectory,
            rootCert: selectedLabel,
            content
        })
        if (!result.success) {
            (await AppToaster).show({message: `${result.error}`, intent: "danger"});
        }
        localStorage.removeItem("sandbox_" + name)
        setSaveAndCloseInProgress(false)
    }

    useEffect(() => {
        if (versions) {
            for (const ver of versions) {
                if (ver.current) {
                    setVersion(ver)
                    setVersionsDate(ver.date)
                    setPrettyVersionDate(formatDistanceToNow(new Date(ver.date), {addSuffix: true}))
                    break
                }
            }
        }
    }, [versions]);

    useEffect(() => {
        const unsubscribe = virtualFS.notifications.subscribe("treeVersionsUpdate", setVersions)
        const unsubscribeLoading = virtualFS.notifications.subscribe("treeLoading", setTreeLoading);

        return () => {
            unsubscribe()
            unsubscribeLoading()
        }
    }, []);
    return (
        <>
            {renderOnLoadTemplates.length > 0 && (
                <SidebarSection
                    id="render-on-load"
                    title={(
                        <div className={styles["renderOnLoadSectionTitle"]}>
                            <span>Render On Load (Optional)</span>
                            <Button
                                minimal={true}
                                small={true}
                                icon="help"
                                aria-label="Render On Load guide"
                                onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    setShowRenderOnLoadGuide(true);
                                }}
                            />
                        </div>
                    )}
                    defaultCollapsed={true}
                >
                    <div className={styles["renderOnLoadSidebarSection"]}>
                        <div className="bp6-text-muted bp6-text-small">
                            Optional: inject startup UI behavior for your plugin after render.
                        </div>
                        <div className="bp6-text-small">
                            Pick a template, adjust strict mode, then apply.
                        </div>
                        <HTMLSelect
                            fill={true}
                            value={renderOnLoadTemplateId}
                            onChange={(event) => onRenderOnLoadTemplateIdChange(event.target.value)}
                            className={styles["renderOnLoadSidebarSelect"]}
                            aria-label="renderOnLoad template picker"
                        >
                            {renderOnLoadTemplates.map((template) => {
                                const optionLabel = `${template.label} (${template.context})`;
                                const isActionsTemplate = String(template?.source || "").includes("defineRenderOnLoadActions(");
                                return (
                                    <option key={template.id} value={template.id}>
                                        {isActionsTemplate ? `${optionLabel} • recommended for multi-binding` : optionLabel}
                                    </option>
                                );
                            })}
                        </HTMLSelect>
                        <div className={styles["renderOnLoadSidebarActions"]}>
                            {showRenderOnLoadStrictToggle && (
                                <Switch
                                    checked={renderOnLoadStrictMode}
                                    label="Strict mode"
                                    onChange={(event) => onRenderOnLoadStrictModeChange(event.target.checked)}
                                    className={styles["renderOnLoadSidebarStrict"]}
                                />
                            )}
                            <Button
                                fill={true}
                                icon="insert"
                                text="Apply Template"
                                onClick={onApplyRenderOnLoadTemplate}
                                loading={renderOnLoadTemplateApplying}
                                disabled={!renderOnLoadTemplateId}
                                intent={highlightRenderOnLoadRecommendation ? "primary" : "none"}
                            />
                        </div>
                        {highlightRenderOnLoadRecommendation && (
                            <div className="bp6-text-muted bp6-text-small">
                                Recommended when you bind multiple selectors/events.
                            </div>
                        )}
                        {renderOnLoadTemplateError && (
                            <div className={styles["renderOnLoadSidebarError"]} role="alert">
                                {renderOnLoadTemplateError}
                            </div>
                        )}
                    </div>
                </SidebarSection>
            )}
            <Dialog
                title="Render On Load Guide"
                isOpen={showRenderOnLoadGuide}
                onClose={() => setShowRenderOnLoadGuide(false)}
                canEscapeKeyClose={true}
                canOutsideClickClose={true}
            >
                <div className="bp6-dialog-body">
                    <p>
                        Render On Load is the post-render behavior layer for your plugin UI.
                    </p>
                    <p>
                        Use it when markup alone is not enough and you need runtime behavior such as click handlers,
                        startup initialization, or UI-to-backend messaging.
                    </p>
                    <ol>
                        <li>Choose a template that matches where code should live.</li>
                        <li>Set Strict mode based on development safety needs.</li>
                        <li>Click Apply Template to insert scaffold code into the correct file.</li>
                        <li>Implement your business logic in generated handlers.</li>
                    </ol>
                    <p>
                        <b>Template contexts:</b>
                    </p>
                    <ul>
                        <li><b>plugin-method</b>: updates your plugin class `renderOnLoad()` method in `/index.*`.</li>
                        <li><b>runtime-source</b>: creates or updates `/render.onload.ts` or `/render.onload.js`.</li>
                    </ul>
                    <p>
                        <b>Strict mode:</b> when enabled, selector mismatches and binding issues fail fast so bugs are visible
                        during development instead of silently failing at runtime.
                    </p>
                    <p>
                        <b>Recommendation:</b> for multiple UI actions, prefer `defineRenderOnLoadActions(...)` templates.
                        They keep handlers typed, reduce fragile manual listener code, and improve diagnostics.
                    </p>
                    <p>
                        If your plugin is static content only, you can ignore this section safely.
                    </p>
                </div>
                <div className="bp6-dialog-footer">
                    <div className="bp6-dialog-footer-actions">
                        <Button intent="primary" onClick={() => setShowRenderOnLoadGuide(false)}>
                            Got it
                        </Button>
                    </div>
                </div>
            </Dialog>

            <SidebarSection
              id="snapshots"
              title="Snapshots"
              defaultCollapsed={false}
            >
              <Button
                fill={true}
                intent="primary"
                icon="history"
                text="Open Snapshot Timeline…"
                onClick={() => {
                  try { window.__openSnapshotsPanel && window.__openSnapshotsPanel(); } catch (_) {}
                }}
              />
              <Divider />
              <div className="bp6-text-muted bp6-text-small" style={{ textAlign: 'center' }}>
                Use the Snapshot toolbar to create, rename, or delete snapshots.
              </div>
            </SidebarSection>

            <SidebarSection
              id="actions"
              title="Actions"
              defaultCollapsed={false}
              sticky={(
                <ButtonGroup fill={true} vertical={true}>
                  <Button text="Run Tests" intent="warning" icon="endorsed" loading={testsInProgress}
                          onClick={async () => await triggerRunTests()} />
                  <Button text="Compile" intent="primary" icon="build" loading={buildInProgress}
                          onClick={async () => await triggerBuild()} />
                  <Button text="Deploy" intent="success" icon="share" loading={deployInProgress}
                          onClick={async () => await triggerDeploy()} />
                  <Button text="Save & Close" icon="cross" loading={saveAndCloseInProgress}
                          onClick={async () => await triggerSaveAndClose()} />
                </ButtonGroup>
              )}
            >
            </SidebarSection>
            <Button fill={true} text="Live UI editor" intent="warning" icon="style" endIcon="share"
                    onClick={() => window.electron.system.openLiveUiWindow({})}/>
            <Alert
                cancelButtonText="Cancel"
                canEscapeKeyCancel={true}
                canOutsideClickCancel={true}
                confirmButtonText="Switch"
                icon={IconNames.SWITCH}
                intent={"warning"}
                isOpen={isOpenSwitch}
                loading={isLoadingSwitch}
                onCancel={() => setIsOpenSwitch(false)}
                onConfirm={handleConfirmSwitch}
                className={styles["alert-delete"]}
            >
                <p style={{color: "white"}}>
                    Make sure to <b>create snapshot</b> before switching between versions. Unsaved changes will be
                    discarded. Proceed?
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
        </>
    )
}
CodeDeployActions.propTypes = {
    setSelectedTabId: PropTypes.func.isRequired,
    currentSelectedTabId: PropTypes.string,
    pluginDirectory: PropTypes.string.isRequired,
    renderOnLoadTemplates: PropTypes.array,
    renderOnLoadTemplateId: PropTypes.string,
    onRenderOnLoadTemplateIdChange: PropTypes.func,
    renderOnLoadStrictMode: PropTypes.bool,
    onRenderOnLoadStrictModeChange: PropTypes.func,
    showRenderOnLoadStrictToggle: PropTypes.bool,
    renderOnLoadTemplateApplying: PropTypes.bool,
    onApplyRenderOnLoadTemplate: PropTypes.func,
    renderOnLoadTemplateError: PropTypes.string,
    highlightRenderOnLoadRecommendation: PropTypes.bool,
}

export default CodeDeployActions;
