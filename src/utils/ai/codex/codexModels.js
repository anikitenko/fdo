import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';

// Query the runtime's picker catalog without starting a thread or inference.
export function listCodexModels(invocation, {timeoutMs = 30_000} = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(invocation.command, [...(invocation.args || []), 'app-server'], {
            env: {...process.env, ...(invocation.env || {})},
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        const lines = createInterface({input: child.stdout});
        const models = new Map();
        const cursors = new Set();
        let settled = false;
        let requestId = 1;
        const finish = (error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            lines.close();
            child.stdin.end();
            child.kill();
            if (error) reject(error);
            else resolve([...models.values()].sort((a, b) => Number(b.isDefault) - Number(a.isDefault))
                .map(({value, isDefault}) => ({value, label: `${value}${isDefault ? ' (Recommended)' : ''}`, provider: 'codex-cli'})));
        };
        const timer = setTimeout(() => finish(new Error('Timed out loading models from Codex. Check authentication and retry.')), timeoutMs);
        const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
        const requestPage = (cursor) => send({id: ++requestId, method: 'model/list', params: {limit: 100, includeHidden: false, ...(cursor ? {cursor} : {})}});
        child.on('error', () => finish(new Error('Unable to start Codex to load its model catalog.')));
        child.on('close', () => finish(new Error('Codex exited before returning its model catalog.')));
        child.stdin.on('error', () => finish(new Error('Connection to the Codex model catalog closed.')));
        // Drain diagnostics without exposing account details in Settings errors.
        child.stderr.on('data', () => {});
        lines.on('line', (line) => {
            if (settled) return;
            let message;
            try { message = JSON.parse(line); } catch { return; }
            if (message.id !== requestId) return;
            if (message.error) return finish(new Error('Codex could not load its model catalog. Check authentication and the selected runtime.'));
            if (requestId === 1) {
                send({method: 'initialized', params: {}});
                requestPage();
                return;
            }
            if (!Array.isArray(message.result?.data)) return finish(new Error('Codex returned an invalid model catalog.'));
            for (const model of message.result.data) {
                if (model.hidden || typeof model.model !== 'string' || !model.model.trim()) continue;
                models.set(model.model, {value: model.model, isDefault: !!model.isDefault});
            }
            const cursor = message.result.nextCursor;
            if (cursor) {
                if (cursors.has(cursor)) return finish(new Error('Codex returned a repeated model catalog cursor.'));
                cursors.add(cursor);
                requestPage(cursor);
            } else finish(models.size ? null : new Error('Codex returned no selectable models. Sign in and reload the model list.'));
        });
        send({id: requestId, method: 'initialize', params: {clientInfo: {name: 'fdo', title: 'FDO', version: '1.0.0'}}});
    });
}
