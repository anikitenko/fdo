import {Button, Card, Divider, Elevation, Icon, Popover, Tag} from "@blueprintjs/core";
import * as style from "../Home.module.scss"
import PropTypes from "prop-types";
import {lazy, Suspense, useState} from "react";

// Lazy load dialogs (only needed when opened)
const CreatePluginDialog = lazy(() => import("./CreatePluginDialog.jsx").then(m => ({default: m.CreatePluginDialog})));
const ManagePluginsDialog = lazy(() => import("./ManagePluginsDialog.jsx").then(m => ({default: m.ManagePluginsDialog})));

export const NavigationPluginsButton = ({
                                            active,
                                            all, buttonMenuRef, selectPlugin, deselectPlugin, deselectAllPlugins, removePlugin, setSearchActions
                                        }) => {
    const [showCreateDialog, setShowCreateDialog] = useState(false);
    const [showManageDialog, setShowManageDialog] = useState(false);

    return (
        <div>
            <Popover
                content={<PluginsCard all={all} active={active}
                                      selectPlugin={selectPlugin}
                                      deselectPlugin={deselectPlugin}
                                      deselectAllPlugins={deselectAllPlugins}
                                      setShowCreateDialog={setShowCreateDialog}
                                      setShowManageDialog={setShowManageDialog}
                />}
                popoverClassName={style["plugins-popover"]}
                interactionKind={"click"}
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
                                 deselectPlugin={deselectPlugin} removePlugin={removePlugin} setSearchActions={setSearchActions}/>
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
    setSearchActions: PropTypes.func
}

const PluginsCard = ({
                         all,
                         active,
                         selectPlugin,
                         deselectPlugin,
                         deselectAllPlugins,
                         setShowCreateDialog,
                         setShowManageDialog
                     }) => {
    return (
        <>
            <Card style={{background: "#2e2e2e", borderRadius: "10px 10px 0 0"}}>
                <div>
                    <div style={{paddingLeft: "15px", paddingRight: "15px", paddingBottom: "5px"}}>
                        <span className={"bp6-text-large bp6-heading"}>Installed Plugins</span>
                        {all.length > 0 && (
                            <Button
                                variant={"minimal"}
                                size={"small"}
                                onClick={deselectAllPlugins}
                                style={{
                                    float: "right",
                                    paddingRight: "5px",
                                    color: "rgb(138 187 255)",  // A more "real" blue link color
                                    cursor: "pointer",
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
                    padding: "10px", marginTop: "10px", maxHeight: "300px",
                    maxWidth: "500px",
                    overflowY: "auto",
                }}>
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(2, 1fr)',
                        gap: '10px',
                        marginBottom: "10px",
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
                                          if (active.some((p) => p.id === plugin.id)) {
                                              deselectPlugin(plugin)
                                          } else {
                                              selectPlugin(plugin)
                                          }
                                      }}
                                      style={{background: "#2e2e2e", borderRadius: "10px"}} data-plugin={plugin.name}>
                                    <div style={{display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '10px'}}>
                                        <div>
                                            <Button variant={"outlined"} style={{borderRadius: "10px"}}>
                                                <Icon icon={plugin.icon} style={{padding: "1px 5px"}} size={20}
                                                      intent={"primary"}/>
                                            </Button>
                                        </div>
                                        <div style={{display: 'grid', gap: '5px'}}>
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
            <div style={{padding: "15px", display: "flex", justifyContent: "center"}}>
                <Button text="Create plugin" intent={"success"} style={{borderRadius: "5px"}} variant={"outlined"}
                        size={"large"} onClick={() => setShowCreateDialog(true)}/>
                <Button text="Manage plugins" intent={"primary"} style={{borderRadius: "5px", marginLeft: "10px"}}
                        variant={"outlined"} size={"large"} onClick={() => setShowManageDialog(true)}/>
            </div>
        </>
    );
}
PluginsCard.propTypes = {
    all: PropTypes.array,
    active: PropTypes.array,
    setShowCreateDialog: PropTypes.func,
    selectPlugin: PropTypes.func,
    deselectPlugin: PropTypes.func,
    deselectAllPlugins: PropTypes.func,
    setShowManageDialog: PropTypes.func
}
