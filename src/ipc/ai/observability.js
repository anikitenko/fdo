import crypto from 'node:crypto';
import {storedObservabilityConfig, langfuseConfig, exportDestination} from '../../utils/persistence/observabilityConfig';
import {saveTrace} from '../../utils/persistence/observabilityStorage';
import {createIncidentReporter} from '../../utils/desktop/backgroundNotifications';

const traceIncident = createIncidentReporter({source: 'observability', groupKey: 'trace-recording', title: 'AI trace could not be saved',
    message: 'This trace is missing from local history and cannot be exported. Unlock the OS credential store or check disk space, then review Observability settings.',
    recoveredTitle: 'AI trace recording resumed', recoveredMessage: 'New encrypted traces can be saved again. Traces missed during the failure were not recovered.',
    actions: [{kind: 'view-settings', tab: 'observability'}]});

const PROMPT_VERSION = 'fdo-ai-chat-v1';
const noopSpan = () => ({annotate() {}, finish() {}, fail() {}});
function prune(value, depth = 0) {
    if (depth > 5) return '[truncated]';
    if (value == null) return null;
    if (typeof value === 'string') return value.slice(0, 8000);
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (Array.isArray(value)) return value.slice(0, 20).map(item => prune(item, depth + 1));
    if (typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 50)
        .filter(([key]) => !/^(authorization|api.?key|secret.*|password|accessToken|refreshToken)$/i.test(key))
        .map(([key, item]) => [key, prune(item, depth + 1)]));
    return String(value).slice(0, 2000);
}
function metadataFor(value, captureContent) {
    if (captureContent) return prune(value);
    return Object.fromEntries(Object.entries(prune(value) || {}).filter(([key, item]) =>
        typeof item === 'number' || typeof item === 'boolean' ||
        (typeof item === 'string' && /^(provider|model|route|mode|surface|tool|promptVersion|language|scope|status)$/i.test(key))));
}
const attribute = (key, value) => ({key, value: {stringValue: typeof value === 'string' ? value : JSON.stringify(value)}});
const nanos = value => (BigInt(value) * 1000000n).toString();

export function createAiObservabilityTrace({name = 'ai-chat-turn', sessionId = null, userId = null, input = null, metadata = {}} = {}) {
    const preferences = storedObservabilityConfig();
    const config = langfuseConfig({decrypt: false});
    if (!preferences.localTracing && !config.enabled) return {enabled: false, id: null, startSpan: noopSpan, update() {}, async finish() {}, async fail() {}};
    const capture = preferences.captureContent;
    const id = crypto.randomBytes(16).toString('hex'), rootId = crypto.randomBytes(8).toString('hex');
    const createdAt = Date.now(), spans = [];
    const traceMetadata = metadataFor({...metadata, promptVersion: PROMPT_VERSION}, capture);
    let finished = false;
    function startSpan(spanName, {input: spanInput = null, metadata: spanMetadata = {}} = {}) {
        if (spans.length >= 100) return noopSpan();
        const span = {id: crypto.randomBytes(8).toString('hex'), name: String(spanName).slice(0, 200), start: Date.now(),
            metadata: metadataFor(spanMetadata, capture), input: capture ? prune(spanInput) : null};
        spans.push(span);
        return {
            annotate(extra = {}) {Object.assign(span.metadata, metadataFor(extra, capture));},
            finish({output = null, metadata: extra = {}, statusMessage = null} = {}) {
                span.end = Date.now(); span.output = capture ? prune(output) : null;
                span.statusMessage = capture ? String(statusMessage || '').slice(0, 2000) : null;
                Object.assign(span.metadata, metadataFor(extra, capture));
            },
            fail(error, extra = {}) {span.end = Date.now(); span.failed = true; span.statusMessage = capture ? String(error?.message || error).slice(0, 2000) : 'Operation failed'; Object.assign(span.metadata, metadataFor(extra, capture));},
        };
    }
    async function complete({output = null, metadata: extra = {}, statusMessage = null} = {}, failed = false) {
        if (finished) return;
        finished = true;
        Object.assign(traceMetadata, metadataFor(extra, capture));
        const end = Date.now();
        const root = {id: rootId, name: String(name).slice(0, 200), start: createdAt, end, failed, metadata: traceMetadata,
            input: capture ? prune(input) : null, output: capture ? prune(output) : null,
            statusMessage: failed ? (capture ? String(statusMessage || 'Operation failed').slice(0, 2000) : 'Operation failed') : null};
        const sharedAttributes = [attribute('langfuse.trace.name', root.name), attribute('langfuse.environment', config.environment || 'production')];
        if (sessionId) sharedAttributes.push(attribute('session.id', sessionId), attribute('langfuse.session.id', sessionId));
        if (userId) sharedAttributes.push(attribute('user.id', userId));
        if (config.release) sharedAttributes.push(attribute('langfuse.release', config.release));
        const otelSpans = [root, ...spans].map(span => ({traceId: id, spanId: span.id, ...(span.id === rootId ? {} : {parentSpanId: rootId}),
            name: span.name, kind: 1, startTimeUnixNano: nanos(span.start), endTimeUnixNano: nanos(span.end || end),
            status: {code: span.failed ? 2 : 1, ...(span.statusMessage ? {message: span.statusMessage} : {})},
            attributes: [...sharedAttributes, attribute('langfuse.observation.type', 'span'),
                ...Object.entries(span.metadata).map(([key, value]) => attribute(`langfuse.observation.metadata.${key}`, value)),
                ...(span.input == null ? [] : [attribute('langfuse.observation.input', span.input)]),
                ...(span.output == null ? [] : [attribute('langfuse.observation.output', span.output)])],
        }));
        const trace = {id, name: root.name, sessionId, createdAt, finishedAt: end, status: failed ? 'failed' : 'completed', captureContent: capture,
            otel: {resourceSpans: [{resource: {attributes: [attribute('service.name', 'fdo')]}, scopeSpans: [{scope: {name: 'fdo-ai-chat', version: '1'}, spans: otelSpans}]}]}};
        try {await saveTrace(trace, config.enabled ? exportDestination(config) : null); traceIncident.recover();}
        catch (error) {traceIncident.fail(error);}
    }
    return {enabled: true, id, startSpan, update(extra = {}) {Object.assign(traceMetadata, metadataFor(extra, capture));},
        finish: complete, fail: (error, extra = {}) => complete({metadata: extra, statusMessage: String(error?.message || error)}, true)};
}
export function getObservabilityPromptVersion() {return PROMPT_VERSION;}
