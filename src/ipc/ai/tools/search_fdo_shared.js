import { getFdoIndexDocuments } from "./fdo_index.js";
import { buildQuerySemanticEmbedding, cosineSimilarity } from "./fdo_semantic.js";

const MAX_RESULTS = 6;
const MAX_RETRIEVAL_CHARS = 3200;
const MAX_SNIPPET_CHARS = 520;
const STOP_TERMS = new Set([
    "a", "an", "and", "are", "as", "at", "be", "by", "do", "does", "for", "from", "how",
    "i", "in", "is", "it", "of", "on", "or", "so", "that", "the", "to", "what", "when",
    "where", "which", "who", "why", "with", "work", "works", "about", "there", "dom",
]);
const HELP_SCOPE_PATTERNS = {
    ui: ["dialog", "panel", "window", "button", "screen", "layout", "renderer", "src/components/"],
    settings: ["settings", "config", "preferences", "assistant", "src/components/settings", "src/ipc/settings"],
    plugins: ["plugin", "manageplugins", "createplugin", "pluginmanager", "navigationplugins"],
    trust: ["trust", "certificate", "cert", "signature"],
    sdk: ["sdk", "api", "types", "integration"],
    docs_help: ["docs/"],
};
const CODE_SCOPE_PATTERNS = {
    ui: ["src/components/", "dialog", "panel", "window", "renderer"],
    settings: ["src/components/settings", "src/ipc/settings", "settings", "preferences"],
    plugins: ["src/ipc/plugin", "pluginmanager", "manageplugins", "createplugin", "navigationplugins", "plugin"],
    trust: ["trust", "certificate", "cert", "signature"],
    sdk: ["sdk", "api", "types", "integration"],
    code_dev: ["src/"],
};

function unique(values = []) {
    return Array.from(new Set(values.filter(Boolean)));
}

function tokenizeForSimilarity(value = "") {
    return String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9_\-\s]/g, " ")
        .split(/\s+/)
        .map((part) => part.trim())
        .filter((part) => part.length >= 2 && !STOP_TERMS.has(part));
}

function classifySource(source = "") {
    const lower = String(source || "").toLowerCase();

    if (lower.startsWith("docs/")) {
        return { sourceType: "docs", authority: 1.0 };
    }
    if (lower.includes("schema") || lower.endsWith(".json") || lower.endsWith(".yaml") || lower.endsWith(".yml")) {
        return { sourceType: "schema", authority: 0.95 };
    }
    if (lower.includes("config") || lower.includes("settings")) {
        return { sourceType: "config", authority: 0.9 };
    }
    if (lower.startsWith("src/")) {
        return { sourceType: "code", authority: 0.82 };
    }
    return { sourceType: "other", authority: 0.7 };
}

function computeRetrievalConfidence(results = []) {
    if (!results.length) {
        return { confidence: 0, hasConflict: false };
    }

    const top = results[0];
    const second = results[1] || null;
    const topScore = Number(top?.score || 0);
    const secondScore = Number(second?.score || 0);
    const matchedTerms = Array.isArray(top?.matchedTerms) ? top.matchedTerms.length : 0;
    const lexicalScore = Number(top?.lexicalScore || topScore || 0);
    const secondSignalScore = Number(top?.secondSignalScore || 0);
    const authorityBoost = (
        top?.sourceType === "docs" ? 0.04 :
            top?.sourceType === "schema" ? 0.035 :
                top?.sourceType === "config" ? 0.025 :
                    top?.sourceType === "code" ? 0.015 : 0
    );
    const normalizedTop = Math.max(0, Math.min(1, (topScore - 24) / 110));
    const normalizedLexical = Math.max(0, Math.min(1, lexicalScore / 95));
    const normalizedSecondSignal = Math.max(0, Math.min(1, secondSignalScore / 28));
    const separation = second
        ? Math.max(0, Math.min(1, (topScore - secondScore) / Math.max(topScore, 1)))
        : 0.7;
    const matchCoverage = Math.max(0, Math.min(1, matchedTerms / 6));

    let confidence = 0.22
        + normalizedTop * 0.34
        + normalizedLexical * 0.16
        + normalizedSecondSignal * 0.1
        + separation * 0.1
        + matchCoverage * 0.06
        + authorityBoost;

    if (matchedTerms === 0) confidence -= 0.12;
    if (second && Math.abs(topScore - secondScore) <= 4) confidence -= 0.08;
    if (second && top.sourceType !== second.sourceType) confidence -= 0.06;

    confidence = Math.max(0.1, Math.min(0.98, confidence));
    const hasConflict = !!second && Math.abs(topScore - secondScore) <= 4 && top.sourceType !== second.sourceType;
    return { confidence, hasConflict };
}

