import {useEffect, useRef, useState} from "react";
import {Button, Icon, Menu, MenuItem, Popover, Tooltip} from "@blueprintjs/core";
import classNames from "classnames";
import * as styles from "./css/SideBar.module.css"
import PropTypes from "prop-types";

export const SideBar = ({position, menuItems, click}) => {
    const [visibleItems, setVisibleItems] = useState(0);
    const [hiddenItems, setHiddenItems] = useState([]);
    const sidebarRef = useRef(null)

    useEffect(() => {
        const updateVisibleItems = () => {
            if (sidebarRef.current) {
                const sidebarHeight = sidebarRef.current.clientHeight;
                const itemHeight = 50; // Approximate height per item
                const maxItems = Math.floor(sidebarHeight / itemHeight);
                setVisibleItems(maxItems);
                setHiddenItems(menuItems.slice(maxItems));
            }
        };

        updateVisibleItems();
        window.addEventListener("resize", updateVisibleItems);
        return () => window.removeEventListener("resize", updateVisibleItems);
    }, []);

    return (
        <div ref={sidebarRef} className={classNames(styles["sidebar"], styles["collapsed"], styles[position])}>
            {/* Sidebar Items */}
            <div className={styles["menu"]}>
                {menuItems.slice(0, visibleItems - (hiddenItems.length > 0 ? 1 : 0)).map((item, index) => (
                    <Tooltip key={index+1} content={item.name}>
                        <div className={styles["menu-item"]}>
                            <Button variant={"minimal"} size={"large"} aria-label={item.icon} onClick={() => click(item.id)}>
                                <Icon icon={item.icon} size={20}/>
                            </Button>
                        </div>
                    </Tooltip>
                ))}
                {hiddenItems.length > 0 && (
                    <Popover
                        content={
                            <Menu>
                                {hiddenItems.map((item, index) => (
                                    <MenuItem key={index+1} icon={item.icon} text={item.name} onClick={() => click(item.id)} />
                                ))}
                            </Menu>
                        }
                        position={position === "left" ? "right" : "left"}
                    >
                        <Tooltip content={"More plugins"}>
                            <div className={styles["menu-item"]}>
                                <Icon icon={"more"} size={20} />
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
    click: PropTypes.func
}
