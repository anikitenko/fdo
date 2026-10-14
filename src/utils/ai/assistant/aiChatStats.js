export function computeUsagePercent(used = 0, maxTokens = 0) {
    const safeUsed = Number(used);
    const safeMax = Number(maxTokens);
    if (!Number.isFinite(safeUsed) || !Number.isFinite(safeMax) || safeMax <= 0) {
        return 0;
    }
    return Number(((safeUsed / safeMax) * 100).toFixed(1));
}

export function formatUsagePercentDisplay(percentUsed = 0) {
    const safePercent = Number(percentUsed);
    if (!Number.isFinite(safePercent)) {
        return "0";
    }
    const rounded = Number(safePercent.toFixed(1));
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function estimateTokenCount(text = "") {
    return Math.ceil(String(text).length / 4);
}

export function estimateContextTokensForMessage(message = {}) {
    const parts = [
        message.role || "",
        message.content || "",
        message.replyContext || "",
        message.contentAttachments || "",
    ].filter(Boolean);

    return estimateTokenCount(parts.join("\n"));
}

export function computeModelUsageStats(messagesForModel = [], maxTokens = 0, basePromptTokens = 0) {
    const messageTokens = (messagesForModel || []).reduce((sum, message) => (
        sum + estimateContextTokensForMessage(message)
    ), 0);
    const used = messageTokens + ((messagesForModel || []).length > 0 ? Number(basePromptTokens) || 0 : 0);
    return {
        estimatedUsed: used,
        percentUsed: computeUsagePercent(used, maxTokens),
    };
}

export function applyCompressedUsageCap(estimatedUsed = 0, maxTokens = 0, reserveRatio = 0.2) {
    const safeMax = Number(maxTokens);
    const safeUsed = Number(estimatedUsed);
    const safeReserve = Number.isFinite(reserveRatio) ? reserveRatio : 0.2;
    const maxUsedAfterCompression = Math.floor(safeMax * (1 - safeReserve));
    const adjustedUsed = Math.min(Math.max(safeUsed, 0), maxUsedAfterCompression);
    return {
        estimatedUsed: adjustedUsed,
        percentUsed: computeUsagePercent(adjustedUsed, safeMax),
        maxUsedAfterCompression,
    };
}
