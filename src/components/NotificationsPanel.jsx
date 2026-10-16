import {Button, ButtonGroup, Drawer, DrawerSize, InputGroup, NonIdealState} from "@blueprintjs/core";

import PropTypes from "prop-types";
import {useMemo, useState} from "react";

import {NotificationList} from './NotificationList';

import * as styles from "./css/NotificationsPanel.module.css";

export const NotificationsPanel = ({notificationsShow, setNotificationsShow, notifications}) => {
    const [searchTerm, setSearchTerm] = useState("");

    const filteredNotifications = useMemo(() => {
        if (!notificationsShow || !notifications || notifications.length === 0) return [];
        const lcSearch = searchTerm.toLowerCase();

        return [...notifications]
            .filter((n) => {
                if (!searchTerm) return true;
                return (
                    n.title?.toLowerCase().includes(lcSearch) ||
                    n.message?.toLowerCase().includes(lcSearch)
                );
            })
            .sort((a, b) =>
                (a.read === b.read ? 0 : a.read ? 1 : -1) ||
                new Date(b.createdAt) - new Date(a.createdAt)
            );
    }, [notificationsShow, notifications, searchTerm]);

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
            {notificationsShow && (filteredNotifications.length > 0 ? (
                <NotificationList key={searchTerm} notifications={filteredNotifications}/>
            ) : (
                <div className={styles.panelContent}>
                    <NonIdealState icon="notifications" title="No notifications"
                                   description="You're all caught up!" layout="vertical"/>
                </div>
            ))}
            {filteredNotifications.length > 0 && <div className={styles.notificationCount} role="status">
                {filteredNotifications.length} {filteredNotifications.length === 1 ? 'notification' : 'notifications'}
            </div>}
        </Drawer>
    );
};
NotificationsPanel.propTypes = {
    notificationsShow: PropTypes.bool.isRequired,
    setNotificationsShow: PropTypes.func.isRequired,
    notifications: PropTypes.array
}
