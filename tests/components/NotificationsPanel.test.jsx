import React from 'react';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {NotificationsPanel} from '../../src/components/NotificationsPanel';

const notices = (count = 1000) => Array.from({length: count}, (_, i) => ({id: String(i), title: `Notice ${i}`,
    message: `Message ${i}`, type: '', read: false, createdAt: '2026-10-16T10:00:00Z'}));
const props = {notificationsShow: true, setNotificationsShow: () => {}};
let observers;
beforeEach(() => {
    observers = [];
    global.ResizeObserver = class {
        constructor(callback) {this.callback = callback; this.disconnect = jest.fn(); observers.push(this);}
        observe() {}
    };
    window.electron.notifications = {remove: jest.fn(), markAllAsRead: jest.fn(), removeAll: jest.fn()};
});
afterEach(() => {delete global.ResizeObserver;});

function scroller() {
    const list = screen.getByRole('list', {name: 'Notifications'});
    Object.defineProperties(list, {
        clientHeight: {configurable: true, value: 600},
        scrollHeight: {configurable: true, get: () => parseFloat(list.firstElementChild.style.height) + 32},
    });
    return list;
}

test('loads on scroll, unloads offscreen rows, restores them in reverse, and reaches the last notification', () => {
    render(<NotificationsPanel {...props} notifications={notices()}/>);
    const list = scroller();
    expect(screen.getByText('Message 0')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem').length).toBeLessThan(20);
    expect(screen.queryByRole('button', {name: 'Next', exact: true})).not.toBeInTheDocument();
    fireEvent.scroll(list, {target: {scrollTop: 6600}});
    expect(screen.getByText('Message 50')).toBeInTheDocument();
    expect(screen.queryByText('Message 0')).not.toBeInTheDocument();
    fireEvent.scroll(list, {target: {scrollTop: list.scrollHeight - list.clientHeight}});
    expect(screen.getByText('Message 999')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem').length).toBeLessThan(20);
    fireEvent.scroll(list, {target: {scrollTop: 0}});
    expect(screen.getByText('Message 0')).toBeInTheDocument();
    expect(screen.queryByText('Message 999')).not.toBeInTheDocument();
});

test('searches unmounted history and resets the scroll position for a new search', () => {
    render(<NotificationsPanel {...props} notifications={notices()}/>);
    const list = scroller();
    fireEvent.scroll(list, {target: {scrollTop: 6600}});
    fireEvent.change(screen.getByPlaceholderText('Filter notifications...'), {target: {value: 'Message 999'}});
    expect(screen.getByText('Message 999')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent('1 notification');
    expect(screen.getByRole('list')).toHaveProperty('scrollTop', 0);
});

test('preserves the scroll anchor on insertion and recovers when the history is removed', () => {
    const notifications = notices();
    const {rerender} = render(<NotificationsPanel {...props} notifications={notifications}/>);
    const list = scroller();
    fireEvent.scroll(list, {target: {scrollTop: 6600}});
    rerender(<NotificationsPanel {...props} notifications={[{...notifications[0], id: 'new', createdAt: '2026-10-17T10:00:00Z'}, ...notifications]}/>);
    expect(list.scrollTop).toBe(6732);
    expect(screen.getByText('Message 50')).toBeInTheDocument();
    rerender(<NotificationsPanel {...props} notifications={notifications.slice(0, 10)}/>);
    expect(screen.getByText('Message 9')).toBeInTheDocument();
    expect(list.scrollTop).toBeLessThanOrEqual(list.scrollHeight - list.clientHeight);
    rerender(<NotificationsPanel {...props} notifications={[]}/>);
    expect(screen.getByText("You're all caught up!")).toBeInTheDocument();
});

test('remeasures variable-height rows without moving the visible anchor and disconnects on close', async () => {
    const notifications = notices();
    const {rerender} = render(<NotificationsPanel {...props} notifications={notifications}/>);
    const list = scroller();
    fireEvent.scroll(list, {target: {scrollTop: 6600}});
    const row = document.querySelector('[data-notification-id="48"]');
    jest.spyOn(row, 'getBoundingClientRect').mockReturnValue({height: 240});
    act(() => observers.at(-1).callback());
    expect(list.scrollTop).toBe(6720);
    expect(screen.getByText('Message 50')).toBeInTheDocument();
    rerender(<NotificationsPanel {...props} notificationsShow={false} notifications={notifications}/>);
    await waitFor(() => expect(screen.queryByRole('list')).not.toBeInTheDocument());
    expect(observers.every(observer => observer.disconnect.mock.calls.length > 0)).toBe(true);
});

test('keeps dismiss and bulk actions working', async () => {
    render(<NotificationsPanel {...props} notifications={notices(2)}/>);
    fireEvent.click(screen.getByRole('button', {name: 'Dismiss Notice 1'}));
    expect(window.electron.notifications.remove).toHaveBeenCalledWith('1');
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', {name: 'Mark all as read'}));
    expect(window.electron.notifications.markAllAsRead).toHaveBeenCalledTimes(1);
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', {name: 'Dismiss all'}));
    expect(window.electron.notifications.removeAll).toHaveBeenCalledTimes(1);
});

test('filters by unread, attention and source, searches details, and distinguishes no results', () => {
    const notifications = [
        {...notices(1)[0], id: 'failure', title: 'Sync failed', source: 'gitops', type: 'danger', details: 'commit abc123'},
        {...notices(1)[0], id: 'resolved', title: 'Recovered', source: 'gitops', type: 'success', status: 'resolved'},
        {...notices(1)[0], id: 'build', title: 'Build complete', source: 'builds', type: 'success', read: true},
    ];
    render(<NotificationsPanel {...props} notifications={notifications}/>);
    fireEvent.click(screen.getByRole('button', {name: 'Needs attention', exact: true}));
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    fireEvent.change(screen.getByRole('combobox', {name: 'Notification source'}), {target: {value: 'builds'}});
    expect(screen.getByText('No matching notifications')).toBeVisible();
    fireEvent.click(screen.getByRole('button', {name: 'Clear filters'}));
    fireEvent.click(screen.getByRole('button', {name: 'Unread', exact: true}));
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    fireEvent.change(screen.getByPlaceholderText('Filter notifications...'), {target: {value: 'abc123'}});
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
});

test('supports individual read state, expanded details, navigation actions, and undo', async () => {
    window.electron.notifications.markAsRead = jest.fn(async () => ({}));
    window.electron.notifications.remove.mockResolvedValue({undoToken: 'token'});
    window.electron.notifications.undo = jest.fn(async () => ({success: true}));
    const onAction = jest.fn(async () => {});
    const notification = {...notices(1)[0], details: 'Full commit details', occurrences: 3, source: 'gitops',
        actions: [{kind: 'view-plugin', pluginId: 'plugin'}]};
    render(<NotificationsPanel {...props} notifications={[notification]} onAction={onAction}/>);
    expect(screen.queryByText('Full commit details')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name: 'Show details'}));
    expect(screen.getByText('Full commit details')).toBeVisible();
    expect(screen.getByText('3 occurrences')).toBeVisible();
    fireEvent.click(screen.getByRole('button', {name: /^Mark read:/}));
    await waitFor(() => expect(window.electron.notifications.markAsRead).toHaveBeenCalledWith('0'));
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', {name: 'View plugin'}));
    await waitFor(() => expect(onAction).toHaveBeenCalledWith(notification.actions[0], notification));
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', {name: 'Dismiss Notice 0'}));
    fireEvent.click(await screen.findByRole('button', {name: 'Undo'}));
    await waitFor(() => expect(window.electron.notifications.undo).toHaveBeenCalledWith('token'));
});

test('saves toast preferences and reports action errors', async () => {
    window.electron.notifications.getPreferences = jest.fn(async () => ({successToasts: true, failureToasts: true, infoToasts: false, retentionDays: 0, mutedSources: []}));
    window.electron.notifications.savePreferences = jest.fn(async value => value);
    window.electron.notifications.remove.mockRejectedValue(new Error('Disk unavailable'));
    render(<NotificationsPanel {...props} notifications={notices(1)}/>);
    fireEvent.click(screen.getByRole('button', {name: 'Notification preferences'}));
    fireEvent.click(await screen.findByRole('checkbox', {name: 'Show success toasts'}));
    fireEvent.click(screen.getByRole('button', {name: 'Save notification preferences'}));
    await waitFor(() => expect(window.electron.notifications.savePreferences).toHaveBeenCalledWith(expect.objectContaining({successToasts: false})));
    expect(await screen.findByText('Notification preferences saved.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', {name: 'Notification preferences'}));
    fireEvent.click(screen.getByRole('button', {name: 'Dismiss Notice 0'}));
    expect(await screen.findByText('Disk unavailable')).toBeVisible();
});

test('preferences show navigation instead of bulk notification controls', async () => {
    window.electron.notifications.getPreferences = jest.fn(async () => ({successToasts: true, failureToasts: true, infoToasts: false, retentionDays: 0, mutedSources: []}));
    render(<NotificationsPanel {...props} notifications={notices(1)}/>);
    fireEvent.click(screen.getByRole('button', {name: 'Notification preferences'}));
    expect(screen.queryByRole('button', {name: 'Mark all as read'})).not.toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Dismiss all'})).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name: 'Back to notifications'}));
    expect(screen.getByRole('button', {name: 'Dismiss all'})).toBeVisible();
});

test('navigates to an offscreen notification, focuses it and clears the highlight after a short interval', () => {
    jest.useFakeTimers();
    HTMLElement.prototype.scrollIntoView = jest.fn();
    const notifications = notices();
    const {rerender, unmount} = render(<NotificationsPanel {...props} notifications={notifications}
        focusRequest={{notificationId: '900', requestId: 1}}/>);
    const target = document.querySelector('[data-notification-id="900"]');
    scroller();
    expect(target).toHaveAttribute('data-notification-highlighted', 'true');
    expect(target).toHaveFocus();
    act(() => jest.advanceTimersByTime(3600));
    expect(target).not.toHaveAttribute('data-notification-highlighted');
    rerender(<NotificationsPanel {...props} notifications={notifications} focusRequest={{notificationId: '900', requestId: 2}}/>);
    expect(document.querySelector('[data-notification-id="900"]')).toHaveAttribute('data-notification-highlighted', 'true');
    unmount(); jest.useRealTimers();
});
