export function macOSMajorVersion(version = '') {
    const major = Number(String(version).split('.')[0]);
    return Number.isInteger(major) ? major : 0;
}

export function unreadNotificationCount(notifications) {
    return (Array.isArray(notifications) ? notifications : []).filter(item => item && item.read !== true).length;
}

// macOS 14+ draws MenuItem.badge. `alerts` is the system count style, so the
// menu shows the unread total without a hand-built "99+" string.
export function notificationMenuBadge(notifications, {platform = '', macOSMajor = 0} = {}) {
    if (platform !== 'darwin' || macOSMajor < 14) return undefined;
    const count = unreadNotificationCount(notifications);
    if (!Number.isSafeInteger(count) || count <= 0) return undefined;
    return {type: 'alerts', count};
}

export function applyNotificationMenuBadge(item, notifications, options = {}) {
    if (!item || options.platform !== 'darwin' || !(Number(options.macOSMajor) >= 14)) return false;
    item.badge = notificationMenuBadge(notifications, options);
    return true;
}
