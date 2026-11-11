import {readdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';

// On-demand only: no polling timer, watcher or retained worker reference.
export async function samplePluginFileDescriptors(pid, baseline = null) {
    let count = null;
    if (Number.isSafeInteger(pid) && pid > 0) {
        try {
            if (process.platform === 'linux') {
                count = (await readdir(`/proc/${pid}/fd`)).filter(name => /^\d+$/.test(name)).length;
            } else if (process.platform === 'darwin') {
                const output = await new Promise((resolve, reject) => {
                    execFile('/usr/sbin/lsof', ['-nP', '-a', '-p', String(pid), '-Ff'],
                        {timeout: 1500, maxBuffer: 1024 * 1024, encoding: 'utf8'},
                        (error, stdout) => error ? reject(error) : resolve(stdout));
                });
                count = String(output).split('\n').filter(line => /^f\d+$/.test(line)).length;
            }
        } catch { /* Process exited, inspection unavailable, or permission denied. */ }
    }
    const initial = Number.isSafeInteger(baseline) && baseline >= 0 ? baseline : count;
    const deltaSinceStart = count === null || initial === null ? null : count - initial;
    return {
        count, deltaSinceStart,
        status: count === null ? 'unavailable' : deltaSinceStart >= 128 && count >= initial * 2 ? 'growing' : 'ok',
    };
}

const counter = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const code = value => typeof value === 'string' && /^[A-Z0-9_]{1,40}$/.test(value) ? value : undefined;

export function sanitizePluginResources(value) {
    if (!value || typeof value !== 'object') return undefined;
    return {
        sampledAt: typeof value.sampledAt === 'string' && Number.isFinite(Date.parse(value.sampledAt))
            ? new Date(value.sampledAt).toISOString() : new Date().toISOString(),
        process: {
            pid: counter(value.process?.pid),
            uptimeSeconds: Number.isFinite(value.process?.uptimeSeconds) && value.process.uptimeSeconds >= 0 ? value.process.uptimeSeconds : 0,
            rssBytes: counter(value.process?.rssBytes), heapUsedBytes: counter(value.process?.heapUsedBytes),
        },
        logging: {
            activeFamilies: counter(value.logging?.activeFamilies), stderrFallbacks: counter(value.logging?.stderrFallbacks),
            fileFailures: counter(value.logging?.fileFailures), lastFailureCode: code(value.logging?.lastFailureCode),
        },
        storage: {
            activeStores: counter(value.storage?.activeStores), pendingWrites: counter(value.storage?.pendingWrites),
            writeFailures: counter(value.storage?.writeFailures), lastFailureCode: code(value.storage?.lastFailureCode),
        },
    };
}
