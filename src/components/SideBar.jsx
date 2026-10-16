import React, {useEffect, useRef, useState} from "react";
import {Button, Icon, Menu, MenuItem, PopoverNext as Popover, Tooltip} from "@blueprintjs/core";
import classNames from "classnames";
import * as styles from "./css/SideBar.module.css"
import PropTypes from "prop-types";
import {sanitizeBlueprintIcon} from "../utils/presentation/blueprintIcons";
import FdoAiMark from './ai/FdoAiMark';

const sidebarIcon = item => item.id === 'system-ai-chat'
    ? <FdoAiMark size={20} ambient/>
    : <Icon icon={sanitizeBlueprintIcon(item.icon, "dot")} size={20}/>;

const sidebarLabel = item => item.pluginName ? `${item.name} · ${item.pluginName}` : item.name;

export const SideBar = ({position, menuItems, click, activeItemId = "", topOffset = 50}) => {
    const [visibleItems, setVisibleItems] = useState(0);
    const [hiddenItems, setHiddenItems] = useState([]);
    const [openPopupItemId, setOpenPopupItemId] = useState("");
    const sidebarRef = useRef(null)

    useEffect(() => {
        const updateVisibleItems = () => {
            if (sidebarRef.current) {
                const sidebarHeight = sidebarRef.current.clientHeight;
                const itemHeight = 50; // Approximate height per item
                const maxItems = Math.max(1, Math.floor(sidebarHeight / itemHeight));
                const count = menuItems.length > maxItems ? maxItems - 1 : maxItems;
                setVisibleItems(count);
                setHiddenItems(menuItems.slice(count));
            }
        };

        updateVisibleItems();
        window.addEventListener("resize", updateVisibleItems);
        return () => window.removeEventListener("resize", updateVisibleItems);
    }, [menuItems]);

    useEffect(() => {
        if (!openPopupItemId) {
            return;
        }
        const stillVisible = menuItems.some((item) => item?.id === openPopupItemId);
        if (!stillVisible) {
            setOpenPopupItemId("");
        }
    }, [menuItems, openPopupItemId]);

    return (
        <div
            ref={sidebarRef}
            className={classNames(styles["sidebar"], styles["collapsed"], styles[position])}
            style={{
                top: `${topOffset}px`,
                height: `calc(100% - ${topOffset}px)`,
            }}
        >
            {/* Sidebar Items */}
            <div className={styles["menu"]}>
                {menuItems.slice(0, visibleItems).map((item) => (
                    <div key={item.id}>
                        {(item.submenu_list && item.submenu_list.length > 0) && (
                            <Popover
                                content={
                                    <Menu>
                                        {item.submenu_list.map((subItem) => (
                                            <MenuItem key={subItem.id} text={subItem.name} disabled={item.disabled || subItem.disabled}
                                                      onClick={() => click(item.id, subItem.id)}/>
                                        ))}
                                    </Menu>
                                }
                                position={position === "left" ? "right" : "left"}
                                disabled={item.disabled}
                            >
                                <Tooltip content={sidebarLabel(item)}>
                                    <div className={classNames(styles["menu-item"], item.id === activeItemId && styles["menu-item-active"])}
                                         data-plugin-sidebar-item={item.id} data-plugin-active={item.id === activeItemId ? "true" : "false"}>
                                        <Button className={styles["icon-button"]} variant={"minimal"} size={"large"} aria-label={item.name || item.icon} disabled={item.disabled} loading={item.loading} aria-pressed={item.id === activeItemId}>
                                            {sidebarIcon(item)}
                                        </Button>
                                    </div>
                                </Tooltip>
                            </Popover>
                        )}
                        {(!item.submenu_list || item.submenu_list.length === 0) && (
                            <Popover
                                isOpen={openPopupItemId === item.id}
                                onInteraction={(nextOpenState) => {
                                    // Open plugin action popup only for the currently active plugin.
                                    if (nextOpenState) {
                                        if (item.id === activeItemId) {
                                            setOpenPopupItemId(item.id);
                                        }
                                        return;
                                    }
                                    setOpenPopupItemId("");
                                }}
                                position={position === "left" ? "right" : "left"}
                                minimal={true}
                                interactionKind={"click"}
                                content={Array.isArray(item.popupActions) && item.popupActions.length > 0 ? (
                                    <Menu>
                                        {item.popupActions.map((popupAction) => (
                                            <MenuItem
                                                key={`${item.id}-${popupAction.id}`}
                                                icon={sanitizeBlueprintIcon(popupAction.icon, "dot")}
                                                text={popupAction.name}
                                                labelElement={popupAction.labelElement || null}
                                                onClick={() => {
                                                    click(item.id, popupAction.id);
                                                    setOpenPopupItemId("");
                                                }}
                                            />
                                        ))}
                                    </Menu>
                                ) : <div/>}
                                disabled={item.disabled || !Array.isArray(item.popupActions) || item.popupActions.length === 0}
                            >
                                <Tooltip content={item.tooltip || (item.id === activeItemId ? `${sidebarLabel(item)} (active)` : sidebarLabel(item))}>
                                    <div
                                        className={classNames(
                                            styles["menu-item"],
                                            item.id === activeItemId && styles["menu-item-active"],
                                            item.intent === "warning" && styles["menu-item-warning"]
                                        )}
                                        data-plugin-sidebar-item={item.id}
                                        data-plugin-active={item.id === activeItemId ? "true" : "false"}
                                    >
                                        <div className={styles["notification-container"]}>
                                            <Button className={styles["icon-button"]} variant={"minimal"} size={"large"} aria-label={item.name || item.icon} disabled={item.disabled}
                                                    onClick={() => {
                                                        const hasPopupActions = Array.isArray(item.popupActions) && item.popupActions.length > 0;
                                                        const isActive = item.id === activeItemId;
                                                        if (!isActive) {
                                                            click(item.id);
                                                            setOpenPopupItemId("");
                                                            return;
                                                        }
                                                        if (hasPopupActions) {
                                                            setOpenPopupItemId((prev) => prev === item.id ? "" : item.id);
                                                        }
                                                    }}
                                                    loading={item.loading}
                                                    intent={item.intent || (item.id === activeItemId ? "primary" : "none")}
                                                    aria-pressed={item.id === activeItemId}>
                                                {sidebarIcon(item)}
                                            </Button>
                                            <span
                                                className={styles["notification-dot"]}
                                                hidden={!item.notifications || item.notifications.filter(n => !n.read).length === 0}
                                            />
                                        </div>
                                    </div>
                                </Tooltip>
                            </Popover>
                        )}
                    </div>
                ))}
                {hiddenItems.length > 0 && (
                    <Popover
                        content={
                            <Menu>
                                {hiddenItems.map((item, index) => (
                                    <MenuItem key={index + 1} icon={item.id === 'system-ai-chat' ? sidebarIcon(item) : sanitizeBlueprintIcon(item.icon, "dot")} text={item.name} label={item.pluginName}
                                              onClick={item.submenu_list?.length ? undefined : () => click(item.id)} disabled={item.disabled || item.loading}>
                                        {item.submenu_list?.map(subItem => <MenuItem key={subItem.id} text={subItem.name} disabled={item.disabled || subItem.disabled}
                                            onClick={() => click(item.id, subItem.id)}/>)}
                                    </MenuItem>
                                ))}
                            </Menu>
                        }
                        position={position === "left" ? "right" : "left"}
                    >
                        <Tooltip content={"More plugins"}>
                            <div className={styles["menu-item"]}>
                                <Button className={styles["icon-button"]} variant={"minimal"} size={"large"} aria-label={"more"}>
                                    <Icon icon={"more"} size={20}/>
                                </Button>
                            </div>
                        </Tooltip>
                    </Popover>
                )}
            </div>
        </div>
    );
}
SideBar.propTypes = {
    position: PropTypes.string,
    menuItems: PropTypes.array,
    click: PropTypes.func,
    activeItemId: PropTypes.string,
    topOffset: PropTypes.number,
}
