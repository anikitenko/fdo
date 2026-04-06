export function formatAiCodingElapsedShort(elapsedMs = 0) {
    const seconds = Math.max(0, Math.round(Number(elapsedMs || 0) / 1000));
    return `${seconds}s`;
}

export function buildAiCodingLaunchStatus({ assistantName = "" } = {}) {
    const label = String(assistantName || "").trim();
    return label ? `Starting ${label}.` : "Starting the coding assistant.";
}

export function buildAiCodingWaitingStatus({
    elapsedMs = 0,
    retrying = false,
} = {}) {
    const elapsed = formatAiCodingElapsedShort(elapsedMs);

    if (elapsedMs < 10000) {
        return retrying
            ? "Switched response mode. Waiting for the first visible answer."
            : "Analyzing the request and plugin workspace.";
    }

    if (elapsedMs < 30000) {
        return retrying
            ? `Still waiting for the first visible answer after switching response mode (${elapsed}).`
            : `Still analyzing the request and plugin workspace (${elapsed} elapsed).`;
    }

    return retrying
        ? `Still working on the first visible answer (${elapsed} elapsed).`
        : `Still working on the first answer (${elapsed} elapsed). Larger prompts can take up to about a minute.`;
}

export function buildAiCodingFirstResponseStatus(elapsedMs = 0) {
    return `First visible response received after ${formatAiCodingElapsedShort(elapsedMs)}. Drafting the rest of the answer.`;
}

export function buildAiCodingDoneStatus(elapsedMs = 0) {
    return `Completed in ${formatAiCodingElapsedShort(elapsedMs)}.`;
}

export function buildAiCodingTransportStatus(kind = "") {
    switch (String(kind || "").trim()) {
        case "json-cooldown":
            return "Using the faster response channel based on recent runs.";
        case "early-retry-without-json":
            return "Visible output is taking longer than expected. Switching to a faster response channel.";
        case "retry-launch":
            return "Retrying with a faster response channel.";
        case "raw-stdout-fallback":
            return "Continuing with a fallback response channel.";
        case "retry-without-json":
            return "Retrying once with a faster response channel.";
        default:
            return "";
    }
}

export function upsertAiCodingRequestStatus(entries = [], message = "", metadata = {}) {
    const normalizedMessage = String(message || "").trim();
    if (!normalizedMessage) {
        return Array.isArray(entries) ? entries : [];
    }

    const existing = Array.isArray(entries) ? entries : [];
    const normalizedMetadata = metadata && typeof metadata === "object" ? metadata : {};
    const phase = String(normalizedMetadata.phase || "").trim();

    if (phase) {
        const index = existing.findIndex((entry) => String(entry?.metadata?.phase || "").trim() === phase);
        if (index >= 0) {
            const next = existing.slice();
            next[index] = {
                ...next[index],
                message: normalizedMessage,
                metadata: {
                    ...next[index].metadata,
                    ...normalizedMetadata,
                },
            };
            return next.slice(-6);
        }
    }

    const last = existing[existing.length - 1];
    if (last?.message === normalizedMessage) {
        return existing;
    }

    return [...existing, {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        message: normalizedMessage,
        metadata: normalizedMetadata,
    }].slice(-6);
}
