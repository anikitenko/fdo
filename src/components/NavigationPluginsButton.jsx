import {Button, Card, Divider, Elevation, Icon, Popover, Tag} from "@blueprintjs/core";
import * as style from "../Home.module.scss"
import PropTypes from "prop-types";
import {lazy, Suspense, useEffect, useState} from "react";
import {sanitizeBlueprintIcon} from "../utils/blueprintIcons";

// Lazy load dialogs (only needed when opened)
const CreatePluginDialog = lazy(() => import("./CreatePluginDialog.jsx").then(m => ({default: m.CreatePluginDialog})));
const ManagePluginsDialog = lazy(() => import("./ManagePluginsDialog.jsx").then(m => ({default: m.ManagePluginsDialog})));

export const NavigationPluginsButton = ({
                                            active,
                                            all, buttonMenuRef, selectPlugin, deselectPlugin, deselectAllPlugins, removePlugin, setSearchActions, refreshPluginsState,
                                            capabilityFocusRequest,
                                            onCapabilityFocusRequestConsumed,
                                            pendingPluginScopeSuggestions,
                                            onPendingPluginScopeSuggestionResolved,
                                        }) => {
    const [showCreateDialog, setShowCreateDialog] = useState(false);
    const [showManageDialog, setShowManageDialog] = useState(false);
    const [showPluginsPopover, setShowPluginsPopover] = useState(false);

    useEffect(() => {
        if (!showPluginsPopover || typeof window === "undefined" || typeof document === "undefined") {
            return;
        }

        const closeIfIframeFocused = () => {
            const activeElement = document.activeElement;
            if (activeElement?.tagName === "IFRAME") {
                setShowPluginsPopover(false);
            }
        };
        const handlePointerDownCapture = (event) => {
            const target = event?.target;
            if (target?.tagName === "IFRAME") {
                setShowPluginsPopover(false);
            }
        };
        const handleWindowBlur = () => {
            setTimeout(closeIfIframeFocused, 0);
        };
        const handlePluginIframeInteraction = () => {
            setShowPluginsPopover(false);
        };
        const handlePluginIframeMessage = (event) => {
            if (event?.data?.type === "PLUGIN_IFRAME_INTERACTION") {
                setShowPluginsPopover(false);
            }
        };

        const focusPollId = window.setInterval(closeIfIframeFocused, 150);
        document.addEventListener("pointerdown", handlePointerDownCapture, true);
        document.addEventListener("focusin", closeIfIframeFocused, true);
        window.addEventListener("blur", handleWindowBlur, true);
        window.addEventListener("fdo:plugin-iframe-interaction", handlePluginIframeInteraction);
        window.addEventListener("message", handlePluginIframeMessage);
        return () => {
            window.clearInterval(focusPollId);
            document.removeEventListener("pointerdown", handlePointerDownCapture, true);
            document.removeEventListener("focusin", closeIfIframeFocused, true);
            window.removeEventListener("blur", handleWindowBlur, true);
            window.removeEventListener("fdo:plugin-iframe-interaction", handlePluginIframeInteraction);
            window.removeEventListener("message", handlePluginIframeMessage);
        };
    }, [showPluginsPopover]);

    useEffect(() => {
        if (!capabilityFocusRequest?.pluginId) {
            return;
        }
        setShowPluginsPopover(false);
        setShowManageDialog(true);
    }, [capabilityFocusRequest?.requestId, capabilityFocusRequest?.pluginId]);

    return (
        <div>
            <Popover
                content={<PluginsCard all={all} active={active}
                                      selectPlugin={selectPlugin}
                                      deselectPlugin={deselectPlugin}
                                      deselectAllPlugins={deselectAllPlugins}
                                      setShowCreateDialog={setShowCreateDialog}
                                      setShowManageDialog={setShowManageDialog}
                                      closePopover={() => setShowPluginsPopover(false)}
                />}
                popoverClassName={style["plugins-popover"]}
                interactionKind={"click"}
                isOpen={showPluginsPopover}
                onInteraction={setShowPluginsPopover}
                modifiers={{
                    arrow: {enabled: true},
                    flip: {enabled: true},
                    preventOverflow: {enabled: true},
                }}
            >
                <Button variant={"minimal"} ref={buttonMenuRef}>
                    Plugins Activated: <Tag intent={"success"} round={true}>{active.length}</Tag> Installed: <Tag
                    intent={"primary"}
                    round={true}>{all.length}</Tag></Button>
            </Popover>
            <Suspense fallback={null}>
                <CreatePluginDialog show={showCreateDialog}
                                    close={() => setShowCreateDialog(false)}
                />
                <ManagePluginsDialog plugins={all} activePlugins={active} show={showManageDialog} setShow={setShowManageDialog}
                                     selectPlugin={selectPlugin}
                                     deselectPlugin={deselectPlugin} removePlugin={removePlugin} setSearchActions={setSearchActions}
                                     refreshPluginsState={refreshPluginsState}
                                     focusRequest={capabilityFocusRequest}
                                     onFocusRequestConsumed={onCapabilityFocusRequestConsumed}
                                     pendingPluginScopeSuggestions={pendingPluginScopeSuggestions}
                                     onPendingPluginScopeSuggestionResolved={onPendingPluginScopeSuggestionResolved}
                />
            </Suspense>
        </div>
    );
};
NavigationPluginsButton.propTypes = {
    active: PropTypes.array,
    all: PropTypes.array,
    buttonMenuRef: PropTypes.any,
    selectPlugin: PropTypes.func,
    deselectPlugin: PropTypes.func,
    deselectAllPlugins: PropTypes.func,
    removePlugin: PropTypes.func,
    setSearchActions: PropTypes.func,
    refreshPluginsState: PropTypes.func,
    capabilityFocusRequest: PropTypes.shape({
        requestId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
        pluginId: PropTypes.string,
        capabilityIds: PropTypes.array,
        focusSection: PropTypes.string,
        scopeIds: PropTypes.array,
        suggestedScope: PropTypes.shape({
            scopeId: PropTypes.string,
            commandPath: PropTypes.string,
        }),
    }),
    onCapabilityFocusRequestConsumed: PropTypes.func,
    pendingPluginScopeSuggestions: PropTypes.object,
    onPendingPluginScopeSuggestionResolved: PropTypes.func,
}

