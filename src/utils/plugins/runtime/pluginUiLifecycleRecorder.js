import {appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync} from 'node:fs';
import path from 'node:path';

const events = new Set(['frame-created', 'frame-reload', 'frame-recovery', 'render-replaced', 'render-deferred', 'render-posted', 'recovery-blocked']);
const reasons = new Set(['initial_load', 'frame_configuration_changed', 'manual_retry', 'user_opened_update',
    'background_update', 'navigation_action', 'unexpected_document_navigation', 'view_update', 'initial_render',
    'hello_missing', 'layout_not_ready', 'component_mount_missing', 'gitops_update', 'deployment', 'runtime_unloaded']);

export function createPluginUiLifecycleRecorder({root, getPlugin, trace, now = Date.now}) {
    const budgets = new Map();
    return (pluginId, entry) => {
        if (typeof pluginId !== 'string' || pluginId.length > 240 || !/^[\w.-]+$/.test(pluginId)
            || pluginId === '.' || pluginId === '..' || !events.has(entry?.event) || !reasons.has(entry?.reason)
            || !Number.isSafeInteger(entry.attempt) || entry.attempt < 0 || entry.attempt > 10000
            || !getPlugin(pluginId)) return {success: false};
        const timestamp = now();
        // One bounded budget per minute, without retaining arbitrary plugin IDs.
        for (const [id, budget] of budgets) if (timestamp - budget.start >= 60000) budgets.delete(id);
        const budget = budgets.get(pluginId) || {start: timestamp, count: 0};
        if (budget.count >= 120 || (!budgets.has(pluginId) && budgets.size >= 1000)) return {success: false};
        budget.count += 1;
        budgets.set(pluginId, budget);
        const details = {reason: entry.reason, attempt: entry.attempt};
        trace(pluginId, `ui.${entry.event}`, details);
        try {
            const directory = path.join(root(), 'plugin-data', pluginId, 'logs');
            mkdirSync(directory, {recursive: true, mode: 0o700});
            const filename = path.join(directory, 'host-ui.jsonl');
            if (existsSync(filename) && statSync(filename).size >= 256 * 1024) {
                rmSync(`${filename}.1`, {force: true});
                renameSync(filename, `${filename}.1`);
            }
            appendFileSync(filename, JSON.stringify({ts: timestamp, event: `ui.${entry.event}`, ...details}) + '\n', {mode: 0o600});
            return {success: true};
        } catch {
            // The in-memory trace remains available if disk logging fails.
            return {success: false};
        }
    };
}
