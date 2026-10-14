import React from 'react';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import AiPendingFiles from '../../../src/components/editor/AiPendingFiles';
import {getPendingFiles, stagePendingFiles, startPendingFiles, updatePendingFiles} from '../../../src/components/editor/utils/aiPendingFiles';

beforeEach(() => updatePendingFiles({files: [], activePath: '', status: 'idle'}));
test('recovery keeps previous previews separate from new files, including the same path', () => {
    stagePendingFiles('### File: /logic.ts\n```ts\nexport const value = 1;\n```');
    render(<AiPendingFiles/>);
    act(() => startPendingFiles(true));
    expect(screen.getByText('Preparing a new plan. Previous files are for reference.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', {name: 'Preview previous /logic.ts'}));
    expect(screen.getByLabelText('Read-only source for /logic.ts')).toHaveTextContent('export const value = 1;');
    expect(screen.getByText(/not part of the current proposal/)).toBeVisible();
    act(() => stagePendingFiles('### File: /logic.ts\n```ts\nexport const value = 2;\n```'));
    expect(getPendingFiles().files).toEqual([{path: '/logic.ts', ready: true, content: 'export const value = 2;'}]);
    expect(screen.getByLabelText('Read-only source for /logic.ts')).toHaveTextContent('export const value = 1;');
    act(() => startPendingFiles(false));
    expect(getPendingFiles().previousFiles).toEqual([]);
    expect(screen.queryByRole('region', {name: 'AI pending files'})).toBeNull();
});
test('shows ready and generating files separately from applied workspace files', () => {
    render(<AiPendingFiles/>);
    expect(screen.queryByRole('region', {name: 'AI pending files'})).toBeNull();
    act(() => stagePendingFiles('### File: /logic.ts\n```ts\nexport {};\n```', '/render.tsx'));
    expect(screen.getByText(/AI files · 2/)).toBeTruthy();
    expect(screen.getByText('/logic.ts')).toBeTruthy();
    expect(screen.getByText(/Generating…/)).toBeTruthy();
    act(() => updatePendingFiles({activePath: '', status: 'stopped'}));
    expect(screen.getByText(/Not applied/)).toBeTruthy();
    act(() => updatePendingFiles({files: [], status: 'applied'}));
    expect(screen.queryByRole('region', {name: 'AI pending files'})).toBeNull();
});


test('collapses the file list while retaining its count and validation status', () => {
    stagePendingFiles('### File: /logic.ts\n```ts\nexport {};\n```');
    render(<AiPendingFiles/>);
    const toggle = screen.getByRole('button', {name: 'AI files · 1'});
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.getByText('Pending validation · not applied')).toBeVisible();
    fireEvent.click(toggle);
    expect(screen.getByRole('list')).toBeVisible();
});

test('supports keyboard resizing and resetting the panel height', () => {
    stagePendingFiles('### File: /logic.ts\n```ts\nexport {};\n```');
    render(<AiPendingFiles/>);
    const panel = screen.getByRole('region', {name: 'AI pending files'});
    panel.getBoundingClientRect = () => ({height: 180});
    const divider = screen.getByRole('separator', {name: 'Resize AI files'});
    fireEvent.keyDown(divider, {key: 'ArrowUp'});
    expect(panel.style.height).toBe('204px');
    fireEvent.keyDown(divider, {key: 'ArrowDown'});
    expect(panel.style.height).toBe('156px');
    fireEvent.doubleClick(divider);
    expect(panel.style.height).toBe('180px');
});

test('previews complete staged source as inert read-only text and updates after repair', () => {
    const source = '  <script>window.executed = true;</script>\n  export {};';
    stagePendingFiles('### File: /render.tsx\n```tsx\n' + source + '\n```', '/next.ts');
    render(<AiPendingFiles/>);
    expect(screen.queryByRole('button', {name: 'Preview /next.ts'})).toBeNull();
    fireEvent.click(screen.getByRole('button', {name: 'Preview /render.tsx'}));
    const preview = screen.getByLabelText('Read-only source for /render.tsx');
    expect(preview.textContent).toBe(source);
    expect(preview.querySelector('script')).toBeNull();
    expect(preview).not.toHaveAttribute('contenteditable');
    act(() => stagePendingFiles('### File: /render.tsx\n```tsx\nexport const fixed = true;\n```'));
    expect(preview.textContent).toBe('export const fixed = true;');
    act(() => updatePendingFiles({files: [], status: 'applied'}));
    expect(screen.queryByLabelText('Read-only source for /render.tsx')).toBeNull();
});

test('partial responses preserve earlier previews without exposing unfinished source', async () => {
    stagePendingFiles('### File: /logic.ts\n```ts\nexport const value = 1;\n```');
    stagePendingFiles('### File: /next.ts\n```ts\nunfinished', '/next.ts');
    render(<AiPendingFiles/>);
    expect(screen.queryByRole('button', {name: 'Preview /next.ts'})).toBeNull();
    fireEvent.click(screen.getByRole('button', {name: 'Preview /logic.ts'}));
    expect(screen.getByLabelText('Read-only source for /logic.ts').textContent).toBe('export const value = 1;');
    fireEvent.click(screen.getByRole('button', {name: 'Close'}));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
