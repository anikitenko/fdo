import React from 'react';
import {fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import AIAssistantsPanel from '../../src/components/settings/panels/AIAssistantsPanel';

jest.mock('../../src/components/AppToaster', () => ({AppToaster: {show: jest.fn()}}));

test.each(['chat', 'coding'])('Gemini API can be saved for %s without CLI or local server fields', async purpose => {
    const ai = {getAssistants: jest.fn().mockResolvedValue([]),
        getAvailableModels: jest.fn().mockResolvedValue([{label: 'Gemini', value: 'gemini-test', provider: 'gemini'}]),
        addAssistant: jest.fn().mockResolvedValue({})};
    window.electron = {settings: {ai}};
    render(<AIAssistantsPanel />);
    await screen.findByText('No AI Assistants yet');
    fireEvent.click(screen.getByRole('button', {name: 'Add Assistant'}));
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.change(dialog.getByLabelText('Provider'), {target: {value: 'gemini'}});
    fireEvent.change(dialog.getByLabelText('API Key'), {target: {value: 'test-token'}});
    await waitFor(() => expect(dialog.getByLabelText('Model')).toHaveValue('gemini-test'));
    expect(dialog.getByLabelText('Purpose')).not.toBeDisabled();
    fireEvent.change(dialog.getByLabelText('Purpose'), {target: {value: purpose}});
    fireEvent.change(dialog.getByLabelText('Name'), {target: {value: 'Gemini API'}});
    fireEvent.click(dialog.getByRole('button', {name: 'Add Assistant'}));
    await waitFor(() => expect(ai.addAssistant).toHaveBeenCalledTimes(1));
    expect(ai.addAssistant.mock.calls[0][0]).toMatchObject({provider: 'gemini', purpose, model: 'gemini-test', apiKey: 'test-token'});
    expect(ai.addAssistant.mock.calls[0][0]).not.toHaveProperty('baseUrl');
    expect(ai.addAssistant.mock.calls[0][0]).not.toHaveProperty('executablePath');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

test('hosted assistants do not receive local-only form fields', async () => {
    const ai = {
        getAssistants: jest.fn().mockResolvedValue([]),
        getAvailableModels: jest.fn().mockResolvedValue([{label: 'hosted-model', value: 'hosted-model', provider: 'openai'}]),
        addAssistant: jest.fn().mockResolvedValue({}),
    };
    window.electron = {settings: {ai}};
    render(<AIAssistantsPanel />);
    await screen.findByText('No AI Assistants yet');
    fireEvent.click(screen.getByRole('button', {name: 'Add Assistant'}));
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.change(dialog.getByLabelText('Name'), {target: {value: 'Hosted chat'}});
    fireEvent.change(dialog.getByLabelText('API Key'), {target: {value: 'test-only'}});
    await waitFor(() => expect(dialog.getByLabelText('Model')).toHaveValue('hosted-model'));
    fireEvent.click(dialog.getByRole('button', {name: 'Add Assistant'}));
    await waitFor(() => expect(ai.addAssistant).toHaveBeenCalledTimes(1));
    const payload = ai.addAssistant.mock.calls[0][0];
    expect(payload).toMatchObject({provider: 'openai', purpose: 'chat'});
    expect(payload).not.toHaveProperty('baseUrl');
    expect(payload).not.toHaveProperty('contextLength');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

test('adds a local coding assistant with downloaded model, endpoint and context, without an API key', async () => {
    const ai = {
        getAssistants: jest.fn().mockResolvedValue([]),
        getAvailableModels: jest.fn().mockResolvedValue([{label: 'local:8b', value: 'local:8b', provider: 'ollama'}]),
        addAssistant: jest.fn().mockResolvedValue({}),
    };
    window.electron = {settings: {ai}};
    render(<AIAssistantsPanel />);
    await screen.findByText('No AI Assistants yet');
    fireEvent.click(screen.getByRole('button', {name: 'Add Assistant'}));
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.change(dialog.getByLabelText('Provider'), {target: {value: 'ollama'}});
    await waitFor(() => expect(dialog.getByLabelText('Model')).toHaveValue('local:8b'));
    expect(ai.getAvailableModels).toHaveBeenCalledWith('ollama', '', 'http://127.0.0.1:11434');
    expect(dialog.queryByLabelText('API Key')).toBeNull();
    expect(dialog.getByLabelText('Purpose')).toHaveValue('coding');
    expect(dialog.getByLabelText('Purpose')).toBeDisabled();
    fireEvent.change(dialog.getByLabelText('Name'), {target: {value: 'Local coding'}});
    fireEvent.change(dialog.getByLabelText('Ollama server URL'), {target: {value: 'http://localhost:11435'}});
    await waitFor(() => expect(ai.getAvailableModels).toHaveBeenLastCalledWith('ollama', '', 'http://localhost:11435'));
    await waitFor(() => expect(dialog.getByLabelText('Model')).not.toBeDisabled());
    fireEvent.change(dialog.getByLabelText('Context length (tokens)'), {target: {value: '16384'}});
    fireEvent.click(dialog.getByRole('button', {name: 'Add Assistant'}));
    await waitFor(() => expect(ai.addAssistant).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Local coding', provider: 'ollama', model: 'local:8b', purpose: 'coding',
        apiKey: '', baseUrl: 'http://localhost:11435', contextLength: '16384',
    })));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

test('Cloudflare loads models after account and token, and saves coding-only account settings', async () => {
    const ai = {getAssistants: jest.fn().mockResolvedValue([]),
        getAvailableModels: jest.fn().mockResolvedValue([{label: '@cf/test/model', value: '@cf/test/model', provider: 'cloudflare'}]),
        addAssistant: jest.fn().mockResolvedValue({})};
    window.electron = {settings: {ai}};
    render(<AIAssistantsPanel />);
    await screen.findByText('No AI Assistants yet');
    fireEvent.click(screen.getByRole('button', {name: 'Add Assistant'}));
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.change(dialog.getByLabelText('Provider'), {target: {value: 'cloudflare'}});
    fireEvent.change(dialog.getByLabelText('API Token'), {target: {value: 'test-token'}});
    expect(ai.getAvailableModels).not.toHaveBeenCalled();
    fireEvent.change(dialog.getByLabelText('Cloudflare account ID'), {target: {value: 'a'.repeat(32)}});
    await waitFor(() => expect(dialog.getByLabelText('Model')).toHaveValue('@cf/test/model'));
    expect(ai.getAvailableModels).toHaveBeenCalledWith('cloudflare', 'test-token', 'http://127.0.0.1:11434', 'a'.repeat(32));
    expect(dialog.getByLabelText('Purpose')).toBeDisabled();
    expect(dialog.getByLabelText('First answer timeout (seconds)')).toHaveAttribute('placeholder', '300');
    fireEvent.change(dialog.getByLabelText('First answer timeout (seconds)'), {target: {value: '420'}});
    fireEvent.change(dialog.getByLabelText('Name'), {target: {value: 'Workers coding'}});
    fireEvent.click(dialog.getByRole('button', {name: 'Add Assistant'}));
    await waitFor(() => expect(ai.addAssistant).toHaveBeenCalledTimes(1));
    expect(ai.addAssistant.mock.calls[0][0]).toMatchObject({provider: 'cloudflare', purpose: 'coding', accountId: 'a'.repeat(32), apiKey: 'test-token', firstResponseTimeoutMs: 420000});
    expect(ai.addAssistant.mock.calls[0][0]).not.toHaveProperty('baseUrl');
    expect(ai.addAssistant.mock.calls[0][0]).not.toHaveProperty('contextLength');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