function scoreSourceIntent(query = "", sourceLower = "") {
    const q = String(query || "").toLowerCase();
    let score = 0;

    if (q.includes("plugin")) {
        if (sourceLower.includes("plugin")) score += 30;
        if (sourceLower.includes("manageplugins")) score += 20;
        if (sourceLower.includes("createplugin")) score += 20;
        if (sourceLower.includes("plugindialog")) score += 10;
        if (sourceLower.includes("ai_coding_agent") || sourceLower.includes("aicodingagent")) score -= 25;
    }

    if (q.includes("assistant")) {
        if (sourceLower.includes("assistant")) score += 20;
        if (sourceLower.includes("ai_chat")) score += 15;
        if (sourceLower.includes("plugin")) score -= 5;
    }

    if (q.includes("certificate") || q.includes("trust")) {
        if (sourceLower.includes("certificate") || sourceLower.includes("trust")) score += 25;
    }

    return score;
}

function scoreScopeIntent(scope = "general", sourceLower = "", mode = "help") {
    if (!scope || scope === "general") return 0;
    const patterns = mode === "code" ? CODE_SCOPE_PATTERNS : HELP_SCOPE_PATTERNS;
    const targetPatterns = patterns[scope] || [];
    if (!targetPatterns.length) return 0;

    if (targetPatterns.some((pattern) => sourceLower.includes(pattern))) {
        return mode === "code" ? 28 : 24;
    }

    if (mode === "help" && scope !== "docs_help" && sourceLower.startsWith("docs/")) {
        return 4;
    }

    return -8;
}

function normalizeQuery(query = "") {
    return String(query)
        .toLowerCase()
        .replace(/[^a-z0-9_\-\s]/g, " ")
        .split(/\s+/)
        .map((part) => part.trim())
        .filter((part) => part.length >= 2 && !STOP_TERMS.has(part));
}

function rewriteQuery(query = "", scope = "general", mode = "help") {
    const original = String(query || "").trim();
    if (!original) {
        return { rewrittenQuery: "", rewriteTerms: [] };
    }

    const additions = [];
    const baseTerms = normalizeQuery(original);
    const hasFdo = baseTerms.includes("fdo") || baseTerms.includes("flexdevops");

    if (mode === "help") {
        if (!hasFdo) additions.push("fdo");
        if (scope === "settings") additions.push("preferences", "assistants");
        if (scope === "ui") additions.push("dialog", "panel");
        if (scope === "plugins") additions.push("plugin management", "plugin system");
        if (scope === "trust") additions.push("certificates", "security");
        if (scope === "sdk") additions.push("integration", "api");
    } else {
        if (!hasFdo) additions.push("fdo");
        if (scope === "settings") additions.push("ipc settings", "settings dialog");
        if (scope === "ui") additions.push("components", "renderer");
        if (scope === "plugins") additions.push("plugin manager", "plugin loading");
        if (scope === "trust") additions.push("certificate", "validation");
        if (scope === "sdk") additions.push("types", "integration");
        if (scope === "code_dev") additions.push("source code");
    }

    const rewriteTerms = additions.filter((term) => {
        const termWords = normalizeQuery(term);
        return termWords.some((word) => !baseTerms.includes(word));
    }).slice(0, 2);
    const rewrittenQuery = [original, ...rewriteTerms].join(" ").trim();
    return { rewrittenQuery, rewriteTerms };
}

