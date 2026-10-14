let snapshot = {files: [], previousFiles: [], activePath: '', status: 'idle'};
const listeners = new Set();
export const getPendingFiles = () => snapshot;
export const subscribePendingFiles = listener => { listeners.add(listener); return () => listeners.delete(listener); };
export function updatePendingFiles(patch) {
    snapshot = {...snapshot, ...(patch.files?.length === 0 ? {previousFiles: []} : {}), ...patch};
    listeners.forEach(listener => listener());
}
export function startPendingFiles(preservePrevious = false) {
    updatePendingFiles({files: [], previousFiles: preservePrevious
        ? (snapshot.files.length ? snapshot.files : snapshot.previousFiles) : [], activePath: '', status: 'generating'});
}
export function stagePendingFiles(content, activePath = '') {
    // Retain exact source only from complete host file envelopes. An active
    // path or unfinished heading is not a previewable file.
    const completed = new Map([...String(content || '').matchAll(/^### File:[ \t]*(\/[^\n]+)\r?\n```\w*[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*(?=\r?\n|$)/gm)]
        .map(match => [match[1].trim(), match[2]]));
    const previous = new Map(snapshot.files.map(file => [file.path, file]));
    const paths = [...new Set([...previous.keys(), ...completed.keys(), ...(activePath ? [activePath] : [])])];
    updatePendingFiles({files: paths.map(path => completed.has(path)
        ? {path, ready: true, content: completed.get(path)}
        : previous.get(path) || {path, ready: false}), activePath, status: 'generating'});
}
