import {Button, Callout, H5} from '@blueprintjs/core';
import {formatDistanceToNow} from 'date-fns';
import {memo, useLayoutEffect, useMemo, useRef, useState} from 'react';
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

const NotificationItem = memo(function NotificationItem({notification}) {
    return <Callout intent={notification.type} className={styles.callout}>
        <H5 className={styles.titleRow}>
            <span className={!notification.read ? styles.unreadTitle : undefined}>
                {notification.title} <span className={`bp6-text-small bp6-text-muted bp6-running-text ${styles.timestamp}`}>
                    {formatDistanceToNow(new Date(notification.createdAt), {addSuffix: true})}
                </span>
            </span>
            <Button icon="cross" variant="minimal" size="small" aria-label={`Dismiss ${notification.title}`}
                    onClick={() => window.electron.notifications.remove(notification.id)}/>
        </H5>
        {notification.message}
    </Callout>;
});
NotificationItem.propTypes = {notification: PropTypes.object.isRequired};

export function NotificationList({notifications}) {
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
            {notifications.slice(start, end).map((notification, index) => <div key={notification.id}
                role="listitem" aria-posinset={start + index + 1} aria-setsize={notifications.length}
                data-notification-id={notification.id} className={styles.virtualRow}
                style={{top: offsets[start + index]}}>
                <NotificationItem notification={notification}/>
            </div>)}
        </div>
    </div>;
}
NotificationList.propTypes = {notifications: PropTypes.array.isRequired};
