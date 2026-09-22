// Absolute emergency ceiling, not a target or a preallocated run allowance.
// Operators raise it per environment when a scenario legitimately needs more
// repair rounds; it stays the last guard against unbounded provider spend.
const DEFAULT_LIVE_AI_REQUEST_CEILING = 50;
// Bounded convergence rounds for the acceptance stages that retry, so a run
// cannot loop against a provider indefinitely.
const DEFAULT_LIVE_AI_REPAIR_ATTEMPTS = 3;

function positiveInteger(raw, name) {
    const value = Number(String(raw).trim());
    if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer.`);
    return value;
}

function liveAiRequestCeiling(env = process.env) {
    const raw = env.FDO_TEST_AI_REQUEST_CEILING;
    if (raw === undefined || String(raw).trim() === '') return DEFAULT_LIVE_AI_REQUEST_CEILING;
    return positiveInteger(raw, 'FDO_TEST_AI_REQUEST_CEILING');
}

function liveAiRepairAttempts(env = process.env) {
    const raw = env.FDO_E2E_LIVE_AI_REPAIR_ATTEMPTS;
    if (raw === undefined || String(raw).trim() === '') return DEFAULT_LIVE_AI_REPAIR_ATTEMPTS;
    return positiveInteger(raw, 'FDO_E2E_LIVE_AI_REPAIR_ATTEMPTS');
}

function liveAiBudgetPolicy(env = process.env) {
    const ceiling = liveAiRequestCeiling(env);
    const value = String(env.FDO_TEST_AI_MAX_REQUESTS || 'auto').trim();
    const mode = value === 'auto' ? 'adaptive' : 'fixed';
    const limit = mode === 'adaptive' ? ceiling : Number(value);
    if (!Number.isInteger(limit) || limit < 1 || limit > ceiling) {
        throw new Error(`FDO_TEST_AI_MAX_REQUESTS must be auto or an integer from 1 to ${ceiling}.`);
    }
    return {mode, limit, ceiling, envValue: mode === 'adaptive' ? 'auto' : String(limit)};
}
function liveAiRequestLimit(env = process.env) { return liveAiBudgetPolicy(env).limit; }
module.exports = {
    DEFAULT_LIVE_AI_REQUEST_CEILING, DEFAULT_LIVE_AI_REPAIR_ATTEMPTS,
    liveAiRequestCeiling, liveAiRepairAttempts, liveAiBudgetPolicy, liveAiRequestLimit,
};
