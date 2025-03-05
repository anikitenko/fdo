import React, {useEffect, useRef, useState} from 'react'
import {Alignment, Button, Divider, Intent, Menu, MenuItem, Navbar, Popover, Tooltip} from "@blueprintjs/core";
import * as styles from './Home.module.scss'
import {NavigationPluginsButton} from "./components/NavigationPluginsButton.jsx";
import {MultiSelect} from "@blueprintjs/select";
import {CreatePluginDialog} from "./components/CreatePluginDialog.jsx";
import {AppToaster} from "./components/AppToaster.jsx";
import {PluginContainer} from "./components/PluginContainer.jsx";

function Home() {
    const popoverRef = React.createRef();
    const [showMore, setShowMore] = useState(false);
    const [showCreateDialog, setShowCreateDialog] = useState(false);
    const [createDialogName, setCreateDialogName] = useState('');
    const [visibleButtons, setVisibleButtons] = useState([]);
    const [state, setState] = useState({
        createdItems: [],
        plugins: [],
        items: [],
    });
    const [pluginId, setPluginId] = useState(null);

    const INTENTS = [Intent.NONE, Intent.PRIMARY, Intent.SUCCESS, Intent.DANGER, Intent.WARNING];
    const getTagProps = (_value, index) => ({
        intent: INTENTS[index % INTENTS.length],
        minimal: false,
    });
    const renderPluginTag = (plugin) => plugin.name;
    const getSelectedPluginIndex = (plugin) => {
        return state.plugins.map(item => item.id).indexOf(plugin.id);
    }
    const isPluginSelected = (plugin) => {
        return getSelectedPluginIndex(plugin) !== -1;
    }

    const containerRef = useRef(null);
    const buttonWidth = 128; // Estimated default width

    const updateVisibleButtons = () => {
        if (!containerRef.current) return;

        const containerWidth = containerRef.current.offsetWidth; // Get actual navbar width
        const numVisible = Math.max(
            1,
            Math.floor(containerWidth / buttonWidth) // Use full width instead of baseWidth
        );

        const visible = state.plugins.slice(0, numVisible);
        setVisibleButtons(visible);

        setShowMore(visible.length < state.plugins.length);
    }
    useEffect(() => {
        updateVisibleButtons();
        window.addEventListener("resize", updateVisibleButtons);
        return () => window.removeEventListener("resize", updateVisibleButtons);
    }, [state.plugins]);

    const getPluginItemProps = (plugin, {handleClick, handleFocus, modifiers, query, ref}) => {
        return {
            active: modifiers.active,
            disabled: modifiers.disabled,
            label: plugin.version,
            onClick: handleClick,
            onFocus: handleFocus,
            ref,
            text: highlightText(`${plugin.version}. ${plugin.name}`, query),
        }
    }

    const pluginRenderer = (plugin, props) => {
        if (!props.modifiers.matchesPredicate) {
            return null;
        }

        return (
            <MenuItem
                {...getPluginItemProps(plugin, props)}
                key={plugin.id}
                icon={plugin.icon}
                roleStructure="listoption"
                selected={isPluginSelected(plugin)}
                shouldDismissPopover={false}
                text={plugin.name}
            />
        );
    };

    const addPluginToArray = (plugins, pluginToAdd) => {
        return [...plugins, pluginToAdd]
    }

    const arrayContainsPlugin = (plugins, pluginToFind) => {
        return plugins.some(plugin => plugin.name === pluginToFind.name);
    }

    const maybeAddCreatedPluginToArrays = (items, createdItems, plugin) => {
        const isNewlyCreatedItem = !arrayContainsPlugin(items, plugin);
        return {
            createdItems: isNewlyCreatedItem ? addPluginToArray(createdItems, plugin) : createdItems,
            items: isNewlyCreatedItem ? addPluginToArray(items, plugin) : items,
        };
    }

    const deletePluginFromArray = (plugins, pluginToDelete) => {
        return plugins.filter(plugin => plugin.id !== pluginToDelete.id);
    }

    const maybeDeleteCreatedPluginFromArrays = (items, createdItems, plugin) => {
        if (plugin === undefined) {
            return {
                createdItems,
                items,
            };
        }

        const wasItemCreatedByUser = false;

        // Delete the item if the user manually created it.
        return {
            createdItems: wasItemCreatedByUser ? deletePluginFromArray(createdItems, plugin) : createdItems,
            items: wasItemCreatedByUser ? deletePluginFromArray(items, plugin) : items,
        };
    }

    const selectPlugins = (pluginsToSelect) => {
        setState(({createdItems, plugins, items}) => {
            let nextCreatedItems = createdItems.slice();
            let nextPlugins = plugins.slice();
            let nextItems = items.slice();

            pluginsToSelect.forEach(plugin => {
                const results = maybeAddCreatedPluginToArrays(nextItems, nextCreatedItems, plugin);
                nextItems = results.items;
                nextCreatedItems = results.createdItems;
                // Avoid re-creating an item that is already selected (the "Create
                // Item" option will be shown even if it matches an already selected
                // item).
                nextPlugins = !arrayContainsPlugin(nextPlugins, plugin) ? [...nextPlugins, plugin] : nextPlugins;
            });
            return {
                createdItems: nextCreatedItems,
                plugins: nextPlugins,
                items: nextItems,
            };
        });
    }

    const deselectPlugin = (index) => {
        const {plugins} = state;
        const plugin = plugins[index];
        const { createdItems: nextCreatedItems, items: nextItems } = maybeDeleteCreatedPluginFromArrays(
            state.items,
            state.createdItems,
            plugin,
        );

        // Delete the item if the user manually created it. (const wasItemCreatedByUser = false)

        window.electron.DeactivatePlugin(plugin.id).then (async (result) => {
            if (result) {
                if (result.success) {
                    setState( {
                        createdItems: nextCreatedItems,
                        plugins: plugins.filter((_plugin, i) => i !== index),
                        items: nextItems,
                    });
                } else {
                    (await AppToaster).show({ message: `Error: ${result.error}`, intent: "danger" });
                }
            } else {
                (await AppToaster).show({ message: `Failed to deactivate plugin`, intent: "danger" });
            }
        });
    }

    const handleTagRemove = (_tag, index) => {
        deselectPlugin(index);
    };

    const selectPlugin = (plugin) => {
        window.electron.ActivatePlugin(plugin.id).then (async (result) => {
            if (result) {
                if (result.success) {
                    selectPlugins([plugin])
                } else {
                    (await AppToaster).show({ message: `Error: ${result.error}`, intent: "danger" });
                }
            } else {
                (await AppToaster).show({ message: `Failed to activate plugin`, intent: "danger" });
            }
        });
    };

    const handlePluginSelect = (plugin) => {
        if (plugin.id === "new") {
            setShowCreateDialog(true);
            setCreateDialogName(plugin.name);
            return
        }

        if (!isPluginSelected(plugin)) {
            selectPlugin(plugin);
        } else {
            deselectPlugin(getSelectedPluginIndex(plugin));
        }
    }

    const handlePluginsPaste = (plugins) => {
        selectPlugins(plugins)
    }

    const handlePluginsClear = () => {
        window.electron.DeactivateAllPlugins().then(async (result) => {
            if (result) {
                if (result.success) {
                    setState(prevState => (
                        {
                            ...prevState, plugins: []
                        }
                    ))
                } else {
                    (await AppToaster).show({message: `Error: ${result.error}`, intent: "danger"});
                }
            } else {
                (await AppToaster).show({message: `Failed to deactivate all plugin`, intent: "danger"});
            }
        });
    };

    const filterPlugin = (query, plugin, _index, exactMatch) => {
        const normalizedTitle = plugin.name.toLowerCase();
        const normalizedQuery = query.toLowerCase();

        if (exactMatch) {
            return normalizedTitle === normalizedQuery;
        } else {
            return normalizedTitle.indexOf(normalizedQuery) >= 0;
        }
    };

    const arePluginsEqual = (pluginA, pluginB) => {
        return pluginA.name.toLowerCase() === pluginB.name.toLowerCase();
    }

    const renderCustomPluginsTarget = () => <NavigationPluginsButton countEnabled={state.plugins.length}
                                                                     countDisabled={state.items.length - state.plugins.length}/>;

    const showMorePlugins = (buttons) => {
        return (
            <Menu>
                {buttons.slice(visibleButtons.length).map((button, index) => (
                    <MenuItem key={index} text={button.name} icon={button.icon}/>
                ))}
            </Menu>
        )
    }

    const createPlugins = (query) => {
        const titles = query.split(", ");
        return titles.map((title) => ({
            id: "new",
            name: title,
            icon: "cog",
            version: "1.0.0",
        }));
    }

    const renderCreatePluginsMenuItem = (query, active, handleClick) => (
        <>
            <Divider/>
        <MenuItem
            icon="add"
            text={`Create ${printReadableList(query)}`}
            roleStructure="listoption"
            active={active}
            onClick={handleClick}
            shouldDismissPopover={false}
        />
            {renderManagePluginsMenuItem()}
            </>
    );

    const renderManagePluginsMenuItem = () => (
        <MenuItem
            icon="cog"
            text="Manage plugins"
            roleStructure="listoption"
        />
    )

    const customPluginListRenderer = ({ items, itemsParentRef, renderItem }) => {
        return (
            <Menu ulRef={itemsParentRef}>
                {items.map(renderItem)}
                <Divider/>
                <MenuItem
                    icon="add"
                    text={`Create`}
                    roleStructure="listoption"
                    onClick={() => {
                        const enterEvent = new KeyboardEvent("keydown", {
                            key: "Enter",
                            code: "Enter",
                            keyCode: 13,
                            bubbles: true
                        });
                        renderItem.dispatchEvent(enterEvent); // Dispatch event globally
                    }}
                    shouldDismissPopover={false}
                />
                {renderManagePluginsMenuItem()}
            </Menu>
        );
    };

    const pluginsInitialLoad = useRef(false);
    useEffect(() => {
        if (pluginsInitialLoad.current) return;
        pluginsInitialLoad.current = true;
        window.electron.GetAllPlugins().then ((allPlugins) => {
            window.electron.GetActivatedPlugins().then ((activePlugins) => {
                setState(prevState => (
                    {
                        ...prevState, items: allPlugins.plugins.map(plugin => {
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
    useEffect(() => {
        if (isProcessingPluginFromEditor.current) return;
        const onPluginLoaded = (loadedPlugin) => {
            if (loadedPlugin) {
                window.electron.GetPlugin(loadedPlugin).then ((loadedPlugin) => {
                    const newPlugin = {...loadedPlugin.plugin, ...loadedPlugin.plugin.metadata, metadata: undefined};
                    setState(prevState => {
                        // Check if plugin already exists
                        const pluginExists = prevState.items.some(item => item.id === newPlugin.id);

                        if (pluginExists) {
                            return prevState;
                        }

                        selectPlugin(newPlugin);
                        return {
                            ...prevState,
                            items: [...prevState.items, newPlugin]
                        };
                    });
                })
            }

            isProcessingPluginFromEditor.current = false;
        }

        window.electron.onDeployFromEditor(onPluginLoaded)
        return () => {
            window.electron.offDeployFromEditor(onPluginLoaded);
        };
    }, [])

    return (
        <div className={styles["main-container"]}>
            {/* Top Navigation Bar */}
            <Navbar fixedToTop={true} className={"bp5-dark"}>
                <Navbar.Group>
                    {visibleButtons.map((button, index) => (
                        <React.Fragment key={index}>
                            <Tooltip
                                content={`${button.name} (${button.description})`}
                                placement="bottom"
                            >
                                <Button onClick={() => alert(button.id)} minimal
                                        text={<span className={styles["truncate"]}>{button.name}</span>}
                                        rightIcon={button.icon} className="host-manager-btn"/>
                            </Tooltip>
                            <Navbar.Divider hidden={index + 1 === visibleButtons.length}/>
                        </React.Fragment>
                    ))}
                    {showMore === true && (
                        <Popover
                            content={showMorePlugins(state.plugins)}
                        >
                            <Button minimal text="More..." rightIcon="caret-down"/>
                        </Popover>
                    )}
                </Navbar.Group>
                <Navbar.Group align={Alignment.RIGHT}>
                    <MultiSelect
                        customTarget={renderCustomPluginsTarget}
                        itemsEqual={arePluginsEqual}
                        itemPredicate={filterPlugin}
                        itemListRenderer={customPluginListRenderer}
                        itemRenderer={pluginRenderer}
                        items={state.items}
                        onItemSelect={handlePluginSelect}
                        onItemsPaste={handlePluginsPaste}
                        selectedItems={state.plugins}
                        tagRenderer={renderPluginTag}
                        tagInputProps={{
                            onRemove: handleTagRemove,
                            tagProps: getTagProps,
                        }}
                        resetOnSelect={true}
                        onClear={handlePluginsClear}
                        popoverRef={popoverRef}
                        menuProps={{"aria-label": "plugins"}}
                        noResults={
                            <>
                            <MenuItem disabled={true} text="No plugins." roleStructure="listoption"/>
                            {renderManagePluginsMenuItem()}
                            </>
                        }
                        placeholder={"Create new..."}
                        createNewItemFromQuery={createPlugins}
                        createNewItemRenderer={renderCreatePluginsMenuItem}
                    />
                    <Button variant={"minimal"} text="Settings" endIcon="cog"/>
                </Navbar.Group>
            </Navbar>
            {pluginId && <PluginContainer id={pluginId}/>}
            <CreatePluginDialog show={showCreateDialog}
                                close={() => setShowCreateDialog(false)}
                                name={createDialogName}
                                parentPluginSelect={handlePluginSelect}
            />
        </div>
    );
}

function escapeRegExpChars(text) {
    return text.replace(/([.*+?^=!:${}()|\[\]\/\\])/g, "\\$1");
}

function highlightText(text, query) {
    let lastIndex = 0;
    const words = query
        .split(/\s+/)
        .filter(word => word.length > 0)
        .map(escapeRegExpChars);
    if (words.length === 0) {
        return [text];
    }
    const regexp = new RegExp(words.join("|"), "gi");
    const tokens = [];
    while (true) {
        const match = regexp.exec(text);
        if (!match) {
            break;
        }
        const length = match[0].length;
        const before = text.slice(lastIndex, regexp.lastIndex - length);
        if (before.length > 0) {
            tokens.push(before);
        }
        lastIndex = regexp.lastIndex;
        tokens.push(<strong key={lastIndex}>{match[0]}</strong>);
    }
    const rest = text.slice(lastIndex);
    if (rest.length > 0) {
        tokens.push(rest);
    }
    return tokens;
}

function printReadableList(query) {
    return query
        .split(", ")
        .map((title, index, titles) => {
            const separator = index > 0 ? (index === titles.length - 1 ? " and " : ", ") : "";
            return `${separator}"${title}"`;
        })
        .join("");
}

export default Home
