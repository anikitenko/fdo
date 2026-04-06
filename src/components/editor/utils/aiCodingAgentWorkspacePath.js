function normalizeText(value = "") {
    return String(value || "").trim();
}

const DISALLOWED_HOST_PREFIXES = [
    "/users/",
    "/var/",
    "/tmp/",
    "/private/",
    "/applications/",
    "/library/",
    "/system/",
    "/volumes/",
    "/opt/",
    "/etc/",
    "/usr/",
    "/bin/",
    "/sbin/",
    "/dev/",
    "/home/",
    "/mnt/",
    "/proc/",
    "/root/",
    "/run/",
    "/srv/",
    "/sys/",
    "/windows/",
    "/program files/",
];

export function isSafeVirtualWorkspacePath(filePath = "") {
    const normalizedPath = normalizeText(filePath);
    if (!normalizedPath.startsWith("/")) {
        return false;
    }

    const lowered = normalizedPath.toLowerCase();
    if (DISALLOWED_HOST_PREFIXES.some((prefix) => lowered.startsWith(prefix))) {
        return false;
    }

    if (/^\/[a-z]:\//i.test(normalizedPath)) {
        return false;
    }

    if (normalizedPath.includes("\\") || normalizedPath.includes("..")) {
        return false;
    }

    return true;
}

export function sanitizeVirtualWorkspacePath(filePath = "") {
    const normalizedPath = normalizeText(filePath);
    if (!isSafeVirtualWorkspacePath(normalizedPath)) {
        return null;
    }
    return normalizedPath;
}
