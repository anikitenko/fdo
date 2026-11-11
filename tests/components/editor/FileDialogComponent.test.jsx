import React from 'react';
import {act, fireEvent, render, screen} from '@testing-library/react';
import monaco from 'monaco-editor';
import FileDialogComponent from '../../../src/components/editor/FileDialogComponent';
import virtualFS from '../../../src/components/editor/utils/VirtualFS';

beforeEach(() => {
    jest.useFakeTimers();
    virtualFS.resetWorkspaceState();
    virtualFS.notifications.reset();
});
afterEach(() => {
    virtualFS.resetWorkspaceState();
    jest.clearAllTimers();
    jest.useRealTimers();
});

test('creating a nested helper from the root uses the same path for tree, Monaco and build input', () => {
    virtualFS.openFileDialog({node: {id: '/', type: 'folder'}});
    render(<FileDialogComponent />);
    act(() => jest.advanceTimersByTime(200));
    const input = screen.getByPlaceholderText('Name');
    fireEvent.change(input, {target: {value: 'shared/website-check-ui.ts'}});
    fireEvent.keyDown(input, {key: 'Enter'});

    const filePath = '/shared/website-check-ui.ts';
    expect(virtualFS.getTreeObjectItemById(filePath)?.type).toBe('file');
    expect(Object.keys(virtualFS.getLatestContent())).toEqual([filePath]);
    expect(monaco.editor.getModel(monaco.Uri.file(filePath))?.getLanguageId()).toBe('typescript');
    expect(virtualFS.getFileContent(filePath)).toContain('website-check-ui.ts');
});

test('an existing source cannot be overwritten through the new-file dialog', () => {
    const model = monaco.editor.createModel('keep this source', 'typescript', monaco.Uri.file('/keep.ts'));
    virtualFS.createFile('/keep.ts', model);
    virtualFS.openFileDialog({});render(<FileDialogComponent />);
    fireEvent.change(screen.getByPlaceholderText('Name'), {target: {value: 'keep.ts'}});
    fireEvent.click(screen.getByRole('button', {name: 'Create', exact: true}));
    expect(screen.getByRole('alert')).toHaveTextContent('already exists');
    expect(virtualFS.getFileContent('/keep.ts')).toBe('keep this source');
});

test('choosing an extension does not append it twice, and directory creation keeps its type', () => {
    virtualFS.openFileDialog({});
    const {unmount} = render(<FileDialogComponent />);
    fireEvent.click(screen.getByRole('button', {name: 'TypeScript (.ts)', exact: true}));
    fireEvent.change(screen.getByPlaceholderText('Name'), {target: {value: 'typed.ts'}});
    fireEvent.click(screen.getByRole('button', {name: 'Create', exact: true}));
    expect(virtualFS.files['/typed.ts']).toBeDefined();
    expect(virtualFS.files['/typed.ts.ts']).toBeUndefined();
    unmount();
    virtualFS.openFileDialog({type: 'folder'});render(<FileDialogComponent />);
    fireEvent.change(screen.getByPlaceholderText('Name'), {target: {value: 'shared/empty'}});
    fireEvent.click(screen.getByRole('button', {name: 'Create', exact: true}));
    expect(virtualFS.getTreeObjectItemById('/shared/empty')?.type).toBe('folder');
    expect(virtualFS.files['/shared/empty']).toBeUndefined();
});
