import {liveAiBudgetPolicy} from './liveAiTestPolicy.cjs';

let requests = 0;
let allocated = 0;
let startedAt;
let deadline;

const enabled = env => env.FDO_E2E === '1' && env.FDO_E2E_LIVE_AI === '1';
function policyAt(env) {
    const policy = liveAiBudgetPolicy(env);
    if (startedAt === undefined) {
        startedAt = Date.now();
        const configured = Number(env.FDO_E2E_LIVE_AI_TIMEOUT_MS || 180000);
        // Same scenario duration as the live runner; never extend on repair.
        deadline = startedAt + Math.max(Number.isFinite(configured) && configured >= 60000 ? configured : 180000, 600000);
    }
    if (Date.now() >= deadline) throw new Error('Live AI run deadline reached. No further requests were sent.');
    return policy;
}
function snapshot(policy) {
    const state = {mode: policy.mode, used: requests, allocated: policy.mode === 'fixed' ? policy.limit : allocated,
        ceiling: policy.limit, startedAt, deadline};
    globalThis.__FDO_E2E_LIVE_AI_BUDGET__ = state;
    return state;
}
export function getLiveAiTestBudget(env = process.env) {
    if (!enabled(env)) return null;
    return snapshot(liveAiBudgetPolicy(env));
}

// Admit the actual pending work, without charging calls which haven't happened.
// Validated inventories and split plans supply required; callers recheck it on
// recovery. Existing bounded retries are not expanded by budget admission.
export function assertLiveAiTestRequestsAvailable(required, env = process.env) {
    if (!enabled(env)) return;
    if (!Number.isInteger(required) || required < 1) throw new Error('Required requests must be a positive integer.');
    const policy = policyAt(env);
    const remaining = Math.max(0, policy.limit - requests);
    if (required > remaining) {
        snapshot(policy);
        const advice = policy.mode === 'adaptive' ? 'The absolute safety ceiling has been reached; reduce the scope.'
            : `Use FDO_TEST_AI_MAX_REQUESTS=auto for plan-based admission, or raise the explicit cap (maximum ${policy.ceiling}).`;
        throw new Error(`Live AI request budget cannot complete this workspace step: at least ${required} requests needed, ${remaining} remaining (${requests}/${policy.limit} used). No changes from this request were applied. ${advice} Retries and validation repairs also consume this budget.`);
    }
    // Grow only to cover this concrete step, not to the emergency ceiling.
    if (policy.mode === 'adaptive') allocated = Math.max(allocated, requests + required);
    snapshot(policy);
}

export function reserveLiveAiTestRequest(env = process.env) {
    if (!enabled(env)) return;
    const policy = policyAt(env);
    if (requests >= policy.limit) throw new Error(`Live AI request limit reached (${policy.limit}). No further requests were sent.`);
    assertLiveAiTestRequestsAvailable(1, env);
    requests += 1;
    snapshot(policy);
}
