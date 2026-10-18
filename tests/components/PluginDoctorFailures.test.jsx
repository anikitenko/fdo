import React from 'react';
import {render, screen} from '@testing-library/react';
import {PluginDoctorFailures} from '../../src/components/PluginDoctorFailures';
test('shows the reason, exit status and request ID while keeping command output private', () => {
    render(<PluginDoctorFailures events={[{id: '1', success: false, action: 'system.process.exec', scope: 'git', timestamp: '2026-10-18T10:00:00Z', correlationId: 'request-42',
        error: {code: 'PROCESS_EXIT_NON_ZERO', message: 'Git operation failed.', diagnosticDetails: {reason: 'REPOSITORY_NOT_FOUND', exitCode: 128}}, stdout: 'SECRET', stderr: 'SECRET'}]}/>);
    expect(screen.getByText('REPOSITORY_NOT_FOUND')).toBeVisible();
    expect(screen.getByText(/not visible to this credential/)).toBeVisible();
    expect(screen.getByText('128')).toBeVisible();
    expect(screen.getByText('request-42')).toBeVisible();
    expect(screen.queryByText('SECRET')).not.toBeInTheDocument();
});
