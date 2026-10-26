import {applyNotificationMenuBadge, macOSMajorVersion, notificationMenuBadge, unreadNotificationCount} from '../../src/utils/desktop/notificationMenuBadge';

test('reads the macOS major version', () => {
    expect(macOSMajorVersion('14.6.1')).toBe(14);
    expect(macOSMajorVersion('26.0')).toBe(26);
    expect(macOSMajorVersion('')).toBe(0);
});

test('counts unread notifications', () => {
    expect(unreadNotificationCount([{read: false}, {read: true}, null, {read: false}])).toBe(2);
    expect(unreadNotificationCount(null)).toBe(0);
});

test('uses the macOS alerts badge for an unread count', () => {
    const notifications = [{read: false}, {read: false}, {read: true}];
    expect(notificationMenuBadge(notifications, {platform: 'darwin', macOSMajor: 14})).toEqual({type: 'alerts', count: 2});
    expect(notificationMenuBadge(notifications, {platform: 'darwin', macOSMajor: 13})).toBeUndefined();
    expect(notificationMenuBadge(notifications, {platform: 'win32', macOSMajor: 15})).toBeUndefined();
    expect(notificationMenuBadge([{read: true}], {platform: 'darwin', macOSMajor: 15})).toBeUndefined();
});

test('clears the menu badge when nothing is unread', () => {
    const item = {badge: {type: 'alerts', count: 4}};
    expect(applyNotificationMenuBadge(item, [{read: true}], {platform: 'darwin', macOSMajor: 14})).toBe(true);
    expect(item.badge).toBeUndefined();
    const untouched = {badge: {type: 'alerts', count: 4}};
    expect(applyNotificationMenuBadge(untouched, [{read: false}], {platform: 'linux', macOSMajor: 14})).toBe(false);
    expect(untouched.badge).toEqual({type: 'alerts', count: 4});
});
