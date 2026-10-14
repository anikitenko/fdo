import React, {useState} from 'react';
import {act, fireEvent, render, screen, within, waitFor} from '@testing-library/react';
import {Dialog} from '@blueprintjs/core';
import AiAssistantWindow from '../../../src/components/editor/AiAssistantWindow';
let popup;
function Panel({eventDocument}) {
    const [draft, setDraft] = useState('Keep my draft');
    const [review, setReview] = useState(false);
    return <div><input aria-label="Draft" value={draft} onChange={event => setDraft(event.target.value)}/>
        <button onClick={() => setReview(true)}>Review guide</button>
        <span>{eventDocument === document ? 'Docked' : 'Detached'}</span>
        <Dialog isOpen={review} title="Guide approval" onClose={() => setReview(false)}>Approve this guide</Dialog></div>;
}
beforeEach(() => {
    window.electron.system.focusEditorWindow = jest.fn().mockResolvedValue({success: true});
    const doc = document.implementation.createHTMLDocument('Assistant');
    Object.defineProperty(doc, 'defaultView', {value: window});
    const handlers = {};
    popup = {document: doc, closed: false, focus: jest.fn(),
        addEventListener: jest.fn((name, handler) => {handlers[name] = handler;}),
        removeEventListener: jest.fn(name => {delete handlers[name];}),
        close: jest.fn(() => {popup.closed = true; handlers.beforeunload?.();}),
        nativeClose: () => {handlers.beforeunload?.(); popup.closed = true;}};
    jest.spyOn(window, 'open').mockReturnValue(popup);
    jest.spyOn(window, 'focus').mockImplementation(() => {});
});
test('Show IDE uses the native focus bridge and reports failure in the companion', async () => {
    render(layout(true));
    fireEvent.click(screen.getByRole('button', {name: 'Open assistant window'}));
    const floating = within(popup.document.body);
    fireEvent.click(floating.getByRole('button', {name: 'Show IDE'}));
    await waitFor(() => expect(window.electron.system.focusEditorWindow).toHaveBeenCalledTimes(1));
    window.electron.system.focusEditorWindow.mockResolvedValueOnce({success: false, error: 'The IDE window is no longer available.'});
    fireEvent.click(floating.getByRole('button', {name: 'Show IDE'}));
    expect(await floating.findByText('The IDE window is no longer available.')).toBeVisible();
});
afterEach(() => {jest.restoreAllMocks();});
const layout = visible => <AiAssistantWindow visible={visible}>{props => <Panel {...props}/>}</AiAssistantWindow>;
test('the floating assistant retains its mounted draft and routes dialogs into its own document', async () => {
    const {rerender} = render(layout(true));
    const input = screen.getByLabelText('Draft');
    fireEvent.change(input, {target: {value: 'Current request'}});
    fireEvent.click(screen.getByRole('button', {name: 'Open assistant window'}));
    expect(window.open).toHaveBeenCalledWith('about:blank', 'fdo-ai-assistant', expect.any(String));
    const floating = within(popup.document.body);
    expect(floating.getByLabelText('Draft')).toBe(input);
    expect(input).toHaveValue('Current request');
    fireEvent.click(floating.getByRole('button', {name: 'Review guide'}));
    expect(await floating.findByRole('dialog', {name: 'Guide approval'})).toHaveTextContent('Approve this guide');
    expect(screen.queryByRole('dialog', {name: 'Guide approval'})).toBeNull();
    rerender(layout(false));
    expect(floating.getByLabelText('Draft')).toBe(input);
    fireEvent.click(floating.getByRole('button', {name: 'Return to editor'}));
    expect(screen.getByLabelText('Draft', {selector: 'input'})).toBe(input);
    expect(input).toHaveValue('Current request');
    expect(await screen.findByRole('dialog', {name: 'Guide approval'})).toBeTruthy();
});
test('closing the native window redocks without losing the request draft', () => {
    render(layout(true));
    fireEvent.click(screen.getByRole('button', {name: 'Open assistant window'}));
    act(() => popup.nativeClose());
    expect(screen.getByLabelText('Draft')).toHaveValue('Keep my draft');
    expect(screen.getByRole('button', {name: 'Open assistant window'})).toBeTruthy();
});
test('a blocked popup leaves the assistant usable in its original tab', () => {
    window.open.mockReturnValue(null);
    render(layout(true));
    fireEvent.click(screen.getByRole('button', {name: 'Open assistant window'}));
    expect(screen.getByText(/could not open/)).toBeVisible();
    expect(screen.getByLabelText('Draft')).toHaveValue('Keep my draft');
});
test('unmount closes the floating window and does not keep polling', () => {
    jest.useFakeTimers();
    const {unmount} = render(layout(true));
    fireEvent.click(screen.getByRole('button', {name: 'Open assistant window'}));
    unmount();
    expect(popup.close).toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
    jest.useRealTimers();
});
