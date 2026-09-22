import React from 'react';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import AiUsagePopover, {MessageUsage} from '../../src/components/ai-chat/AiUsagePopover';

const unknown = {requests: 1, retainedLimit: 5000, entries: [], groups: [{provider: 'gemini', model: 'custom-model', requests: 1, pending: 0, unknown: 1, external: 0, priced: 0, knownCost: 0}]};
beforeEach(() => {
    window.electron = {aiUsage: {get: jest.fn().mockResolvedValue(unknown), subscribe: jest.fn(() => jest.fn()),
        rates: jest.fn().mockResolvedValue({catalog: {}, overrides: {}}), saveRate: jest.fn().mockResolvedValue(true)}};
});

test('chat tooltip uses token counts, tolerates missing costs and preserves explicit zero', () => {
    const {rerender} = render(<MessageUsage t={key => key} inputTokens={1500} outputTokens={25} totalTokens={1525} />);
    expect(screen.getByText('inputTokens: 1,500')).toBeInTheDocument();
    expect(screen.getByText('outputTokens: 25')).toBeInTheDocument();
    expect(screen.getByText('totalCost: Unknown')).toBeInTheDocument();
    rerender(<MessageUsage t={key => key} inputTokens={0} outputTokens={0} totalTokens={0} totalCost={0} local />);
    expect(screen.getByText('totalCost: $0.00000')).toBeInTheDocument();
});
test('the chat popover filters by session and never displays zero for all-unknown costs', async () => {
    const {unmount} = render(<AiUsagePopover surface="chat" sessionId="session-1" />);
    fireEvent.click(screen.getByRole('button', {name: 'Usage and cost'}));
    expect(await screen.findByText('Known subtotal: Unknown')).toBeInTheDocument();
    expect(screen.queryByText('$0.00000')).not.toBeInTheDocument();
    expect(window.electron.aiUsage.get).toHaveBeenCalledWith({surface: 'chat', sessionId: 'session-1'});
    const unsubscribe = window.electron.aiUsage.subscribe.mock.results[0].value;
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
});
test('rates are edited for one exact provider/model and empty optional categories stay unknown', async () => {
    render(<AiUsagePopover surface="coding" />);
    fireEvent.click(screen.getByRole('button', {name: 'Usage and cost'}));
    fireEvent.click(await screen.findByRole('button', {name: 'Edit rates'}));
    fireEvent.change(await screen.findByLabelText('Input'), {target: {value: '1.5'}});
    fireEvent.change(screen.getByLabelText('Output'), {target: {value: '6'}});
    fireEvent.click(screen.getByRole('button', {name: 'Save rates'}));
    await waitFor(() => expect(window.electron.aiUsage.saveRate).toHaveBeenCalledWith({provider: 'gemini', model: 'custom-model', rate: {input: 1.5, output: 6}}));
});
test('a failed refresh is visible rather than showing a fabricated total', async () => {
    window.electron.aiUsage.get.mockRejectedValue(new Error('offline'));
    render(<AiUsagePopover surface="coding" />);
    fireEvent.click(screen.getByRole('button', {name: 'Usage and cost'}));
    expect(await screen.findByText('Usage could not be loaded.')).toBeInTheDocument();
    expect(screen.queryByText(/Estimated total/)).not.toBeInTheDocument();
});

test('chat turn tooltip labels partial totals without hiding unpriced requests', () => {
    render(<MessageUsage t={key => key} usageScope="turn" usageRequests={3} knownCost={.006} costStatus="partial" />);
    expect(screen.getByText('totalCost: Unknown')).toBeInTheDocument();
    expect(screen.getByText('Known subtotal: $0.00600 + unknown')).toBeInTheDocument();
    expect(screen.getByText('This turn: 3 request(s), including routing and follow-ups.')).toBeInTheDocument();
});
