import {Button, ButtonGroup, Callout, Drawer, HTMLSelect, InputGroup, NonIdealState} from '@blueprintjs/core';
import PropTypes from 'prop-types';
import {useEffect, useMemo, useState} from 'react';
import {NotificationList} from './NotificationList';
import NotificationPreferences, {SOURCE_LABELS} from './NotificationPreferences';
import {notificationPresentation, notificationSource, NOTIFICATION_SOURCES} from '../utils/desktop/notificationModel';
import * as styles from './css/NotificationsPanel.module.css';

export const NotificationsPanel = ({notificationsShow, setNotificationsShow, notifications: records = [], plugins = [], onAction, focusRequest}) => {
    const notifications = useMemo(() => records.map(record => notificationPresentation(record, plugins)), [records, plugins]);
    const [searchTerm, setSearchTerm] = useState('');
    const [filter, setFilter] = useState('all');
    const [source, setSource] = useState('all');
    const [preferencesOpen, setPreferencesOpen] = useState(false);
    const [error, setError] = useState('');
    const [undo, setUndo] = useState(null);
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        if (!focusRequest) return;
        setSearchTerm(''); setFilter('all'); setSource('all'); setPreferencesOpen(false);
    }, [focusRequest]);
    useEffect(() => {
        if (!undo) return;
        const timer = setTimeout(() => setUndo(null), 12000);
        return () => clearTimeout(timer);
    }, [undo]);
    const filteredNotifications = useMemo(() => {
        if (!notificationsShow) return [];
        const query = searchTerm.trim().toLowerCase();
        return notifications.filter(item => (filter !== 'unread' || !item.read)
            && (filter !== 'attention' || (['warning', 'danger'].includes(item.type) && item.status !== 'resolved'))
            && (source === 'all' || notificationSource(item) === source)
            && (!query || [item.title, item.message, item.details].some(text => text?.toLowerCase().includes(query))))
            .sort((a, b) => new Date(b.lastOccurredAt || b.createdAt) - new Date(a.lastOccurredAt || a.createdAt));
    }, [notificationsShow, notifications, searchTerm, filter, source]);
    const run = async action => {
        setBusy(true); setError('');
        try {return await action();}
        catch (reason) {setError(reason.message || 'Could not update notifications. Please try again.');}
        finally {setBusy(false);}
    };
    const dismiss = id => run(async () => {
        const result = await (id ? window.electron.notifications.remove(id) : window.electron.notifications.removeAll());
        if (result?.undoToken) setUndo({token: result.undoToken, message: id ? 'Notification dismissed.' : 'Notifications dismissed.'});
    });
    const hasFilters = !!searchTerm.trim() || filter !== 'all' || source !== 'all';
    return <Drawer icon="notifications" isOpen={notificationsShow} onClose={() => setNotificationsShow(false)} size="min(560px, 100vw)" title="Notifications">
        <div className={styles.toolbar}>
            {preferencesOpen ? <Button variant="minimal" icon="arrow-left" onClick={() => setPreferencesOpen(false)}>Back to notifications</Button> : <ButtonGroup>
                <Button icon="eye-open" disabled={busy || !notifications.some(item => !item.read)} onClick={() => run(() => window.electron.notifications.markAllAsRead())}>Mark all as read</Button>
                <Button icon="trash" disabled={busy || !notifications.length} onClick={() => dismiss()}>Dismiss all</Button>
            </ButtonGroup>}
            <Button icon="cog" aria-label="Notification preferences" title="Notification preferences" active={preferencesOpen}
                aria-expanded={preferencesOpen} onClick={() => setPreferencesOpen(value => !value)}/>
        </div>
        {error && <Callout intent="danger" role="alert" className={styles.feedback}>{error}</Callout>}
        {preferencesOpen ? <div className={styles.panelContent}><NotificationPreferences/></div> : <>
            <div className={styles.filterInput}>
                <InputGroup leftIcon="search" aria-label="Search notifications" placeholder="Filter notifications..." value={searchTerm} onValueChange={setSearchTerm}
                    rightElement={searchTerm ? <Button variant="minimal" icon="cross" aria-label="Clear notification search" onClick={() => setSearchTerm('')}/> : undefined}/>
                <div className={styles.filterRow}>
                    <ButtonGroup role="group" aria-label="Notification status filter">
                        {[['all', 'All'], ['unread', 'Unread'], ['attention', 'Needs attention']].map(([id, label]) =>
                            <Button key={id} size="small" active={filter === id} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</Button>)}
                    </ButtonGroup>
                    <HTMLSelect aria-label="Notification source" value={source} onChange={event => setSource(event.target.value)}
                        options={[{value: 'all', label: 'All sources'}, ...NOTIFICATION_SOURCES.map(value => ({value, label: SOURCE_LABELS[value]}))]}/>
                </div>
            </div>
            {notificationsShow && (filteredNotifications.length ? <NotificationList key={`${searchTerm}:${filter}:${source}`} notifications={filteredNotifications}
                onDismiss={dismiss} onAction={onAction} onError={setError} focusRequest={focusRequest}/> :
                <div className={styles.panelContent}><NonIdealState icon={hasFilters ? 'search' : 'notifications'} title={hasFilters ? 'No matching notifications' : 'No notifications'}
                    description={hasFilters ? 'Try another filter or search term.' : "You're all caught up!"} layout="vertical"
                    action={hasFilters ? <Button onClick={() => {setSearchTerm(''); setFilter('all'); setSource('all');}}>Clear filters</Button> : undefined}/></div>)}
            <div className={styles.notificationCount} role="status">{filteredNotifications.length} {filteredNotifications.length === 1 ? 'notification' : 'notifications'}
                {hasFilters && ` of ${notifications.length}`}</div>
        </>}
        {undo && !preferencesOpen && <div className={styles.undo} role="status"><span>{undo.message}</span><Button size="small" intent="primary" disabled={busy} onClick={() => run(async () => {
            const result = await window.electron.notifications.undo(undo.token);
            if (!result?.success) throw new Error('Undo expired. The notification remains dismissed.');
            setUndo(null);
        })}>Undo</Button></div>}
    </Drawer>;
};
NotificationsPanel.propTypes = {
    notificationsShow: PropTypes.bool.isRequired, setNotificationsShow: PropTypes.func.isRequired,
    notifications: PropTypes.array, onAction: PropTypes.func,
};
