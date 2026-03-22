import { settings } from "../../utils/store.js";

const MAX_RECENT_MISSES = 50;
const LOW_CONFIDENCE_THRESHOLD = 0.55;

function getDefaultMetrics() {
    return {
        retrieval: {
            totalQueries: 0,
            hits: 0,
            misses: 0,
            lowConfidence: 0,
            conflicts: 0,
            totalCandidateCount: 0,
            totalSelectedCount: 0,
            totalDroppedCount: 0,
            totalRetrievalTimeMs: 0,
            confidenceSum: 0,
            missNoResults: 0,
            missLowConfidence: 0,
            missErrors: 0,
            recentMisses: [],
        },
        tools: {
            totalCalls: 0,
            countsByTool: {},
        },
        answers: {
            totalReplies: 0,
            groundedReplies: 0,
            ungroundedReplies: 0,
            noSourceMatches: 0,
            clarificationReplies: 0,
        },
        tokens: {
            requests: 0,
            streamRequests: 0,
            nonStreamRequests: 0,
            toolFollowUpRequests: 0,
            promptTokens: 0,
            retrievalTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
        },
    };
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function normalizeMetrics(metrics) {
    const defaults = getDefaultMetrics();
    const retrieval = metrics?.retrieval || {};
    const tools = metrics?.tools || {};
    const answers = metrics?.answers || {};
    const tokens = metrics?.tokens || {};

    return {
        retrieval: {
            ...defaults.retrieval,
            ...retrieval,
            recentMisses: Array.isArray(retrieval.recentMisses)
                ? retrieval.recentMisses.slice(-MAX_RECENT_MISSES)
                : [],
        },
        tools: {
            ...defaults.tools,
            ...tools,
            countsByTool: tools?.countsByTool && typeof tools.countsByTool === "object"
                ? { ...tools.countsByTool }
                : {},
        },
        answers: {
            ...defaults.answers,
            ...answers,
        },
        tokens: {
            ...defaults.tokens,
            ...tokens,
        },
    };
}

function updateAiMetrics(mutator) {
    const current = normalizeMetrics(settings.get("ai.metrics"));
    const draft = clone(current);
    mutator(draft);
    const next = normalizeMetrics(draft);
    settings.set("ai.metrics", next);
    return next;
}

function pushRecentMiss(retrieval, miss) {
    retrieval.recentMisses = [...retrieval.recentMisses, miss].slice(-MAX_RECENT_MISSES);
}

export function recordFdoRetrievalMetrics({ tool, query, scope = "general", result = null, error = null }) {
    updateAiMetrics((metrics) => {
        const retrieval = metrics.retrieval;
        retrieval.totalQueries += 1;

        if (error) {
            retrieval.misses += 1;
            retrieval.missErrors += 1;
            pushRecentMiss(retrieval, {
                ts: new Date().toISOString(),
                tool: String(tool || "unknown"),
                query: String(query || ""),
                scope: String(scope || "general"),
                reason: "tool_error",
                confidence: null,
            });
            return;
        }

        const metadata = result?.data?.metadata || {};
        const results = Array.isArray(result?.results) ? result.results : [];
        const confidence = Number.isFinite(metadata.retrievalConfidence)
            ? Number(metadata.retrievalConfidence)
            : 0;
        const candidateCount = Number.isFinite(metadata.candidateCount) ? metadata.candidateCount : 0;
        const selectedCount = Number.isFinite(metadata.selectedCount) ? metadata.selectedCount : results.length;
        const droppedCount = Number.isFinite(metadata.droppedCount) ? metadata.droppedCount : 0;
        const retrievalTimeMs = Number.isFinite(metadata.retrievalTimeMs) ? metadata.retrievalTimeMs : 0;

        retrieval.totalCandidateCount += candidateCount;
        retrieval.totalSelectedCount += selectedCount;
        retrieval.totalDroppedCount += droppedCount;
        retrieval.totalRetrievalTimeMs += retrievalTimeMs;
        retrieval.confidenceSum += confidence;

        if (metadata.hasConflict) {
            retrieval.conflicts += 1;
        }

        if (results.length > 0) {
            retrieval.hits += 1;
        } else {
            retrieval.misses += 1;
            retrieval.missNoResults += 1;
            pushRecentMiss(retrieval, {
                ts: new Date().toISOString(),
                tool: String(tool || "unknown"),
                query: String(query || ""),
                scope: String(scope || "general"),
                reason: "no_results",
                confidence,
            });
        }

        if (confidence > 0 && confidence < LOW_CONFIDENCE_THRESHOLD) {
            retrieval.lowConfidence += 1;
            retrieval.missLowConfidence += 1;
            pushRecentMiss(retrieval, {
                ts: new Date().toISOString(),
                tool: String(tool || "unknown"),
                query: String(query || ""),
                scope: String(scope || "general"),
                reason: "low_confidence",
                confidence,
            });
        }
    });
}

export function recordToolUsage(toolNames = []) {
    const uniqueNames = Array.from(new Set(
        (Array.isArray(toolNames) ? toolNames : [])
            .map((name) => String(name || "").trim())
            .filter(Boolean)
    ));
    if (!uniqueNames.length) return;

    updateAiMetrics((metrics) => {
        metrics.tools.totalCalls += uniqueNames.length;
        for (const name of uniqueNames) {
            metrics.tools.countsByTool[name] = (metrics.tools.countsByTool[name] || 0) + 1;
        }
    });
}

export function recordAnswerMetrics({ grounded = false, noSourceMatches = false, clarification = false } = {}) {
    updateAiMetrics((metrics) => {
        metrics.answers.totalReplies += 1;
        if (grounded) metrics.answers.groundedReplies += 1;
        else metrics.answers.ungroundedReplies += 1;
        if (noSourceMatches) metrics.answers.noSourceMatches += 1;
        if (clarification) metrics.answers.clarificationReplies += 1;
    });
}

export function recordTokenUsage({
    mode = "non-stream",
    inputTokens = null,
    outputTokens = null,
    totalTokens = null,
    retrievalTokens = 0,
} = {}) {
    updateAiMetrics((metrics) => {
        metrics.tokens.requests += 1;
        if (mode === "stream") metrics.tokens.streamRequests += 1;
        else if (mode === "tool-follow-up") metrics.tokens.toolFollowUpRequests += 1;
        else metrics.tokens.nonStreamRequests += 1;

        if (Number.isFinite(inputTokens) && inputTokens > 0) {
            metrics.tokens.promptTokens += inputTokens;
        }
        if (Number.isFinite(retrievalTokens) && retrievalTokens > 0) {
            metrics.tokens.retrievalTokens += retrievalTokens;
        }
        if (Number.isFinite(outputTokens) && outputTokens > 0) {
            metrics.tokens.outputTokens += outputTokens;
        }
        if (Number.isFinite(totalTokens) && totalTokens > 0) {
            metrics.tokens.totalTokens += totalTokens;
        }
    });
}

