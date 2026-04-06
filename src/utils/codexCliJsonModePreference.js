const jsonCooldownByKey = new Map();

export const CODEX_JSON_COOLDOWN_MS = 12 * 60 * 60 * 1000;

function buildKey({ assistantId = "", model = "", command = "" } = {}) {
    return [assistantId, model, command].join("::");
}

export function shouldUseCodexJsonMode(preference = {}) {
    const key = buildKey(preference);
    const state = jsonCooldownByKey.get(key);
    const until = typeof state === "number" ? state : (state?.until || 0);
    return Date.now() >= until;
}

export function markCodexJsonModeCooldown(preference = {}, durationMs = CODEX_JSON_COOLDOWN_MS, reason = "progress-only-json") {
    const key = buildKey(preference);
    const current = jsonCooldownByKey.get(key);
    const currentFailures = typeof current === "object" && current !== null
        ? (current.failures || 0)
        : 0;
    const nextFailures = currentFailures + 1;
    const multiplier = nextFailures >= 2 ? 2 : 1;
    jsonCooldownByKey.set(key, {
        until: Date.now() + (durationMs * multiplier),
        failures: nextFailures,
        reason,
        updatedAt: Date.now(),
    });
}

export function clearCodexJsonModeCooldown(preference = {}) {
    const key = buildKey(preference);
    jsonCooldownByKey.delete(key);
}

export function getCodexJsonModeCooldownState(preference = {}) {
    const key = buildKey(preference);
    const state = jsonCooldownByKey.get(key);
    if (!state) return null;
    if (typeof state === "number") {
        return {
            until: state,
            failures: 1,
            reason: "unknown",
        };
    }
    return { ...state };
}
