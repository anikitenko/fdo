// Deliberately retain only bounded, non-output host diagnostics. Commands and
// stdout/stderr can contain secrets and must not be copied into Git audit data.
export function auditFailureDetails(error = {}) {
    const details = error?.details || {};
    const result = error?.result || {};
    const stderr = typeof result.stderr === 'string' ? result.stderr : '';
    const outputReason = /not a git repository/i.test(stderr) ? 'NOT_GIT_REPOSITORY'
        : /repository[^\n]*not found/i.test(stderr) ? 'REPOSITORY_NOT_FOUND'
        : /permission denied.*publickey/i.test(stderr) ? 'AUTHENTICATION_FAILED'
        : /could not read from remote repository|access denied/i.test(stderr) ? 'REPOSITORY_ACCESS_DENIED' : '';
    return {
        ...(outputReason ? {reason: outputReason} : {}),
        ...(typeof details.gitFailure === 'string' && /^[A-Z_]{1,64}$/.test(details.gitFailure) ? {reason: details.gitFailure} : {}),
        ...(typeof details.scopeViolation?.reason === 'string' && /^[A-Z_]{1,64}$/.test(details.scopeViolation.reason) ? {reason: details.scopeViolation.reason} : {}),
        ...(Number.isInteger(result.exitCode) ? {exitCode: result.exitCode} : {}),
        ...(error.code === 'HOST_KEY_REJECTED' ? {reason: 'HOST_KEY_REJECTED'} : {}),
        ...(result.timedOut === true ? {timedOut: true} : {}),
    };
}
