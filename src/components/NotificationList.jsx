import {Button, Callout, H5, Tag, Tooltip} from '@blueprintjs/core';
import {formatDistance} from 'date-fns';
import {memo, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {notificationSource} from '../utils/desktop/notificationModel';
import {SOURCE_LABELS} from './NotificationPreferences';
import PropTypes from 'prop-types';
import * as styles from './css/NotificationsPanel.module.css';

const ESTIMATED_HEIGHT = 120;
const GAP = 12;
const OVERSCAN = 400;

function rowAt(offsets, position) {
    let low = 0, high = offsets.length - 1;
    while (low < high) {
        const mid = Math.floor((low + high + 1) / 2);
        if (offsets[mid] <= position) low = mid;
        else high = mid - 1;
    }
    return Math.min(low, Math.max(0, offsets.length - 2));
}

const ACTION_LABELS = {'view-plugin': 'View plugin', 'manage-plugin': 'Manage plugin', 'open-plugin-logs': 'Open plugin logs', 'view-settings': 'Open settings', 'view-gitops': 'View GitOps repository', 'open-repository': 'Open repository', 'retry-gitops': 'Retry'};
const NotificationItem = memo(function NotificationItem({notification, expanded, onExpand, onDismiss, onAction, onError, now}) {
    const [busy, setBusy] = useState(false);
    const perform = async action => {
        onError?.('');
        setBusy(true);
        try {await action();}
        catch (reason) {onError?.(reason.message || 'Could not complete this action. Please try again.');}
        finally {setBusy(false);}
    };
    const timestamp = notification.lastOccurredAt || notification.createdAt;
    const date = new Date(timestamp);
    const summary = notification.summary || (notification.message.length > 220 ? `${notification.message.slice(0, 180)}…` : notification.message);
    const details = notification.details || (summary !== notification.message ? notification.message : '');
    return <Callout intent={notification.status === 'resolved' ? 'success' : notification.type} className={styles.callout}>
        <H5 className={styles.titleRow}>
            <span className={!notification.read ? styles.unreadTitle : undefined}>
                {notification.title} <time dateTime={timestamp} title={Number.isFinite(date.getTime()) ? date.toLocaleString() : undefined}
                    className={`bp6-text-small bp6-text-muted bp6-running-text ${styles.timestamp}`}>
                    {Number.isFinite(date.getTime()) ? formatDistance(date, new Date(now), {addSuffix: true}) : 'Time unavailable'}
                </time>
            </span>
            <div className={styles.itemControls}>
            <Tooltip content={notification.read ? 'Mark as unread' : 'Mark as read'}>
                <Button icon={notification.read ? 'envelope' : 'dot'} variant="minimal" size="small"
                    aria-label={`${notification.read ? 'Mark unread' : 'Mark read'}: ${notification.title}`}
                    className={!notification.read ? styles.unreadControl : undefined} disabled={busy}
                    onClick={() => perform(() => notification.read ? window.electron.notifications.markAsUnread(notification.id) : window.electron.notifications.markAsRead(notification.id))}/>
            </Tooltip>
            <Button icon="cross" variant="minimal" size="small" aria-label={`Dismiss ${notification.title}`}
                    disabled={busy} onClick={() => onDismiss(notification.id)}/>
            </div>
        </H5>
        <div className={styles.cardMeta}><Tag variant="minimal">{SOURCE_LABELS[notificationSource(notification)]}</Tag>
            {!notification.read && <Tag variant="minimal" intent="primary">Unread</Tag>}
            {notification.status === 'resolved' && <Tag variant="minimal" intent="success">Resolved</Tag>}
            {notification.occurrences > 1 && <Tag variant="minimal">{notification.occurrences} occurrences</Tag>}
        </div>
        {summary && <p className={styles.summary}>{summary}</p>}
        {details && <><Button size="small" variant="minimal" icon={expanded ? 'chevron-up' : 'chevron-down'} aria-expanded={expanded} onClick={onExpand}>
            {expanded ? 'Hide details' : 'Show details'}</Button>
            {expanded && <pre className={styles.details}>{details}</pre>}</>}
        {!!notification.actions?.length && <div className={styles.cardActions}>
            {(notification.actions || []).filter(action => ACTION_LABELS[action.kind] && !(action.kind === 'retry-gitops' && notification.status === 'resolved')).map((action, index) =>
                <Button key={index} size="small" variant="outlined" disabled={busy || !onAction} loading={busy} onClick={() => perform(() => onAction(action, notification))}>{ACTION_LABELS[action.kind]}</Button>)}
        </div>}
    </Callout>;
});
NotificationItem.propTypes = {notification: PropTypes.object.isRequired};

export function NotificationList({notifications, onDismiss, onAction, onError, focusRequest}) {
    const [expanded, setExpanded] = useState({});
    const [highlight, setHighlight] = useState(null);
    const handledFocusRef = useRef(null);
    useEffect(() => {
        if (!highlight) return;
        const timer = setTimeout(() => setHighlight(null), 3500);
        return () => clearTimeout(timer);
    }, [highlight]);
    const [, setTime] = useState(0);
    const now = Date.now();
    useEffect(() => {const timer = setInterval(() => setTime(value => value + 1), 60000); return () => clearInterval(timer);}, []);
    const scrollerRef = useRef(/** @type {HTMLDivElement | null} */ (null));
    const geometryRef = useRef(null);
    const widthRef = useRef(null);
    const [heights, setHeights] = useState(() => new Map());
    const [viewport, setViewport] = useState({top: 0, height: 600});
    const geometry = useMemo(() => {
        const offsets = [0], indices = new Map();
        notifications.forEach((item, index) => {
            indices.set(item.id, index);
            offsets.push(offsets[index] + (heights.get(item.id) ?? ESTIMATED_HEIGHT) + GAP);
        });
        return {notifications, offsets, indices};
    }, [notifications, heights]);
    const {offsets} = geometry;
    const start = rowAt(offsets, Math.max(0, viewport.top - OVERSCAN));
    const end = Math.min(notifications.length, rowAt(offsets, viewport.top + viewport.height + OVERSCAN) + 1);

    // Keep the first visible item in place when measurements, inserts or sorting
    // change the height above it. At the top, new notifications remain visible.
    useLayoutEffect(() => {
        const scroller = scrollerRef.current;
        const previous = geometryRef.current;
        if (previous && previous !== geometry && scroller.scrollTop > 0) {
            const index = rowAt(previous.offsets, scroller.scrollTop);
            const id = previous.notifications[index]?.id;
            const nextIndex = geometry.indices.get(id);
            const top = nextIndex === undefined ? scroller.scrollTop
                : offsets[nextIndex] + scroller.scrollTop - previous.offsets[index];
            scroller.scrollTop = Math.max(0, Math.min(top, scroller.scrollHeight - scroller.clientHeight));
        }
        geometryRef.current = geometry;
        setViewport(previous => {
            const top = scroller.scrollTop, height = scroller.clientHeight || previous.height;
            return previous.top === top && previous.height === height ? previous : {top, height};
        });
    }, [geometry, offsets]);

    useLayoutEffect(() => {
        if (!focusRequest?.notificationId || handledFocusRef.current === focusRequest) return;
        const index = geometry.indices.get(focusRequest.notificationId);
        if (index === undefined) return;
        const scroller = scrollerRef.current;
        const row = [...scroller.querySelectorAll('[data-notification-id]')].find(node => node.dataset.notificationId === focusRequest.notificationId);
        if (!row) {
            scroller.scrollTop = offsets[index];
            setViewport(previous => ({...previous, top: scroller.scrollTop}));
            return;
        }
        row.scrollIntoView({block: 'nearest'});
        row.focus({preventScroll: true});
        handledFocusRef.current = focusRequest;
        setHighlight(focusRequest);
    }, [focusRequest, geometry, offsets, start, end]);

    useLayoutEffect(() => {
        const scroller = scrollerRef.current;
        const rows = Array.from(scroller.querySelectorAll('[data-notification-id]'));
        const measure = () => {
            const width = scroller.clientWidth;
            const resized = widthRef.current !== null && widthRef.current !== width;
            widthRef.current = width;
            const measured = rows.map(row => [row.dataset.notificationId, row.getBoundingClientRect().height]);
            setHeights(previous => {
                let next = resized ? new Map() : previous;
                const change = () => {if (next === previous) next = new Map(previous);};
                for (const [id, height] of measured) {
                    if (height > 0 && Math.abs((next.get(id) ?? ESTIMATED_HEIGHT) - height) > 0.5) {
                        change(); next.set(id, height);
                    }
                }
                for (const id of next.keys()) if (!geometry.indices.has(id)) {change(); next.delete(id);}
                return next;
            });
            setViewport(previous => {
                const top = scroller.scrollTop, height = scroller.clientHeight || previous.height;
                return previous.top === top && previous.height === height ? previous : {top, height};
            });
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(scroller);
        rows.forEach(row => observer.observe(row));
        return () => observer.disconnect();
    }, [notifications, start, end, geometry.indices]);

    return <div ref={scrollerRef} className={styles.panelContent} role="list" aria-label="Notifications" tabIndex={0}
                onScroll={event => {
                    const {scrollTop: top, clientHeight: height} = event.currentTarget;
                    setViewport(previous => previous.top === top && previous.height === height ? previous : {top, height: height || previous.height});
                }}>
        <div className={styles.virtualContent} style={{height: offsets[notifications.length]}}>
            {notifications.slice(start, end).map((notification, index) => <div key={`${notification.id}:${focusRequest?.notificationId === notification.id ? focusRequest.requestId : ''}`}
                role="listitem" aria-posinset={start + index + 1} aria-setsize={notifications.length}
                tabIndex={-1} data-notification-id={notification.id}
                data-notification-highlighted={highlight?.notificationId === notification.id ? 'true' : undefined}
                className={`${styles.virtualRow} ${highlight?.notificationId === notification.id ? styles.focusedRow : ''}`}
                style={{top: offsets[start + index]}}>
                <NotificationItem notification={notification} now={now} expanded={!!expanded[notification.id]}
                    onExpand={() => setExpanded(previous => ({...previous, [notification.id]: !previous[notification.id]}))}
                    onDismiss={onDismiss} onAction={onAction} onError={onError}/>
            </div>)}
        </div>
    </div>;
}
NotificationList.propTypes = {notifications: PropTypes.array.isRequired, onDismiss: PropTypes.func, onAction: PropTypes.func, onError: PropTypes.func};
