import React from 'react';
import {fireEvent, render, screen} from '@testing-library/react';
import Markdown from 'markdown-to-jsx';
import MarkdownRenderer from '../../../src/components/ai-chat/MarkdownRenderer.jsx';

jest.mock('markdown-to-jsx', () => {
    const Original = jest.requireActual('markdown-to-jsx').default;
    const React = jest.requireActual('react');
    return {__esModule: true, default: jest.fn(props => React.createElement(Original, props))};
});

const history = Array.from({length: 50}, (_, index) => ({
    id: index, text: `## Result ${index}\n\nCompleted message with **formatting** and [a link](https://example.com).`,
}));

function Conversation() {
    const [draft, setDraft] = React.useState('');
    const [response, setResponse] = React.useState('Streaming');
    return <>
        <input aria-label="Composer" value={draft} onChange={event => setDraft(event.target.value)}/>
        {history.map(item => <MarkdownRenderer key={item.id} role="assistant" text={item.text}/>)}
        <MarkdownRenderer role="assistant" text={response}/>
        <button onClick={() => setResponse(previous => previous + ' update')}>Stream</button>
    </>;
}

beforeEach(() => Markdown.mockClear());

test('composer edits and streamed tokens reuse completed Markdown messages', () => {
    render(<Conversation/>);
    const initial = Markdown.mock.calls.length;
    Markdown.mockClear();
    for (let i = 1; i <= 20; i++) fireEvent.change(screen.getByRole('textbox', {name: 'Composer'}), {target: {value: 'x'.repeat(i)}});
    const composerParses = Markdown.mock.calls.length;
    Markdown.mockClear();
    for (let i = 0; i < 20; i++) fireEvent.click(screen.getByRole('button', {name: 'Stream'}));
    const streamParses = Markdown.mock.calls.length;
    console.info('Markdown work:', JSON.stringify({initial, composerParses, streamParses}));
    expect(initial).toBe(51);
    expect(composerParses).toBe(0);
    expect(streamParses).toBe(20);
    expect(screen.getByRole('heading', {name: 'Result 0'})).toBeInTheDocument();
    expect(screen.getByText('Streaming' + ' update'.repeat(20))).toBeInTheDocument();
});

test('content, attachments, role and skeleton changes update the cached view', () => {
    const {container, rerender} = render(<MarkdownRenderer text="## Same heading" role="assistant"/>);
    const headingId = container.querySelector('h2').id;
    rerender(<MarkdownRenderer text="## Same heading" role="assistant"/>);
    expect(Markdown).toHaveBeenCalledTimes(1);
    rerender(<MarkdownRenderer text="## Same heading" role="assistant" attachments="Attachment text" skeleton/>);
    expect(container.textContent).toContain('Attachment text');
    expect(container.querySelector('.bp6-skeleton')).toBeInTheDocument();
    expect(container.querySelector('h2').id).toBe(headingId);
    rerender(<MarkdownRenderer text="Updated content" role="user"/>);
    expect(container.textContent).toBe('Updated content');
    expect(container.querySelector('.bp6-skeleton')).toBeNull();
    expect(container.querySelector('.markdown-body')).toBeNull();
});
