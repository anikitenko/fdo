import React from 'react';
import {Card, H4, Tag} from '@blueprintjs/core';

const reasons = {
    AUTHENTICATION_FAILED: 'The SSH server rejected the saved credential. Check the profile username, key/password and passphrase.',
    PROFILE_NOT_FOUND: 'No authorized profile matches the plugin, SSH endpoint, repository path and operation.',
    PROFILE_AMBIGUOUS: 'Several profiles match. Remove duplicate repository authorizations.',
    HOST_KEY_REJECTED: 'The server identity did not match the trusted host key.',
    REPOSITORY_NOT_FOUND: 'The server reports that the repository does not exist or is not visible to this credential.',
    REPOSITORY_ACCESS_DENIED: 'The server denied repository access. Check the repository path and credential authorization.',
    NOT_GIT_REPOSITORY: 'The working folder is not a Git repository. Check the configured working folder.',
    CONNECTION_REFUSED: 'The endpoint refused the connection. Check its hostname, port and firewall/VPN.',
    DNS_LOOKUP_FAILED: 'The SSH hostname could not be resolved. Check the hostname and network/VPN.',
    GIT_EXECUTABLE_OR_CWD_MISSING: 'The installed Git executable or working folder does not exist.',
    GIT_EXECUTABLE_NOT_PERMITTED: 'The operating system denied access to the Git executable or working folder.',
    HELPER_ARGUMENTS_REJECTED: 'The host SSH adapter rejected Git’s transport arguments. Update FDO and report the request ID if this persists.',
    HELPER_NOT_CONNECTED: 'The host SSH adapter did not connect. Restart FDO and report the request ID if this persists.',
    CONNECTION_CLOSED: 'The SSH connection closed before the operation completed.',
    REMOTE_COMMAND_REJECTED: 'The SSH server rejected the Git service request.',
    REMOTE_EXIT_STATUS_MISSING: 'The remote service closed without returning an exit status.',
};
export function PluginDoctorFailures({events = []}) {
    const failures = events.filter(event => event?.success === false).slice().reverse();
    if (!failures.length) return null;
    return <section aria-label="Host action failure details" style={{marginBottom: 16}}>
        <H4>Host action failures</H4>
        <p className="bp6-text-muted">Reasons and request IDs are retained here. Command output is not recorded automatically because it may contain credentials or other sensitive data.</p>
        {failures.map((event, index) => {
            const detail = event.error?.diagnosticDetails || {};
            const code = event.error?.code || 'UNKNOWN_ERROR';
            return <Card key={event.id || `${event.correlationId}-${index}`} style={{marginBottom: 8}}>
                <div><strong>{event.action || 'Host action'}</strong>{event.scope ? ` · ${event.scope}` : ''} <Tag intent="danger" variant="minimal">{code}</Tag></div>
                <p>{event.error?.message || 'The host did not retain a detailed reason for this older event. Reproduce the failure to capture updated diagnostics.'}</p>
                {detail.reason && <p><code>{detail.reason}</code>{reasons[detail.reason] ? ` — ${reasons[detail.reason]}` : ''}</p>}
                <dl>
                    {Number.isInteger(detail.exitCode) && <><dt>Exit code</dt><dd>{detail.exitCode}</dd></>}
                    {event.timedOut && <><dt>Timeout</dt><dd>The operation exceeded its deadline.</dd></>}
                    {event.durationMs != null && <><dt>Duration</dt><dd>{event.durationMs} ms</dd></>}
                    <dt>Request ID</dt><dd><code>{event.correlationId || event.error?.correlationId || 'Not recorded'}</code></dd>
                    <dt>Occurred</dt><dd>{event.timestamp || 'Not recorded'}</dd>
                </dl>
            </Card>;
        })}
    </section>;
}
