export function normalizeExportPort(value = 8080) {
    const port = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
        throw new Error('Choose a container port from 1024 to 65535. The image runs as a non-root user.');
    }
    return port;
}
