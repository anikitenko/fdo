const SEMANTIC_VECTOR_SIZE = 64;
const SEMANTIC_STOP_TERMS = new Set([
    "a", "an", "and", "are", "as", "at", "be", "by", "do", "does", "for", "from", "how",
    "i", "in", "is", "it", "of", "on", "or", "so", "that", "the", "to", "what", "when",
    "where", "which", "who", "why", "with", "about", "there",
]);

function hashToken(value = "") {
    let hash = 2166136261;
    const input = String(value || "");
    for (let i = 0; i < input.length; i += 1) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function normalizeSemanticText(value = "") {
    return String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9_\-\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function tokenizeSemanticText(value = "") {
    return normalizeSemanticText(value)
        .split(" ")
        .map((token) => token.trim())
        .filter((token) => token.length >= 2 && !SEMANTIC_STOP_TERMS.has(token));
}

function expandSemanticTokens(tokens = []) {
    const expanded = [];
    for (const token of tokens) {
        expanded.push(token);
        if (token.length >= 5) {
            for (let i = 0; i <= token.length - 3; i += 1) {
                expanded.push(token.slice(i, i + 3));
            }
        }
    }
    return expanded;
}

export function buildSemanticEmbedding(parts = []) {
    const vector = new Array(SEMANTIC_VECTOR_SIZE).fill(0);
    const weightedParts = Array.isArray(parts) ? parts : [parts];

    weightedParts.forEach((entry, index) => {
        const text = typeof entry === "string" ? entry : entry?.text;
        const weight = typeof entry === "object" && Number.isFinite(entry?.weight)
            ? entry.weight
            : index === 0 ? 1.8 : 1;
        const tokens = expandSemanticTokens(tokenizeSemanticText(text));
        for (const token of tokens) {
            const hash = hashToken(token);
            const bucket = hash % SEMANTIC_VECTOR_SIZE;
            const sign = (hash & 1) === 0 ? 1 : -1;
            vector[bucket] += weight * sign;
        }
    });

    const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + (value * value), 0));
    if (!magnitude) return vector;
    return vector.map((value) => Number((value / magnitude).toFixed(6)));
}

export function cosineSimilarity(left = [], right = []) {
    if (!Array.isArray(left) || !Array.isArray(right) || !left.length || !right.length) return 0;
    const size = Math.min(left.length, right.length);
    let sum = 0;
    for (let i = 0; i < size; i += 1) {
        sum += Number(left[i] || 0) * Number(right[i] || 0);
    }
    return Math.max(0, Math.min(1, Number(sum.toFixed(6))));
}

export function buildQuerySemanticEmbedding(query = "", { scope = "general", mode = "help" } = {}) {
    const hints = [];
    if (scope && scope !== "general") hints.push(scope);
    if (mode) hints.push(mode);
    return buildSemanticEmbedding([
        { text: query, weight: 2 },
        { text: hints.join(" "), weight: 0.8 },
    ]);
}

export { SEMANTIC_VECTOR_SIZE };
