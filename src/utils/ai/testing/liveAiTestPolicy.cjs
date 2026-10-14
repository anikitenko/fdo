const {MAX_WORKSPACE_FILES} = require('../generation/codingRequestPolicy.cjs');
// Default starting ceiling. Only validated, distinct workspace files can earn
// bounded extra capacity in auto mode. Explicit operator caps remain absolute.
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
    const explicitCeiling = env.FDO_TEST_AI_REQUEST_CEILING !== undefined && String(env.FDO_TEST_AI_REQUEST_CEILING).trim() !== '';
    const progressAllowance = mode === 'adaptive' && !explicitCeiling ? MAX_WORKSPACE_FILES : 0;
    return {mode, limit, ceiling, progressAllowance, maximumLimit: limit + progressAllowance,
        envValue: mode === 'adaptive' ? 'auto' : String(limit)};
}
function liveAiRequestLimit(env = process.env) { return liveAiBudgetPolicy(env).limit; }
// Time and request-count policies are independent. Explicit request caps still
// bound cost; only distinct validated files can earn additional scenario time.
function liveAiTimeoutPolicy(env = process.env) {
    const configured = Number(env.FDO_E2E_LIVE_AI_TIMEOUT_MS || 180000);
    const initialMs = Math.max(Number.isFinite(configured) && configured >= 60000 ? configured : 180000, 600000);
    const mode = env.FDO_E2E_LIVE_AI_TIMEOUT_MODE || 'adaptive';
    if (!['adaptive', 'fixed'].includes(mode)) throw new Error('FDO_E2E_LIVE_AI_TIMEOUT_MODE must be adaptive or fixed.');
    const maximumMs = env.FDO_E2E_LIVE_AI_MAX_TIMEOUT_MS
        ? positiveInteger(env.FDO_E2E_LIVE_AI_MAX_TIMEOUT_MS, 'FDO_E2E_LIVE_AI_MAX_TIMEOUT_MS') : Math.max(initialMs, 7200000);
    if (maximumMs < initialMs) throw new Error('FDO_E2E_LIVE_AI_MAX_TIMEOUT_MS must be at least the initial scenario timeout.');
    return {mode, initialMs, maximumMs: mode === 'fixed' ? initialMs : maximumMs,
        perFileMs: mode === 'adaptive' ? 120000 : 0, maximumFiles: MAX_WORKSPACE_FILES};
}

function liveAiTimeoutDuration(policy, validatedFiles = 0) {
    const count = Math.max(0, Math.min(policy.maximumFiles, Math.floor(Number(validatedFiles) || 0)));
    return Math.min(policy.maximumMs, policy.initialMs + count * policy.perFileMs);
}
module.exports = {
    DEFAULT_LIVE_AI_REQUEST_CEILING, DEFAULT_LIVE_AI_REPAIR_ATTEMPTS,
    liveAiRequestCeiling, liveAiRepairAttempts, liveAiBudgetPolicy, liveAiRequestLimit, liveAiTimeoutPolicy, liveAiTimeoutDuration,
};
