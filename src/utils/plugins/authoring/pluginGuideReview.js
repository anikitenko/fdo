// Only the isolated live-provider harness may bypass the manual approval UI.
export function createPluginGuideReview({env = process.env, manualReview, manualRecover, approve, onRetry = () => {}}) {
    const automatic = env.FDO_E2E === '1' && env.FDO_E2E_LIVE_AI === '1';
    let retried = false;
    return {
        reviewSkill: file => automatic ? approve(file) : manualReview(file),
        recover: async proposal => {
            if (!automatic) return manualRecover(proposal);
            if (!retried) {
                retried = true;
                onRetry(proposal.errors);
                return {action: 'retry'};
            }
            throw Object.assign(new Error(`Plugin guide proposal validation failed after automatic live-test recovery: ${JSON.stringify(proposal.errors)}`),
                {code: 'LIVE_GUIDE_PROPOSAL_INVALID'});
        },
    };
}
