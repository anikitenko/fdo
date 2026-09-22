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
    transportStatus = "",
} = {}) {
    const elapsed = formatAiCodingElapsedShort(elapsedMs);

    if (transportStatus) return `${transportStatus} (${elapsed} elapsed)`;

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
        : `Still waiting for the first answer (${elapsed} elapsed). Prompt or image processing may still be in progress.`;
}

export function buildAiCodingFirstResponseStatus(elapsedMs = 0) {
    return `First visible response received after ${formatAiCodingElapsedShort(elapsedMs)}. Drafting the rest of the answer.`;
}

// Per transport attempt, independent of provider tokenization and billing.
export function createAiCodingStreamProgress() {
    return {characters: 0, firstTextAt: null, lastTextAt: null};
}

export function recordAiCodingStreamText(progress, text, now = Date.now()) {
    if (typeof text !== "string" || !text.length) return;
    progress.firstTextAt ??= now;
    progress.lastTextAt = now;
    progress.characters += text.length;
}

export function buildAiCodingStreamStatus(progress, now = Date.now()) {
    if (!progress?.characters) return "";
    const idleSeconds = Math.max(0, Math.floor((now - progress.lastTextAt) / 1000));
    const duration = Math.max(0, now - progress.firstTextAt);
    const rate = duration >= 5000
        ? ` · ${Math.round(progress.characters / (duration / 1000)).toLocaleString("en-US")} chars/s average`
        : "";
    const receipt = idleSeconds < 2 ? "Receiving answer text."
        : idleSeconds < 30 ? `Last answer text ${idleSeconds}s ago.`
            : `No new answer text for ${idleSeconds}s. You can stop this request and keep the partial response.`;
    return `${progress.characters.toLocaleString("en-US")} answer characters received${rate}. ${receipt}`;
}

export function buildAiCodingReasoningStatus(elapsedMs = 0) {
    return `The model is producing reasoning; no answer text has arrived yet (${formatAiCodingElapsedShort(elapsedMs)} elapsed).`;
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

    // Providers can repeat the same lifecycle event after a transport retry.
    // Keep one human-readable milestone instead of making the activity trail
    // look like two separate requests.
    if (existing.some((entry) => entry?.message === normalizedMessage)) {
        return existing;
    }

    if (phase) {
        const index = existing.findIndex((entry) => String(entry?.metadata?.phase || "").trim() === phase);
        if (index >= 0) {
            const updated = {
                ...existing[index],
                message: normalizedMessage,
                metadata: {
                    ...existing[index].metadata,
                    ...normalizedMetadata,
                },
            };
            // The popover displays the final entry as the current activity.
            // A resumed phase must become current instead of staying in history.
            return [...existing.filter((_, entryIndex) => entryIndex !== index), updated].slice(-6);
        }
    }

    return [...existing, {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        message: normalizedMessage,
        metadata: normalizedMetadata,
    }].slice(-6);
}