function overlapRatio(a = [], b = []) {
    const left = new Set(a);
    const right = new Set(b);
    if (!left.size || !right.size) return 0;
    let overlap = 0;
    for (const value of left) {
        if (right.has(value)) overlap += 1;
    }
    return overlap / Math.max(left.size, right.size);
}

function snippetFingerprint(value = "") {
    return String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 240);
}

function computeSecondSignal(doc = {}, { rewrittenQuery = "", query = "", scope = "general", mode = "help" } = {}) {
    const queryTokens = tokenizeForSimilarity(rewrittenQuery || query);
    const titleTokens = tokenizeForSimilarity(doc.title || "");
    const sourceTokens = tokenizeForSimilarity(doc.source || "");
    const snippetTokens = tokenizeForSimilarity(doc.snippet || "");
    const importsTokens = tokenizeForSimilarity((doc.metadata?.imports || []).join(" "));
    const symbolsTokens = tokenizeForSimilarity((doc.metadata?.symbols || []).join(" "));
    const handlersTokens = tokenizeForSimilarity((doc.metadata?.handlers || []).join(" "));
    const componentsTokens = tokenizeForSimilarity((doc.metadata?.components || []).join(" "));

    const reasons = [];
    let score = 0;

    const titleOverlap = overlapRatio(queryTokens, titleTokens);
    const sourceOverlap = overlapRatio(queryTokens, sourceTokens);
    const snippetOverlap = overlapRatio(queryTokens, snippetTokens);
    const importsOverlap = overlapRatio(queryTokens, importsTokens);
    const symbolsOverlap = overlapRatio(queryTokens, symbolsTokens);
    const handlersOverlap = overlapRatio(queryTokens, handlersTokens);
    const componentsOverlap = overlapRatio(queryTokens, componentsTokens);

    if (titleOverlap > 0) {
        score += titleOverlap * 18;
        reasons.push(`title:${titleOverlap.toFixed(2)}`);
    }
    if (sourceOverlap > 0) {
        score += sourceOverlap * 14;
        reasons.push(`source:${sourceOverlap.toFixed(2)}`);
    }
    if (snippetOverlap > 0) {
        score += snippetOverlap * (mode === "help" ? 20 : 10);
        reasons.push(`snippet:${snippetOverlap.toFixed(2)}`);
    }
    if (mode === "code" && importsOverlap > 0) {
        score += importsOverlap * 10;
        reasons.push(`imports:${importsOverlap.toFixed(2)}`);
    }
    if (mode === "code" && symbolsOverlap > 0) {
        score += symbolsOverlap * 14;
        reasons.push(`symbols:${symbolsOverlap.toFixed(2)}`);
    }
    if (mode === "code" && handlersOverlap > 0) {
        score += handlersOverlap * 12;
        reasons.push(`handlers:${handlersOverlap.toFixed(2)}`);
    }
    if (mode === "code" && componentsOverlap > 0) {
        score += componentsOverlap * 12;
        reasons.push(`components:${componentsOverlap.toFixed(2)}`);
    }

    if (mode === "help" && doc.sourceType === "docs") {
        score += 4;
        reasons.push("docs-priority");
    }
    if (mode === "help" && scope === "settings" && String(doc.source || "").toLowerCase().includes("settings")) {
        score += 4;
        reasons.push("settings-priority");
    }

    return {
        score: Number(score.toFixed(2)),
        reasons: unique(reasons).slice(0, 8),
    };
}

function computeEmbeddingSignal(doc = {}, { query = "", rewrittenQuery = "", scope = "general", mode = "help" } = {}) {
    const queryVector = buildQuerySemanticEmbedding(rewrittenQuery || query, { scope, mode });
    const docVector = Array.isArray(doc?.semanticEmbedding) ? doc.semanticEmbedding : [];
    const similarity = cosineSimilarity(queryVector, docVector);
    const score = Number((similarity * (mode === "code" ? 22 : 18)).toFixed(2));
    return {
        similarity,
        score,
    };
}

