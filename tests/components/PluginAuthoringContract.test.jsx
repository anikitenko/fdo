import React from 'react';
import {render, screen} from '@testing-library/react';
import PluginAuthoringContract from '../../src/components/plugin/PluginAuthoringContract';
import {workspaceAuthoringContract} from '../../src/utils/sdk/pluginAuthoringContract';

test('engineers see target ranges, installed versions and the distinction from runtime compatibility', () => {
    render(<PluginAuthoringContract context={workspaceAuthoringContract()}/>);
    expect(screen.getByText(/Build target FDO:/)).toBeVisible();
    screen.getByText(/Build target FDO:/).click();
    expect(screen.getByText(/Installed FDO/)).toHaveTextContent('Host API 1.0.0');
    expect(screen.getByText(/Handshake 1.0.0/)).toHaveTextContent('Capability schema 1.0.0');
    expect(screen.getByText(/does not verify older hosts/)).toBeVisible();
});
