import {Button, ButtonGroup, Callout, Drawer, DrawerSize, Icon, InputGroup} from "@blueprintjs/core";
import {formatDistanceToNow} from 'date-fns';

import PropTypes from "prop-types";
import {useEffect, useMemo, useState} from "react";

import * as styles from "./css/NotificationsPanel.module.css";

export const NotificationsPanel = ({notificationsShow, setNotificationsShow, notifications}) => {
    const [searchTerm, setSearchTerm] = useState("");

    const filteredNotifications = useMemo(() => {
        if (!notifications || notifications.length === 0) return [];

        return [...notifications]
            .filter((n) => {
                if (!searchTerm) return true;
                const lcSearch = searchTerm.toLowerCase();
                return (
                    n.title?.toLowerCase().includes(lcSearch) ||
                    n.message?.toLowerCase().includes(lcSearch)
                );
            })
            .sort((a, b) =>
                (a.read === b.read ? 0 : a.read ? 1 : -1) ||
                new Date(b.createdAt) - new Date(a.createdAt)
            );
    }, [notifications, searchTerm]);

    useEffect(() => {
        if (notificationsShow) {
            const unreadIds = notifications.filter(n => !n.read).map(n => n.id);
            if (unreadIds.length > 0) {
                unreadIds.forEach(id => {
                    window.electron.notifications.markAsRead(id)
                });
            }
        }
    }, [notificationsShow]);

    return (
        <Drawer icon={"notifications"} isOpen={notificationsShow} onClose={() => setNotificationsShow(false)}
                size={DrawerSize.SMALL} title="Notifications">
            <ButtonGroup fill style={{ width: "100%", justifyContent: "space-between", padding: "5px"}}>
                <Button icon="eye-open" intent={"primary"} onClick={() => {
                    window.electron.notifications.markAllAsRead()
                }}>
                    Mark all as read
                </Button>
                <Button icon="trash" intent="danger" onClick={() => {
                    window.electron.notifications.removeAll()
                }}>
                    Remove all
                </Button>
            </ButtonGroup>
            <div className={styles.filterInput}>
                <InputGroup
                    leftIcon={"filter"}
                    onValueChange={setSearchTerm}
                    placeholder="Filter notifications..."
                    value={searchTerm}
                    fill={true}
                />
            </div>
            <div className={styles.panelContent}>
                {filteredNotifications.length > 0 ? (
                    filteredNotifications.map((notification) => (
                        <Callout
                            key={notification.id}
                            intent={notification.type}
                            title={
                                <div className={styles.titleRow}>
                                    <span className={!notification.read ? styles.unreadTitle : undefined}>
                                        {notification.title} <span
                                        className={"bp5-text-small bp5-text-muted bp5-running-text"}>{formatDistanceToNow(new Date(notification.createdAt), {addSuffix: true})}</span>
                                    </span>
                                    <Icon
                                        icon="cross"
                                        className={styles.dismissIcon}
                                        onClick={() => {
                                            window.electron.notifications.remove(notification.id)
                                        }}
                                        tabIndex={0}
                                    />
                                </div>
                            }
                            className={styles.callout}
                        >
                            {notification.message}
                        </Callout>
                    ))
                ) : (
                    <Callout>No notifications</Callout>
                )}
            </div>
        </Drawer>
    );
};
NotificationsPanel.propTypes = {
    notificationsShow: PropTypes.bool.isRequired,
    setNotificationsShow: PropTypes.func.isRequired,
    notifications: PropTypes.array
}