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

test('keeps dismiss and bulk actions working', () => {
    render(<NotificationsPanel {...props} notifications={notices(2)}/>);
    fireEvent.click(screen.getByRole('button', {name: 'Dismiss Notice 1'}));
    expect(window.electron.notifications.remove).toHaveBeenCalledWith('1');
    fireEvent.click(screen.getByRole('button', {name: 'Mark all as read'}));
    expect(window.electron.notifications.markAllAsRead).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', {name: 'Remove all'}));
    expect(window.electron.notifications.removeAll).toHaveBeenCalledTimes(1);
});
