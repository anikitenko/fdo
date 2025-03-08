import React, {useEffect, useRef, useState} from 'react'
import classNames from "classnames";
import {KBarProvider} from "kbar";
import {
    Alignment,
    Button,
    Icon,
    InputGroup,
    Navbar,
    Tag,
} from "@blueprintjs/core";
import * as styles from './Home.module.scss'
import {NavigationPluginsButton} from "./components/NavigationPluginsButton.jsx";
import {AppToaster} from "./components/AppToaster.jsx";
import {PluginContainer} from "./components/PluginContainer.jsx";
import {SideBar} from "./components/SideBar.jsx";
import {CommandBar} from "./components/CommandBar.jsx";

export const Home = () => {
    const [searchActions, setSearchActions] = useState([])
    const sideBarActionItems = [
        {icon: "notifications", name: "Notifications"},
        {icon: "cog", name: "Settings"}
    ]
    const [state, setState] = useState({
        plugins: [],
        activePlugins: [],
    });
    const [plugin, setPlugin] = useState("");
    const [showRightSideBar, setShowRightSideBar] = useState(true)
    const [showCommandSearch, setShowCommandSearch] = useState(false)
    const buttonMenuRef = useRef(null)

    useEffect(() => {
        if (state.plugins && state.plugins.length > 0) {
            state.plugins.map((plugin) => {
                const actionId = "navigate-"+plugin.id
                if (searchActions.some(action => action.id === actionId)) return
                setSearchActions((prev) => [
                    ...prev,
                    {
                        id: actionId,
                        name: plugin.name,
                        subtitle: plugin.author +" | " + plugin.version,
                        keywords: plugin.description,
                        perform: () => {
                            buttonMenuRef.current.click()
                            setTimeout(() => {
                                const targetElement = document.querySelector(`[data-plugin="${plugin.name}"]`);
                                if (targetElement) {
                                    targetElement.scrollIntoView({ behavior: "smooth", block: "start" });
                                    // Add wiggle effect
                                    targetElement.classList.add(styles["wiggle"]);

                                    // Remove wiggle effect after 1 second
                                    setTimeout(() => {
                                        targetElement.classList.remove(styles["wiggle"]);
                                    }, 1500);
                                }
                            }, 300);
                        },
                        icon: <Icon icon={plugin.icon} size={24}/>,
                        section: "Installed plugins",
                    }
                ])
            })
        }
    }, [state.plugins]);

    useEffect(() => {
        if (state.activePlugins) {
            state.activePlugins.map((plugin) => {
                const actionId = "plugin-action-" + plugin.id
                if (searchActions.some(action => action.id === actionId)) return
            })
        }
    }, [state.activePlugins])

    const deselectAllPlugins = () => {
        // Deactivate all plugins in Electron
        const pluginIds = state.activePlugins.map(plugin => plugin.id);

        Promise.all(pluginIds.map(id => window.electron.DeactivatePlugin(id)))
            .then(async (results) => {
                // Check if all plugins were successfully deactivated
                const allSuccessful = results.every(result => result && result.success);

                if (allSuccessful) {
                    setState(prevState => ({
                        ...prevState,
                        activePlugins: []
                    }));
                } else {
                    // Find which plugins failed to deactivate
                    const failedPlugins = results
                        .map((result, index) => !result.success ? pluginIds[index] : null)
                        .filter(Boolean);

                    (await AppToaster).show({
                        message: `Error: Failed to deactivate plugins: ${failedPlugins.join(", ")}`,
                        intent: "danger"
                    });
                }
            })
            .catch(async () => {
                (await AppToaster).show({
                    message: `Failed to deactivate plugins`,
                    intent: "danger"
                });
            });
    };

    const deselectPlugin = (plugin) => {
        window.electron.DeactivatePlugin(plugin.id).then (async (result) => {
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
                } else {
                    (await AppToaster).show({ message: `Error: ${result.error}`, intent: "danger" });
                }
            } else {
                (await AppToaster).show({ message: `Failed to deactivate plugin`, intent: "danger" });
            }
        });
    }

    const selectPlugin = (plugin) => {
        window.electron.ActivatePlugin(plugin.id).then (async (result) => {
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
                } else {
                    (await AppToaster).show({ message: `Error: ${result.error}`, intent: "danger" });
                }
            } else {
                (await AppToaster).show({ message: `Failed to activate plugin`, intent: "danger" });
            }
        });
    };

    const pluginsInitialLoad = useRef(false);
    useEffect(() => {
        if (pluginsInitialLoad.current) return;
        pluginsInitialLoad.current = true;
        window.electron.GetAllPlugins().then ((allPlugins) => {
            window.electron.GetActivatedPlugins().then ((activePlugins) => {
                setState(prevState => (
                    {
                        ...prevState, plugins: allPlugins.plugins.map(plugin => {
                            const currPlugin = {...plugin, ...plugin.metadata, metadata: undefined};
                            if (activePlugins.plugins.some(item => item === currPlugin.id)) {
                                selectPlugin(currPlugin);
                            }
                            return currPlugin;
                        })
                    }
                ))
            })
        })

    }, []);

    const isProcessingPluginFromEditor = useRef(false);
    const isUnloading = useRef(false)
    useEffect(() => {
        const onPluginLoaded = (loadedPlugin) => {
            if (isProcessingPluginFromEditor.current) return;
            isProcessingPluginFromEditor.current = true;
            if (loadedPlugin) {
                window.electron.GetPlugin(loadedPlugin).then ((loadedPlugin) => {
                    const newPlugin = {...loadedPlugin.plugin, ...loadedPlugin.plugin.metadata, metadata: undefined};
                    setState(prevState => {
                        // Check if plugin already exists
                        const pluginExists = prevState.plugins.some(item => item.id === newPlugin.id);

                        if (pluginExists) {
                            deselectPlugin(newPlugin)
                            selectPlugin(newPlugin)
                            return prevState;
                        }

                        selectPlugin(newPlugin);
                        return {
                            ...prevState,
                            plugins: [...prevState.plugins, newPlugin]
                        };
                    });
                })
            }

            isProcessingPluginFromEditor.current = false;
        }

        const onPluginUnloaded = (unloadedPlugin) => {
            if (isUnloading.current) return;
            isUnloading.current = true;
            if (unloadedPlugin) {
                window.electron.DeactiveUserPlugin(unloadedPlugin)
                setState(prevState => {
                    // Check if plugin already exists
                    const pluginExists = prevState.activePlugins.some(item => item.id === unloadedPlugin);

                    if (pluginExists) {
                        // Remove the plugin
                        return {
                            ...prevState,
                            activePlugins: prevState.activePlugins.filter(item => item.id !== unloadedPlugin)
                        }
                    } else {
                        return prevState;
                    }
                });
            }
            isUnloading.current = false;
        }

        window.electron.onPluginUnLoaded(onPluginUnloaded)
        window.electron.onDeployFromEditor(onPluginLoaded)
        return () => {
            window.electron.offDeployFromEditor(onPluginLoaded);
            window.electron.offPluginUnLoaded(onPluginUnloaded);
        };
    }, [])

    return (
            <KBarProvider
                options={{
                    enableHistory: true,
                }}
            >
                <CommandBar show={showCommandSearch} actions={searchActions} setShow={setShowCommandSearch}/>
                <div className={classNames("bp5-dark", styles["main-container"])}>
                    {state.activePlugins.length > 0 && (
                        <SideBar position={"left"} menuItems={state.activePlugins} click={setPlugin}/>
                    )}
                    <Navbar fixedToTop={true}>
                        <Navbar.Group className={styles["nav-center"]}>
                            <NavigationPluginsButton active={state.activePlugins} all={state.plugins} buttonMenuRef={buttonMenuRef}
                                                     selectPlugin={selectPlugin} deselectPlugin={deselectPlugin} deselectAllPlugins={deselectAllPlugins}
                            />
                        </Navbar.Group>
                        <Navbar.Group align={Alignment.END}>
                            <InputGroup
                                leftIcon={"search"} placeholder={"Search..."} inputClassName={styles["header-search"]}
                                rightElement={<Tag minimal={true} className={"bp5-monospace-text"} style={{fontSize: "0.6rem", background: "black"}}>Cmd+K</Tag>}
                                onClick={() => setShowCommandSearch(true)}
                                value=""
                                onKeyPress={() => setShowCommandSearch(true)}
                            />
                            <Navbar.Divider/>
                            <Button variant={"minimal"} icon={showRightSideBar ? "menu-open" : "menu-closed"} onClick={() => setShowRightSideBar(!showRightSideBar)} />
                        </Navbar.Group>
                    </Navbar>
                    {showRightSideBar && (
                        <SideBar position={"right"} menuItems={sideBarActionItems}/>
                    )}
                    <div style={{marginLeft: (state.plugins.length > 0 ? "50px" : ""), marginRight: (showRightSideBar ? "50px" : "")}}>
                        {plugin && <PluginContainer plugin={plugin}/>}
                    </div>
                </div>
            </KBarProvider>
    );
}