function escapeRegExp(value = "") {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function scoreCodeMetadata(metadata = null, terms = [], query = "", scope = "general") {
    if (!metadata || typeof metadata !== "object") {
        return { score: 0, reasons: [] };
    }

    const reasons = [];
    let score = 0;
    const joinedImports = (metadata.imports || []).join(" ").toLowerCase();
    const joinedSymbols = (metadata.symbols || []).join(" ").toLowerCase();
    const joinedComponents = (metadata.components || []).join(" ").toLowerCase();
    const joinedHandlers = (metadata.handlers || []).join(" ").toLowerCase();

    for (const term of terms) {
        if (joinedSymbols.includes(term)) {
            score += 12;
            reasons.push(`symbol:${term}`);
        }
        if (joinedImports.includes(term)) {
            score += 8;
            reasons.push(`import:${term}`);
        }
        if (joinedComponents.includes(term)) {
            score += 10;
            reasons.push(`component:${term}`);
        }
        if (joinedHandlers.includes(term)) {
            score += 10;
            reasons.push(`handler:${term}`);
        }
    }

    if (scope === "ui" && metadata.codeKind === "component") {
        score += 10;
        reasons.push("ui-component");
    }
    if (scope === "plugins" && (metadata.codeKind === "ipc" || joinedSymbols.includes("plugin"))) {
        score += 10;
        reasons.push("plugin-flow");
    }
    if (scope === "settings" && (joinedHandlers.includes("settings") || joinedSymbols.includes("settings"))) {
        score += 10;
        reasons.push("settings-flow");
    }

    return { score, reasons: unique(reasons).slice(0, 6) };
}

function scoreContent(content, source, terms, query, scope = "general", mode = "help", metadata = null) {
    const lower = content.toLowerCase();
    const sourceLower = source.toLowerCase();
    const queryLower = String(query || "").toLowerCase().trim();
    const { authority } = classifySource(source);
    let score = 0;
    const matchedTerms = [];

    if (queryLower && lower.includes(queryLower)) score += 20;
    if (queryLower && sourceLower.includes(queryLower)) score += 25;

    for (const term of terms) {
        if (!lower.includes(term)) continue;
        matchedTerms.push(term);
        const occurrences = lower.split(term).length - 1;
        score += occurrences * 5;
    }

    for (const term of terms) {
        if (!sourceLower.includes(term)) continue;
        score += 10;
    }

    if (matchedTerms.length === terms.length && terms.length > 1) score += 15;

    score += scoreSourceIntent(query, sourceLower);
    score += scoreScopeIntent(scope, sourceLower, mode);
    score += Math.round(authority * 12);

    if (mode === "help") {
        const codeSignals = (lower.match(/\b(import|export|const|let|function|return|await|async)\b/g) || []).length;
        const jsxSignals = (lower.match(/<[a-z][^>]*>|=>|[{;}]/g) || []).length;
        if (sourceLower.startsWith("src/ipc/")) score -= 10;
        if (sourceLower.startsWith("src/utils/")) score -= 8;
        if (sourceLower.startsWith("src/components/")) score += 4;
        if (codeSignals > 8) score -= 12;
        if (jsxSignals > 16) score -= 10;
    }
    if (mode === "code") {
        const codeAware = scoreCodeMetadata(metadata, terms, query, scope);
        score += codeAware.score;
    }

    return { score, matchedTerms };
}

function buildHelpSnippet(content, matchedTerms, query) {
    const queryLower = String(query || "").toLowerCase().trim();
    const blocks = String(content || "")
        .split(/\n\s*\n/)
        .map((block) => block.replace(/\s+/g, " ").trim())
        .filter(Boolean);

    let best = "";
    let bestScore = -1;

    for (const block of blocks) {
        const lower = block.toLowerCase();
        let score = 0;
        if (queryLower && lower.includes(queryLower)) score += 8;
        for (const term of matchedTerms) {
            if (lower.includes(term)) score += 3;
        }
        if (/[.?!:]/.test(block)) score += 3;
        if (!/\b(import|export|const|let|function|return|await|async)\b/i.test(block)) score += 4;
        if (!/[{}()[\];]/.test(block)) score += 3;
        if (block.length >= 80 && block.length <= 360) score += 3;
        if (score > bestScore) {
            bestScore = score;
            best = block;
        }
    }

    return best || "";
}

function buildSnippet(content, matchedTerms, query, mode = "help") {
    if (mode === "help") {
        const helpSnippet = buildHelpSnippet(content, matchedTerms, query);
        if (helpSnippet) {
            return helpSnippet
                .replace(/\*\*(.*?)\*\*/g, "$1")
                .replace(/^#+\s*/g, "")
                .replace(/[`*_]{1,3}/g, "")
                .trim();
        }
    }

    const lower = content.toLowerCase();
    let startIndex = 0;
    const queryLower = String(query || "").toLowerCase().trim();

    if (queryLower) {
        const exactIdx = lower.indexOf(queryLower);
        if (exactIdx >= 0) startIndex = Math.max(0, exactIdx - 120);
    }

    if (startIndex === 0) {
        for (const term of matchedTerms) {
            const idx = lower.indexOf(term);
            if (idx >= 0) {
                startIndex = Math.max(0, idx - 120);
                break;
            }
        }
    }

    let snippet = content
        .slice(startIndex, startIndex + 320)
        .replace(/\s+/g, " ")
        .replace(/\*\*(.*?)\*\*/g, "$1")
        .replace(/^#+\s*/g, "")
        .replace(/[`*_]{1,3}/g, "")
        .trim();
    if (queryLower && snippet) {
        snippet = snippet.replace(new RegExp(escapeRegExp(queryLower), "ig"), (match) => `${match}`);
    }
    return snippet.length > 0 ? snippet : content.slice(0, 320).replace(/\s+/g, " ").trim();
}

function estimateCharsForResult(result = {}) {
    const source = String(result.displaySource || result.source || "");
    const sourceType = String(result.sourceType || "");
    const why = String(result.why || "");
    const snippet = String(result.snippet || "");
    return `${source}${sourceType}${why}${snippet}`.length + 32;
}

function trimSnippetToBudget(snippet = "", budget = 0) {
    const normalized = String(snippet || "").trim();
    if (!normalized || budget <= 0) return "";
    if (normalized.length <= budget) return normalized;
    if (budget <= 12) return normalized.slice(0, Math.max(0, budget)).trim();
    return `${normalized.slice(0, Math.max(0, budget - 1)).trim()}…`;
}

function applyContextBudget(results = [], maxChars = MAX_RETRIEVAL_CHARS) {
    const kept = [];
    const dropped = [];
    let usedChars = 0;

    for (const result of results) {
        const next = { ...result };
        next.snippet = String(next.snippet || "").slice(0, MAX_SNIPPET_CHARS).trim();
        const estimated = estimateCharsForResult(next);

        if (usedChars + estimated <= maxChars) {
            kept.push(next);
            usedChars += estimated;
            continue;
        }

        const remaining = maxChars - usedChars;
        if (remaining > 140) {
            const fixedOverhead = estimateCharsForResult({ ...next, snippet: "" });
            const snippetBudget = Math.max(0, remaining - fixedOverhead);
            const trimmedSnippet = trimSnippetToBudget(next.snippet, Math.min(MAX_SNIPPET_CHARS, snippetBudget));
            if (trimmedSnippet) {
                next.snippet = trimmedSnippet;
                kept.push(next);
                usedChars += estimateCharsForResult(next);
                dropped.push({
                    source: result.source,
                    sourceType: result.sourceType,
                    score: result.score,
                    reason: "trimmed-to-fit-budget",
                });
                continue;
            }
        }

        dropped.push({
            source: result.source,
            sourceType: result.sourceType,
            score: result.score,
            reason: "dropped-by-budget",
        });
    }

    return {
        results: kept,
        usedChars,
        maxChars,
        dropped,
    };
}

function assembleContextPack(results = []) {
    const selected = [];
    const dropped = [];
    const seenFingerprints = new Set();
    const sourceUseCount = new Map();

    for (const result of results) {
        const fingerprint = snippetFingerprint(result.snippet);
        if (fingerprint && seenFingerprints.has(fingerprint)) {
            dropped.push({
                source: result.source,
                sourceType: result.sourceType,
                score: result.score,
                reason: "deduplicated-near-identical-snippet",
            });
            continue;
        }

        const sameSourceCount = sourceUseCount.get(result.source) || 0;
        if (sameSourceCount >= 2) {
            dropped.push({
                source: result.source,
                sourceType: result.sourceType,
                score: result.score,
                reason: "reduced-source-overconcentration",
            });
            continue;
        }

        selected.push(result);
        if (fingerprint) seenFingerprints.add(fingerprint);
        sourceUseCount.set(result.source, sameSourceCount + 1);
    }

    return {
        results: selected,
        dropped,
    };
}

function isLowValueHelpSource(source = "", content = "") {
    const lowerSource = String(source || "").toLowerCase();
    const lowerContent = String(content || "").toLowerCase();

    if (lowerSource.includes("todo_")) return true;
    if (lowerSource.endsWith("todo_modern_llm_production_grade.md")) return true;
    if (lowerSource.endsWith("todo_seriously_modern_llm.md")) return true;
    if (lowerContent.includes("## phase ") && lowerContent.includes("definition of done")) return true;
    if (lowerContent.includes("suggested implementation order")) return true;

    return false;
}

function toUserFacingSourceLabel(source = "") {
    const lower = String(source || "").toLowerCase();

    if (lower.startsWith("docs/ai_chat") || lower.includes("src/components/ai-chat") || lower.includes("src/ipc/ai/ai_chat")) {
        return "FDO AI Chat / Assistant Chat";
    }
    if (lower.includes("src/components/settings") || lower.includes("src/ipc/settings") || lower.includes("assistant")) {
        return "FDO Settings / AI Assistants";
    }
    if (lower.includes("plugin")) {
        return "FDO Plugins / Management";
    }
    if (lower.includes("trust") || lower.includes("certificate") || lower.includes("cert")) {
        return "FDO Security / Trust Certificates";
    }
    if (lower.startsWith("docs/")) {
        return "FDO Docs / General";
    }
    if (lower.startsWith("src/components/")) {
        return "FDO UI / General";
    }
    return "FDO Help / General";
}

function shouldIncludeSource(mode, source, scope = "general") {
    const lower = String(source || "").toLowerCase();
    if (mode === "help") {
        if (scope === "docs_help") return lower.startsWith("docs/");
        if (scope === "settings") {
            return (
                lower.includes("src/components/settings") ||
                lower.includes("src/ipc/settings") ||
                lower.includes("settingsdialog") ||
                lower.includes("settings") ||
                lower.includes("preferences")
            ) && !lower.includes("ai_coding_agent") && !lower.includes("aicodingagent");
        }
        if (scope === "ui") {
            return lower.startsWith("docs/") || lower.includes("dialog") || lower.includes("panel") || lower.includes("window") || lower.startsWith("src/components/");
        }
        if (scope === "plugins") {
            return (lower.startsWith("docs/") || lower.includes("plugin")) &&
                !lower.includes("aicodingagent") &&
                !lower.includes("ai_coding_agent");
        }
        if (scope === "trust") {
            return lower.startsWith("docs/") || lower.includes("trust") || lower.includes("certificate") || lower.includes("cert");
        }
        if (scope === "sdk") {
            return lower.startsWith("docs/") || lower.includes("sdk") || lower.includes("api") || lower.includes("types") || lower.includes("integration");
        }
        if (lower.startsWith("docs/")) return true;
        if (lower.includes("settings")) return true;
        if (lower.includes("dialog")) return true;
        if (lower.includes("plugin") && !lower.includes("aicodingagent")) return true;
        return false;
    }

    if (mode === "code") {
        if (scope === "settings") return lower.includes("settings");
        if (scope === "ui") return lower.startsWith("src/components/");
        if (scope === "plugins") return lower.includes("plugin");
        if (scope === "trust") return lower.includes("trust") || lower.includes("certificate") || lower.includes("cert");
        if (scope === "sdk") return lower.includes("sdk") || lower.includes("api") || lower.includes("types");
        return lower.startsWith("src/");
    }

    return true;
}

export function looksLikeFdoQuestion(prompt = "") {
    const q = String(prompt).toLowerCase();
    const triggers = [
        "fdo", "flexdevops", "plugin", "plugins", "manifest", "certificate",
        "certificates", "trust", "assistant settings", "settings dialog",
        "ai assistant", "electron", "react ui", "sdk", "sandbox",
    ];
    return triggers.some((term) => q.includes(term));
}

export function findFdoMatches(query, { mode = "help", scope = "general" } = {}) {
    return findFdoMatchesDetailed(query, { mode, scope }).results;
}

export function findFdoMatchesDetailed(query, { mode = "help", scope = "general" } = {}) {
    const startedAt = Date.now();
    const { rewrittenQuery, rewriteTerms } = rewriteQuery(query, scope, mode);
    const terms = normalizeQuery(rewrittenQuery);
    if (terms.length === 0) {
        return {
            results: [],
            diagnostics: {
                query,
                rewrittenQuery,
                rewriteTerms,
                mode,
                scope,
                terms,
                filesScanned: 0,
                candidateCount: 0,
                selectedCount: 0,
                droppedCount: 0,
                retrievalTimeMs: Date.now() - startedAt,
                topCandidates: [],
                droppedCandidates: [],
            },
        };
    }

    const candidates = [];
    const { documents, diagnostics: indexDiagnostics, indexMeta } = getFdoIndexDocuments();
    let filesScanned = 0;

    for (const doc of documents) {
        filesScanned += 1;
        const source = doc.source;
        const content = String(doc.content || "");
        if (!shouldIncludeSource(mode, source, scope)) continue;
        if (mode === "help" && isLowValueHelpSource(source, content)) continue;

        const { score, matchedTerms } = scoreContent(content, source, terms, query, scope, mode, doc.metadata || null);
        if (score === 0) continue;
        const { sourceType, authority } = classifySource(source);
        const codeAware = mode === "code" ? scoreCodeMetadata(doc.metadata || null, terms, query, scope) : { reasons: [] };

        candidates.push({
            source,
            title: doc.title,
            sourceType,
            authority,
            metadata: doc.metadata || null,
            semanticEmbedding: doc.semanticEmbedding || null,
            snippet: buildSnippet(content, matchedTerms, query, mode),
            matchedTerms,
            score,
            why: [
                matchedTerms.length > 0 ? `Matched terms: ${matchedTerms.join(", ")}` : "",
                codeAware.reasons?.length > 0 ? `Code-aware: ${codeAware.reasons.join(", ")}` : "",
            ].filter(Boolean).join(" | "),
        });
    }

    const reranked = candidates.map((candidate) => {
        const secondSignal = computeSecondSignal(candidate, { rewrittenQuery, query, scope, mode });
        const embeddingSignal = computeEmbeddingSignal(candidate, { rewrittenQuery, query, scope, mode });
        return {
            ...candidate,
            lexicalScore: candidate.score,
            secondSignalScore: secondSignal.score,
            secondSignalReasons: secondSignal.reasons,
            embeddingSimilarity: embeddingSignal.similarity,
            embeddingScore: embeddingSignal.score,
            score: Number((candidate.score + secondSignal.score + embeddingSignal.score).toFixed(2)),
            why: [
                candidate.why,
                secondSignal.reasons.length > 0 ? `Second signal: ${secondSignal.reasons.join(", ")}` : "",
                embeddingSignal.similarity > 0 ? `Embedding: ${embeddingSignal.similarity.toFixed(2)}` : "",
            ].filter(Boolean).join(" | "),
        };
    });

    const sorted = reranked.sort((a, b) => b.score - a.score);
    const results = sorted.slice(0, MAX_RESULTS);
    const dropped = sorted.slice(MAX_RESULTS);
    return {
        results,
        diagnostics: {
            query,
            rewrittenQuery,
            rewriteTerms,
            mode,
            scope,
            terms,
            filesScanned,
            candidateCount: sorted.length,
            selectedCount: results.length,
            droppedCount: dropped.length,
            retrievalTimeMs: Date.now() - startedAt,
            indexVersion: indexMeta.version,
            indexBuiltAt: indexMeta.builtAt,
            indexDocumentCount: indexMeta.documentCount,
            indexCacheDir: indexMeta.cacheDir,
            indexCachePath: indexMeta.cachePath,
            indexRefreshMode: indexDiagnostics.incremental ? "incremental" : "rebuild",
            indexChangedFiles: indexDiagnostics.changedFiles,
            indexRemovedFiles: indexDiagnostics.removedFiles,
            topCandidates: results.slice(0, 5).map(({ source, sourceType, score, matchedTerms, why, lexicalScore, secondSignalScore, secondSignalReasons, embeddingSimilarity, embeddingScore }) => ({
                source,
                sourceType,
                score,
                lexicalScore,
                secondSignalScore,
                embeddingSimilarity,
                embeddingScore,
                secondSignalReasons,
                matchedTerms,
                why,
            })),
            droppedCandidates: dropped.slice(0, 5).map(({ source, sourceType, score, matchedTerms, why, lexicalScore, secondSignalScore, secondSignalReasons, embeddingSimilarity, embeddingScore }) => ({
                source,
                sourceType,
                score,
                lexicalScore,
                secondSignalScore,
                embeddingSimilarity,
                embeddingScore,
                secondSignalReasons,
                matchedTerms,
                why,
            })),
        },
    };
}

export function buildFdoSearchResult(name, query, results, mode, scope = "general", diagnostics = null) {
    if (results.length === 0) {
        return {
            name,
            ok: true,
            query,
            text: `No matching FDO ${mode} sources found for "${query}".`,
            results: [],
            data: { results: [], metadata: { retrievalConfidence: 0, hasConflict: false, mode, scope, ...(diagnostics || {}) } },
            sources: [],
        };
    }

    const displayResults = results.map((result) => ({
        ...result,
        displaySource: mode === "help" ? toUserFacingSourceLabel(result.source) : result.source,
    }));
    const assembled = assembleContextPack(displayResults);
    const budgeted = applyContextBudget(assembled.results, MAX_RETRIEVAL_CHARS);
    const finalResults = budgeted.results;

    const lines = [
        `FDO ${mode} results for "${query}":`,
        ...finalResults.map((result, index) => (
            `${index + 1}. [${result.displaySource}] (${result.sourceType}) ${result.why}\n${result.snippet}`
        )),
    ];
    const { confidence, hasConflict } = computeRetrievalConfidence(finalResults);

    return {
        name,
        ok: true,
        query,
        text: lines.join("\n\n"),
        results: finalResults,
        data: {
            results: finalResults,
            metadata: {
                mode,
                scope,
                retrievalConfidence: confidence,
                hasConflict,
                sourcePriority: ["docs", "schema", "config", "code", "other"],
                contextBudgetChars: budgeted.maxChars,
                contextUsedChars: budgeted.usedChars,
                budgetDroppedCount: budgeted.dropped.length,
                budgetDroppedCandidates: budgeted.dropped,
                assemblyDroppedCount: assembled.dropped.length,
                assemblyDroppedCandidates: assembled.dropped,
                ...(diagnostics || {}),
            },
        },
        sources: finalResults.map(({ source, displaySource, why, sourceType, snippet }) => ({
            source: displaySource || source,
            rawSource: source,
            why,
            sourceType,
            snippet,
        })),
    };
}
