import React from 'react';
import {render,screen,fireEvent} from '@testing-library/react';
import RegistryBadge from '../../src/components/plugin/RegistryBadge';
test('registry provenance is visible in Manage Plugins with durable release details',()=>{
    const plugin={id:'local-id',metadata:{name:'Human Name'},registry:{origin:'https://plugins.fdo.alexvwan.me',pluginId:'source-id',version:'2.0.0',packageSha256:'a'.repeat(64),signerFingerprint:'b'.repeat(64),installedAt:'2026-01-01T00:00:00Z',needsCapabilityReview:true}};
    render(<RegistryBadge plugin={plugin}/>);
    fireEvent.click(screen.getByRole('button',{name:'View registry details for Human Name'}));
    expect(screen.getByRole('dialog',{name:'Registry installation'})).toBeInTheDocument();
    expect(screen.getByText('source-id')).toBeInTheDocument();expect(screen.getByText('Review required before activation')).toBeInTheDocument();
    expect(screen.getByText('a'.repeat(64))).toBeInTheDocument();
});
