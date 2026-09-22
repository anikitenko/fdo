import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID} from 'node:crypto';
import {estimateCost, rateKey, validCount} from './pricing';

const context = new AsyncLocalStorage();
export const withUsageContext = (handler, surface) => (event, ...args) => context.run({surface,
    sessionId: typeof args[0]?.sessionId === 'string' ? args[0].sessionId : undefined,
    requestId: typeof args[0]?.requestId === 'string' ? args[0].requestId : randomUUID(),
}, () => handler(event, ...args));
export const runWithUsageContext = (value, run) => context.run(value, run);
const USAGE_FIELDS = ['input_tokens', 'output_tokens', 'total_tokens', 'cached_input_tokens', 'cache_write_tokens', 'cache_write_1h_tokens', 'reasoning_tokens'];
export const cleanUsage = usage => Object.fromEntries(USAGE_FIELDS.filter(key => validCount(usage?.[key])).map(key => [key, usage[key]]));

export class UsageLedger {
    constructor({entries = [], rates = {}, save = () => {}, now = () => new Date().toISOString(), limit = 5000} = {}) {
        this.entries = entries.slice(-limit).map(entry => entry.status === 'pending'
            ? {...entry, status: 'interrupted', cost: {status: 'unknown', currency: 'USD', reason: 'Application closed before usage was reported.'}} : entry);
        this.rates = rates;
        this.save = save;
        this.now = now;
        this.limit = limit;
        this.persistenceError = false;
    }
    changed() {
        try { this.save(this.entries, this.rates); this.persistenceError = false; }
        catch { this.persistenceError = true; }
    }
    begin(provider, model, scope = context.getStore() || {}) {
        const id = randomUUID(), startedAt = this.now();
        const record = {id, provider, model, surface: scope.surface || 'other',
            ...(scope.sessionId ? {sessionId: scope.sessionId} : {}), ...(scope.requestId ? {requestId: scope.requestId} : {}),
            startedAt, status: 'pending', usage: {}, cost: {status: 'unknown', currency: 'USD', reason: 'Request in progress.'}};
        this.entries.push(record);
        if (this.entries.length > this.limit) this.entries.splice(0, this.entries.length - this.limit);
        // Pin the rate when the request starts, including catalog rates.
        const override = this.rates[rateKey(provider, model)];
        const initial = estimateCost({provider, model, usage: {}, rate: override, at: startedAt});
        const rate = (initial.pricing || override) ? structuredClone(initial.pricing || override) : undefined;
        this.changed();
        let ended = false;
        return {id, finish: (status, usage, {completeUsage = false, serviceTier} = {}) => {
            if (ended) return record;
            ended = true;
            Object.assign(record, {status, finishedAt: this.now(), usage: cleanUsage(usage),
                cost: estimateCost({provider, model, usage: cleanUsage(usage), rate, at: startedAt,
                    completeUsage: completeUsage && USAGE_FIELDS.every(key => usage?.[key] == null || validCount(usage[key])), serviceTier})});
            this.changed();
            return record;
        }};
    }
    snapshot({surface, sessionId} = {}) {
        const entries = this.entries.filter(entry => (!surface || entry.surface === surface) && (!sessionId || entry.sessionId === sessionId));
        const groups = new Map();
        for (const entry of entries) {
            const key = rateKey(entry.provider, entry.model);
            const group = groups.get(key) || {provider: entry.provider, model: entry.model, requests: 0, pending: 0, unknown: 0, external: 0, priced: 0, knownCost: 0};
            group.requests++;
            if (entry.status === 'pending') group.pending++;
            else if (entry.cost.status === 'external') group.external++;
            else if (!validCount(entry.cost.totalCost)) group.unknown++;
            if (validCount(entry.cost.totalCost)) { group.knownCost += entry.cost.totalCost; group.priced++; }
            groups.set(key, group);
        }
        return {entries: entries.slice(-100).reverse(), groups: [...groups.values()],
            requests: entries.length, retainedLimit: this.limit, persistenceError: this.persistenceError};
    }
}
export let usageLedger = new UsageLedger();
export function configureUsageLedger(options) { usageLedger = new UsageLedger(options); return usageLedger; }
export function currentTurnUsage() {
    const scope = context.getStore();
    if (!scope?.requestId) return {};
    const entries = usageLedger.entries.filter(entry => entry.surface === scope.surface && entry.requestId === scope.requestId && entry.sessionId === scope.sessionId);
    if (!entries.length) return {};
    const sum = field => entries.every(entry => validCount(entry.usage[field])) ? entries.reduce((total, entry) => total + entry.usage[field], 0) : undefined;
    const priced = entries.filter(entry => validCount(entry.cost.totalCost));
    const complete = priced.length === entries.length;
    const knownCost = priced.reduce((total, entry) => total + entry.cost.totalCost, 0);
    return {usageScope: 'turn', usageRequests: entries.length, inputTokens: sum('input_tokens'), outputTokens: sum('output_tokens'), totalTokens: sum('total_tokens'),
        inputCost: complete ? priced.reduce((total, entry) => total + entry.cost.inputCost, 0) : undefined,
        outputCost: complete ? priced.reduce((total, entry) => total + entry.cost.outputCost, 0) : undefined,
        totalCost: complete ? knownCost : undefined, knownCost: priced.length ? knownCost : undefined,
        local: entries.every(entry => entry.cost.status === 'local'), costStatus: complete ? 'estimated' : priced.length ? 'partial' : 'unknown'};
}
