import React, {useEffect, useRef, useState} from 'react'
import classNames from "classnames";
import {KBarProvider} from "kbar";
import {Alignment, Button, Icon, InputGroup, Navbar, Tag,} from "@blueprintjs/core";
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
    const [pluginReadiness, setPluginReadiness] = useState(new Map());
    const prevPluginReadinessRef = useRef(new Map());

    const isPluginReady = (pluginID) => {
        return pluginReadiness.get(pluginID) ?? false; // Default to false if not found
    };

    const markPluginReady = (pluginID) => {
        setPluginReadiness((prev) => {
            // Create a new Map to avoid mutating the state directly
            const newReadiness = new Map(prev);

            // Only update if the plugin exists and is not already ready
            if (newReadiness.has(pluginID) && !newReadiness.get(pluginID)) {
                newReadiness.set(pluginID, true);
            }

            return newReadiness;
        });
    };

    useEffect(() => {
        setSearchActions((prev) => {
            // Remove actions for plugins that are no longer installed
            const filteredActions = prev.filter(action =>
                !action.id.startsWith("navigate-") || state.plugins.some(plugin => action.id === `navigate-${plugin.id}`)
            );

            // Extract existing action IDs for quick lookup
            const existingActionIds = new Set(filteredActions.map(action => action.id));

            // Add new actions for plugins that are not yet registered
            const newActions = state.plugins
                .filter(plugin => !existingActionIds.has(`navigate-${plugin.id}`))
                .map(plugin => ({
                    id: `navigate-${plugin.id}`,
                    name: plugin.name,
                    subtitle: `${plugin.author} | ${plugin.version}`,
                    keywords: plugin.description,
                    perform: () => {
                        buttonMenuRef.current.click();
                        setTimeout(() => {
                            const targetElement = document.querySelector(`[data-plugin="${plugin.name}"]`);
                            if (targetElement) {
                                targetElement.scrollIntoView({behavior: "smooth", block: "start"});

                                // Add wiggle effect
                                targetElement.classList.add(styles["wiggle"]);

                                // Remove wiggle effect after 1.5s
                                setTimeout(() => {
                                    targetElement.classList.remove(styles["wiggle"]);
                                }, 1500);
                            }
                        }, 300);
                    },
                    icon: <Icon icon={plugin.icon} size={24}/>,
                    section: "Installed plugins",
                }));

            return [...filteredActions, ...newActions];
        });
    }, [state.plugins]);

    useEffect(() => {
        // Track plugin activation and deactivation
        setPluginReadiness((prev) => {
            const newReadiness = new Map(prev);

            // Add new plugins with readiness as false
            state.activePlugins.forEach((plugin) => {
                if (!newReadiness.has(plugin.id)) {
                    newReadiness.set(plugin.id, false);
                }
            });

            // Remove plugins that are no longer active
            prev.forEach((_, pluginID) => {
                if (!state.activePlugins.some((p) => p.id === pluginID)) {
                    newReadiness.delete(pluginID);
                }
            });

            return newReadiness;
        });

        setSearchActions((prev) => {
            // Remove only "navigate-active-" actions for plugins that are no longer active
            const filteredActions = prev.filter(action =>
                !action.id.startsWith("navigate-active-") ||
                state.activePlugins.some(plugin => action.id === `navigate-active-${plugin.id}`)
            );
            if (state.activePlugins.length === 0) {
                return filteredActions.filter(action => !action.id.startsWith("navigate-active-"));
            }

            // Add new actions for plugins that are not yet registered
            const newActions = state.activePlugins
                .filter(plugin => !filteredActions.some(action => action.id === `navigate-active-${plugin.id}`))
                .map(plugin => ({
                    id: `navigate-active-${plugin.id}`,
                    name: plugin.name,
                    subtitle: `${plugin.author} | ${plugin.version}`,
                    keywords: plugin.description,
                    perform: () => setPlugin(plugin.id),
                    icon: <Icon icon={plugin.icon} size={24}/>,
                    section: "Active plugins",
                }));

            return [...filteredActions, ...newActions];
        });
    }, [state.activePlugins]);

    useEffect(() => {
        const prevReadiness = prevPluginReadinessRef.current;
        const newlyReadyPlugins = [];

        pluginReadiness.forEach((ready, pluginID) => {
            if (ready && (!prevReadiness.has(pluginID) || !prevReadiness.get(pluginID))) {
                newlyReadyPlugins.push(pluginID);
            }
        });

        // Update previous readiness ref
        prevPluginReadinessRef.current = new Map(pluginReadiness);

        // Perform actions only for newly ready plugins
        if (newlyReadyPlugins.length > 0) {
            newlyReadyPlugins.forEach((pluginID) => {
                window.electron.pluginInit(pluginID).then(() => {
                })
            });
        }
    }, [pluginReadiness]);

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
                setPlugin("")
            })
            .catch(async () => {
                (await AppToaster).show({
                    message: `Failed to deactivate plugins`,
                    intent: "danger"
                });
            });
    };

    const deselectPlugin = (plugin) => {
        window.electron.DeactivatePlugin(plugin.id).then(async (result) => {
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
                    setPlugin("")
                } else {
                    (await AppToaster).show({message: `Error: ${result.error}`, intent: "danger"});
                }
            } else {
                (await AppToaster).show({message: `Failed to deactivate plugin`, intent: "danger"});
            }
        });
    }

    const selectPlugin = (plugin) => {
        window.electron.ActivatePlugin(plugin.id).then(async (result) => {
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
                    (await AppToaster).show({message: `Error: ${result.error}`, intent: "danger"});
                }
            } else {
                (await AppToaster).show({message: `Failed to activate plugin`, intent: "danger"});
            }
        });
    };

    const pluginsInitialLoad = useRef(false);
    useEffect(() => {
        if (pluginsInitialLoad.current) return;
        pluginsInitialLoad.current = true;
        window.electron.GetAllPlugins().then((allPlugins) => {
            window.electron.GetActivatedPlugins().then((activePlugins) => {
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
    const isUnloading = useRef(false);
    useEffect(() => {
        const onPluginReady = (pluginID) => {
            markPluginReady(pluginID)
        }

        const onPluginInit = (response) => {
            console.log(response)
        }

        const onPluginLoaded = (loadedPlugin) => {
            if (isProcessingPluginFromEditor.current) return;
            isProcessingPluginFromEditor.current = true;
            if (loadedPlugin) {
                window.electron.GetPlugin(loadedPlugin).then((loadedPlugin) => {
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
                window.electron.DeactivateUserPlugin(unloadedPlugin).then(() => {
                })
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
            setPlugin("")
            isUnloading.current = false;
        }

        window.electron.onPluginReady(onPluginReady)
        window.electron.onPluginInit(onPluginInit)
        window.electron.onPluginUnLoaded(onPluginUnloaded)
        window.electron.onDeployFromEditor(onPluginLoaded)
        return () => {
            window.electron.offPluginReady(onPluginReady)
            window.electron.offPluginInit(onPluginInit)
            window.electron.offDeployFromEditor(onPluginLoaded)
            window.electron.offPluginUnLoaded(onPluginUnloaded)
        };
    }, [])

    const pluginIsReady = plugin && isPluginReady(plugin);

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
                        <NavigationPluginsButton active={state.activePlugins} all={state.plugins}
                                                 buttonMenuRef={buttonMenuRef}
                                                 selectPlugin={selectPlugin} deselectPlugin={deselectPlugin}
                                                 deselectAllPlugins={deselectAllPlugins}
                        />
                    </Navbar.Group>
                    <Navbar.Group align={Alignment.END}>
                        <InputGroup
                            leftIcon={"search"} placeholder={"Search..."} inputClassName={styles["header-search"]}
                            rightElement={<Tag minimal={true} className={"bp5-monospace-text"}
                                               style={{fontSize: "0.6rem", background: "black"}}>Cmd+K</Tag>}
                            onClick={() => setShowCommandSearch(true)}
                            value=""
                            onKeyPress={() => setShowCommandSearch(true)}
                        />
                        <Navbar.Divider/>
                        <Button variant={"minimal"} icon={showRightSideBar ? "menu-open" : "menu-closed"}
                                onClick={() => setShowRightSideBar(!showRightSideBar)}/>
                    </Navbar.Group>
                </Navbar>
                {showRightSideBar && (
                    <SideBar position={"right"} menuItems={sideBarActionItems}/>
                )}
                <div style={{
                    marginLeft: (state.plugins.length > 0 ? "50px" : ""),
                    marginRight: (showRightSideBar ? "50px" : "")
                }}>
                    {pluginIsReady && <PluginContainer plugin={plugin}/>}
                </div>
            </div>
        </KBarProvider>
    );
}