const PluginsCard = ({
                         all,
                         active,
                         selectPlugin,
                         deselectPlugin,
                         deselectAllPlugins,
                         setShowCreateDialog,
                         setShowManageDialog,
                         closePopover,
                     }) => {
    const panelWidth = "500px";

    return (
        <div style={{width: panelWidth, maxWidth: "calc(100vw - 96px)"}}>
            <Card style={{background: "#2e2e2e", borderRadius: "10px 10px 0 0", width: "100%", overflow: "hidden"}}>
                <div>
                    <div style={{paddingLeft: "16px", paddingRight: "16px", paddingBottom: "8px", display: "flex", alignItems: "center", justifyContent: "space-between"}}>
                        <span className={"bp6-text-large bp6-heading"}>Installed Plugins</span>
                        {all.length > 0 && (
                            <Button
                                variant={"minimal"}
                                size={"small"}
                                onClick={deselectAllPlugins}
                                style={{
                                    minHeight: "24px",
                                    padding: "0 6px",
                                    color: "rgba(167, 182, 201, 0.72)",
                                    cursor: "pointer",
                                    fontSize: "0.85rem",
                                }}
                                className={style["link-button"]}
                            >
                                Deselect All
                            </Button>
                        )}
                    </div>
                </div>
                <Divider/>
                <div style={{
                    padding: "14px 14px 12px", marginTop: "4px", maxHeight: "300px",
                    width: "100%",
                    overflowY: "auto",
                    boxSizing: "border-box",
                }}>
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(2, 1fr)',
                        gap: '16px 12px',
                        marginBottom: "12px",
                    }}>
                        {all.length === 0 && (
                            <div style={{textAlign: "center", color: "#6c757d"}}>
                                <span className={"bp6-text-muted"}>No plugins installed</span>
                            </div>
                        )}
                        {all.map((plugin) => {
                            return (
                                <Card key={plugin.id} interactive={true} elevation={Elevation.ONE}
                                      selected={active.some((p) => p.id === plugin.id)}
                                      onClick={() => {
                                          closePopover?.();
                                          if (active.some((p) => p.id === plugin.id)) {
                                              deselectPlugin(plugin)
                                          } else {
                                              selectPlugin(plugin, {open: true})
                                          }
                                      }}
                                      style={{background: "#2e2e2e", borderRadius: "10px", padding: "4px"}} data-plugin={plugin.name}>
                                    <div style={{display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '12px', padding: "6px"}}>
                                        <div>
                                            <Button variant={"outlined"} style={{borderRadius: "10px"}}>
                                                <Icon icon={sanitizeBlueprintIcon(plugin.icon)} style={{padding: "1px 5px"}} size={20}
                                                      intent={"primary"}/>
                                            </Button>
                                        </div>
                                        <div style={{display: 'grid', gap: '7px'}}>
                                            <div>
                                                <span className="bp6-heading">{plugin.name}</span>
                                            </div>
                                            <div>
                                        <span className={"bp6-text-small bp6-text-muted"}>
                                            {plugin.author}
                                        </span> | <span
                                                className={"bp6-text-small bp6-text-muted"}>{plugin.version}</span>
                                            </div>
                                            <div>
                                                <span className="bp6-text-small">{plugin.description}</span>
                                            </div>
                                        </div>
                                    </div>
                                </Card>
                            )
                        })}
                    </div>
                </div>
            </Card>
            <div style={{
                padding: "14px",
                display: "flex",
                justifyContent: "center",
                width: "100%",
                boxSizing: "border-box",
                background: "#2e2e2e",
                borderRadius: "0 0 10px 10px",
                borderTop: "1px solid rgba(255, 255, 255, 0.08)",
                boxShadow: "0 8px 24px rgba(0, 0, 0, 0.18)",
            }}>
                <Button text="Create plugin" intent={"success"} style={{borderRadius: "6px", minWidth: "132px"}} variant={"outlined"}
                        size={"medium"} onClick={() => {
                            closePopover?.();
                            setShowCreateDialog(true);
                        }}/>
                <Button text="Manage plugins" intent={"primary"} style={{borderRadius: "6px", minWidth: "132px", marginLeft: "10px"}}
                        variant={"outlined"} size={"medium"} onClick={() => {
                            closePopover?.();
                            setShowManageDialog(true);
                        }}/>
            </div>
        </div>
    );
}
PluginsCard.propTypes = {
    all: PropTypes.array,
    active: PropTypes.array,
    setShowCreateDialog: PropTypes.func,
    selectPlugin: PropTypes.func,
    deselectPlugin: PropTypes.func,
    deselectAllPlugins: PropTypes.func,
    setShowManageDialog: PropTypes.func,
    closePopover: PropTypes.func,
}
