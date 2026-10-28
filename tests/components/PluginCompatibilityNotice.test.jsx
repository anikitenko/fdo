import React from 'react';
import {render, screen} from '@testing-library/react';
import PluginCompatibilityNotice from '../../src/components/plugin/PluginCompatibilityNotice';

test('shows supported versions, current installation and actionable incompatibility details', () => {
    render(<PluginCompatibilityNotice report={{status: 'incompatible', supportedFdo: '>=1.5.0 <2', currentFdo: '1.0.3', currentSdk: '1.8.3',
        builtWith: {fdo: '1.5.0', sdk: '1.9.0'}, summary: 'This plugin cannot run on this FDO installation.',
        issues: ['Requires FDO >=1.5.0 <2; this installation provides 1.0.3.'], remediation: 'Install a supported FDO version or ask the plugin maintainer for a compatible build.'}}/>);
    expect(screen.getByText('Supported FDO: >=1.5.0 <2')).toBeVisible();
    expect(screen.getByText('Your installation: FDO 1.0.3 · SDK 1.8.3')).toBeVisible();
    expect(screen.getByText('Built with FDO 1.5.0 · SDK 1.9.0')).toBeVisible();
    expect(screen.getByText(/Install a supported FDO version/)).toBeVisible();
});
