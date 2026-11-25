import React from 'react';
import {fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import AIAssistantsPanel from '../../src/components/settings/panels/AIAssistantsPanel';
import CodexSetup from '../../src/components/settings/panels/CodexSetup';

jest.mock('../../src/components/AppToaster', () => ({AppToaster: {show: jest.fn()}}));

const model = {label: 'GPT Code', value: 'gpt-code', provider: 'codex-cli'};

async function openCodexDialog(overrides = {}) {
    const ai = {getAssistants: jest.fn().mockResolvedValue([]),
        getAvailableModels: jest.fn().mockResolvedValue([model]),
        addAssistant: jest.fn().mockResolvedValue({}), ...overrides.ai};
    const system = {openFileDialog: jest.fn(), openExternal: jest.fn(), ...overrides.system};
    window.electron = {settings: {ai}, system};
    render(<AIAssistantsPanel />);
    await screen.findByText('No AI Assistants yet');
    fireEvent.click(screen.getByRole('button', {name: 'Add Assistant'}));
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.change(dialog.getByLabelText('Provider'), {target: {value: 'codex-cli'}});
    return {ai, system, dialog};
}

test('provider names say Codex and Gemini CLIs are separate installations', async () => {
    const {dialog} = await openCodexDialog();
    const labels = dialog.getAllByRole('option').map(option => option.textContent);
    expect(labels).toContain('Codex CLI (separate installation)');
    expect(labels).toContain('Gemini CLI (separate installation)');
    expect(labels.join()).not.toMatch(/built into FDO/i);
});

test('Codex executable path is editable with a PATH auto-detect placeholder', async () => {
    const {dialog} = await openCodexDialog();
    const input = dialog.getByLabelText('Codex CLI location');
    expect(input).not.toHaveAttribute('readonly');
    expect(input).toHaveAttribute('placeholder', expect.stringMatching(/auto-detect.*PATH/i));
    expect(input).toHaveValue('');
    fireEvent.change(input, {target: {value: '/home/dev/.npm-global/bin/codex'}});
    await waitFor(() => expect(window.electron.settings.ai.getAvailableModels)
        .toHaveBeenLastCalledWith('codex-cli', '', undefined, undefined, '/home/dev/.npm-global/bin/codex'));
});

test('Browse shows hidden files and fills the path', async () => {
    const openFileDialog = jest.fn().mockResolvedValue('/Users/dev/.nvm/bin/codex');
    const {dialog} = await openCodexDialog({system: {openFileDialog}});
    fireEvent.click(dialog.getByRole('button', {name: 'Browse…'}));
    await waitFor(() => expect(dialog.getByLabelText('Codex CLI location')).toHaveValue('/Users/dev/.nvm/bin/codex'));
    expect(openFileDialog.mock.calls[0][0].properties).toEqual(expect.arrayContaining(['openFile', 'showHiddenFiles']));
});

test('cancelling Browse keeps the typed path', async () => {
    const {dialog} = await openCodexDialog({system: {openFileDialog: jest.fn().mockResolvedValue(null)}});
    fireEvent.change(dialog.getByLabelText('Codex CLI location'), {target: {value: '/opt/codex'}});
    fireEvent.click(dialog.getByRole('button', {name: 'Browse…'}));
    await waitFor(() => expect(window.electron.system.openFileDialog).toHaveBeenCalled());
    expect(dialog.getByLabelText('Codex CLI location')).toHaveValue('/opt/codex');
});

test('Test Codex CLI reports success and re-checks on demand', async () => {
    const {ai, dialog} = await openCodexDialog();
    await dialog.findByText('Codex CLI found and ready.');
    expect(dialog.queryByRole('button', {name: 'Check again'})).toBeNull();
    const calls = ai.getAvailableModels.mock.calls.length;
    fireEvent.click(dialog.getByRole('button', {name: 'Test Codex CLI'}));
    await waitFor(() => expect(ai.getAvailableModels.mock.calls.length).toBeGreaterThan(calls));
});

test('Test Codex CLI explains when Codex is not found', async () => {
    const {dialog} = await openCodexDialog({ai: {getAvailableModels: jest.fn().mockRejectedValue(new Error('codex not found on PATH'))}});
    await dialog.findByText('Codex CLI not usable: codex not found on PATH');
});

test('Installation guide opens the Codex CLI docs', async () => {
    const {system, dialog} = await openCodexDialog();
    fireEvent.click(dialog.getByRole('button', {name: 'Installation guide'}));
    expect(system.openExternal).toHaveBeenCalledWith('https://developers.openai.com/codex/cli/');
});

test('saving passes the typed executable path', async () => {
    const {ai, dialog} = await openCodexDialog();
    fireEvent.change(dialog.getByLabelText('Codex CLI location'), {target: {value: '/opt/codex'}});
    await waitFor(() => expect(dialog.getByLabelText('Codex Model')).toHaveValue('gpt-code'));
    fireEvent.change(dialog.getByLabelText('Name'), {target: {value: 'Codex'}});
    fireEvent.click(dialog.getByRole('button', {name: 'Add Assistant'}));
    await waitFor(() => expect(ai.addAssistant).toHaveBeenCalled());
    expect(ai.addAssistant.mock.calls[0][0]).toMatchObject({provider: 'codex-cli', executablePath: '/opt/codex'});
});

describe('CodexSetup callout', () => {
    test('uses Test/Browse wording and drives refresh and choose', async () => {
        const chooseCodexExecutable = jest.fn().mockResolvedValue();
        window.electron = {settings: {ai: {chooseCodexExecutable}}, system: {openExternal: jest.fn()}};
        const onRefresh = jest.fn().mockResolvedValue();
        render(<CodexSetup assistant={{id: 'a1', codexRuntime: {message: 'Codex not found'}}} onRefresh={onRefresh}/>);
        expect(screen.getByText('Codex not found')).toBeInTheDocument();
        expect(screen.queryByRole('button', {name: 'Check again'})).toBeNull();
        fireEvent.click(screen.getByRole('button', {name: 'Test Codex CLI'}));
        expect(onRefresh).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByRole('button', {name: 'Browse for Codex CLI…'}));
        await waitFor(() => expect(chooseCodexExecutable).toHaveBeenCalledWith('a1'));
        await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(2));
    });

    test('shows the error when choosing fails', async () => {
        window.electron = {settings: {ai: {chooseCodexExecutable: jest.fn().mockRejectedValue(new Error('Not a Codex binary'))}}, system: {}};
        render(<CodexSetup assistant={{id: 'a1'}} onRefresh={jest.fn()}/>);
        fireEvent.click(screen.getByRole('button', {name: 'Browse for Codex CLI…'}));
        expect(await screen.findByRole('alert')).toHaveTextContent('Not a Codex binary');
    });
});
