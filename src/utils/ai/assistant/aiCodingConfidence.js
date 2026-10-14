// Confidence describes observed verification evidence, never model certainty.
export function pluginTestsVerificationCheck(result) {
    return {id: 'tests', label: 'Plugin tests',
        status: result?.success !== true ? 'failed' : result?.skipped ? 'not-run' : 'passed',
        detail: result?.success !== true ? String(result?.error || 'Plugin tests did not complete successfully.')
            : result?.skipped ? 'No plugin tests were found.' : 'The host test runner completed successfully.'};
}

export function aiCodingConfidence(report, error = '', {active = false, hasResponse = false} = {}) {
    const checks = report?.checks || [];
    const required = ['contracts', 'types', 'build', 'tests', 'acceptance'];
    const passed = required.filter(id => checks.some(check => check.id === id && check.status === 'passed')).length;
    if (error || checks.some(check => check.status === 'failed')) return {label: 'Needs attention',
        detail: 'A request or verification check failed. The current result is not verified.', checks};
    if (passed === required.length) return {label: 'Strong evidence',
        detail: 'Contracts, types, build, tests and approved acceptance checks passed. This is not a correctness guarantee or a security audit.', checks};
    if (passed) return {label: 'Limited evidence', detail: `${passed} of ${required.length} verification groups passed. Remaining checks are pending or were not run.`, checks};
    if (active || checks.some(check => ['running', 'pending'].includes(check.status))) return {label: 'Checking',
        detail: checks.length ? 'Verification is still in progress. Generation progress alone does not establish correctness.'
            : 'The request is in progress; verification evidence has not arrived yet. Generation progress alone does not establish correctness.', checks};
    if (hasResponse || checks.length) return {label: 'Not verified',
        detail: 'No required verification group has passed for this result. Review proposed changes and run workspace validation before relying on them.', checks};
    return {label: 'Not yet assessed',
        detail: 'Confidence will reflect verification results. Generated files and elapsed time alone do not establish correctness.', checks};
}
