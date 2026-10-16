import React from 'react';
import {fireEvent, render, screen} from '@testing-library/react';
import {PluginShortcutsDialog} from '../../src/components/PluginShortcutsDialog';
import {normalizePluginUiPreferences} from '../../src/utils/plugins/runtime/pluginUiPreferences';

test('pins and hides independently without invoking plugin actions', () => {
    const onChange = jest.fn();
    render(<PluginShortcutsDialog isOpen onClose={() => {}} preferences={normalizePluginUiPreferences()} onChange={onChange}
        actions={[{id: 'search', name: 'Search', section: 'Tools'}]} sidebarItems={[{id: 'tools', name: 'Tools'}]}/>);
    fireEvent.click(screen.getByLabelText('Pin Search'));
    expect(onChange.mock.calls[0][0].pinnedActionIds).toEqual(['search']);
    fireEvent.click(screen.getByLabelText('Show Tools'));
    expect(onChange.mock.calls[1][0].hiddenSidebarIds).toEqual(['tools']);
});

test('sidebar and pinned ordering controls update separate saved lists', () => {
    const onChange = jest.fn();
    render(<PluginShortcutsDialog isOpen onClose={() => {}} preferences={normalizePluginUiPreferences({pinnedActionIds: ['a', 'b']})} onChange={onChange}
        actions={[{id: 'a', name: 'First'}, {id: 'b', name: 'Second'}]} sidebarItems={[{id: 'x', name: 'First menu'}, {id: 'y', name: 'Second menu'}]}/>);
    fireEvent.click(screen.getByRole('button', {name: 'Move Second up', exact: true}));
    expect(onChange.mock.calls[0][0].pinnedActionIds).toEqual(['b', 'a']);
    fireEvent.click(screen.getByRole('button', {name: 'Move Second menu up', exact: true}));
    expect(onChange.mock.calls[1][0].sidebarOrder).toEqual(['y', 'x']);
    expect(onChange.mock.calls[1][0].pinnedActionIds).toEqual(['a', 'b']);
});
