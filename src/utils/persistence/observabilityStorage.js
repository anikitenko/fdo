import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {settings} from './store';
import {createStorageWorker} from './storageWorkerClient';
import {encryptDiagnostic, decryptDiagnostic} from './osProtection';
import {storedObservabilityConfig} from './observabilityConfig';

const client = createStorageWorker('Observability', 'observabilityWorker.cjs', () => ({filename: path.join(path.dirname(settings.path), 'observability.sqlite')}));
let ready, initialized = false, closing = false, timer, flushing, latestMetrics, metrics = {}, queue = [], storageError = null;
const splitMetrics = value => {
    const {recentMisses = [], ...retrieval} = value?.retrieval || {};
    return {totals: {...value, retrieval}, misses: recentMisses};
};
function encryptedMiss(value) {return {kind: 'miss', value: {id: randomUUID(), createdAt: Date.parse(value.ts) || Date.now(), payload: encryptDiagnostic(value)}};}
export function initializeObservabilityStorage() {
    if (ready) return ready;
    ready = (async () => {
        const staged = settings.get('observabilityMigration');
        const records = [];
        if (staged?.metrics) {
            const {totals} = splitMetrics(staged.metrics);
            records.push({kind: 'metrics', value: {createdAt: Date.now(), totals}});
        }
        for (const entry of staged?.usageLedger || []) records.push({kind: 'usage', value: entry});
        await client.request('initialize', {records});
        if (staged) {
            if (staged.secretKey) settings.set('observabilityMigration', {secretKey: staged.secretKey});
            else settings.delete('observabilityMigration');
        }
        await client.request('prune', storedObservabilityConfig().retention);
        const saved = await client.request('metrics');
        // Recent miss details can contain user queries. Do not decrypt them during startup;
        // aggregate counters remain available without prompting for Keychain access.
        metrics = {...saved.totals, retrieval: {...saved.totals.retrieval, recentMisses: []}};
        initialized = true;
        timer = setInterval(() => {flushObservability().catch(() => {});}, 1000); timer.unref?.();
        return true;
    })();
    return ready;
}
export function observabilityStorageStatus() {return {initialized, error: storageError, queued: queue.length};}
function enqueue(record) {
    if (closing) return Promise.reject(new Error('Observability storage is closing'));
    if (queue.length >= 5000) return Promise.reject(new Error('Observability write queue is full'));
    return new Promise((resolve, reject) => {queue.push({record, resolve, reject});});
}
export async function flushObservability() {
    await initializeObservabilityStorage();
    if (flushing) {await flushing; if (queue.length || latestMetrics) return flushObservability(); return;}
    const items = queue; queue = [];
    const snapshot = latestMetrics; latestMetrics = null;
    const records = items.map(item => item.record);
    if (snapshot) records.push({kind: 'metrics', value: {totals: snapshot, createdAt: Date.now()}});
    if (!records.length) return;
    flushing = client.request('batch', records).then(() => {storageError = null; items.forEach(item => item.resolve(true));}, error => {
        storageError = error.message;
        // Failed writes remain retryable; the awaiting caller still sees the failure.
        queue = [...items.slice(0, Math.max(0, 5000 - queue.length)).map(item => ({...item, resolve() {}, reject() {}})), ...queue];
        if (!latestMetrics) latestMetrics = snapshot;
        items.forEach(item => item.reject(error));
        throw error;
    }).finally(() => {flushing = undefined;});
    return flushing;
}
export const currentAiMetrics = () => structuredClone(metrics);
export function saveAiMetrics(value) {
    const {totals, misses} = splitMetrics(value);
    const previous = new Set((metrics?.retrieval?.recentMisses || []).map(item => JSON.stringify(item)));
    for (const miss of misses) if (!previous.has(JSON.stringify(miss))) {
        try {enqueue(encryptedMiss(miss)).catch(error => {storageError = error.message;});}
        catch (error) {storageError = error.message;}
    }
    metrics = structuredClone(value);
    latestMetrics = totals;
}
export async function saveUsageEntry(entry) {
    await initializeObservabilityStorage();
    const result = enqueue({kind: 'usage', value: structuredClone(entry)});
    // Accounting commits promptly; high-frequency diagnostics share the same batch.
    flushObservability().catch(() => {});
    return result;
}
export async function loadUsageEntries() {await initializeObservabilityStorage(); return client.request('usage');}
export function recordRuntimeSamples(value) {enqueue({kind: 'runtime', value}).catch(error => {storageError = error.message;});}
export async function recordStartupEvent(entry) {
    await initializeObservabilityStorage();
    const {event, session, elapsed, memory, cpu} = entry;
    return enqueue({kind: 'startup', value: {id: randomUUID(), createdAt: entry.createdAt || Date.now(), sessionId: session,
        event, elapsed: Number.parseInt(elapsed, 10) || 0, summary: {memory, cpu}, details: null}});
}
export async function importStartupEvents(entries) {
    await initializeObservabilityStorage();
    const records = entries.map(({id, entry, createdAt}) => {
        const {event, session, elapsed, memory, cpu} = entry;
        return {kind: 'startup', value: {id, createdAt, sessionId: session || 'imported', event: String(event || 'imported'),
            elapsed: Number.parseInt(elapsed, 10) || 0, summary: {memory, cpu, imported: true}, details: null}};
    });
    return client.request('batch', records);
}
export async function saveTrace(trace, destination) {
    await initializeObservabilityStorage();
    if (Buffer.byteLength(JSON.stringify(trace)) > 1024 * 1024) throw new Error('Trace exceeds the 1 MB recording limit');
    const result = enqueue({kind: 'trace', value: {id: trace.id, createdAt: trace.createdAt, sessionId: trace.sessionId,
        name: trace.name, status: trace.status, destination: destination || null, payload: encryptDiagnostic(trace)}});
    flushObservability().catch(() => {});
    return result;
}
export async function observabilityRequest(operation, value) {
    await flushObservability();
    return client.request(operation, value);
}
export async function getTrace(id) {
    const payload = await observabilityRequest('trace', {id});
    return payload ? decryptDiagnostic(payload) : null;
}
export async function closeObservabilityStorage() {
    if (!ready) return;
    closing = true; clearInterval(timer);
    try {await flushObservability();} finally {await client.close();}
}
