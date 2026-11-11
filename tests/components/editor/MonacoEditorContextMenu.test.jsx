import React from 'react';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import virtualFS from '../../../src/components/editor/utils/VirtualFS';
import MonacoEditorContextMenu from '../../../src/components/editor/MonacoEditorContextMenu';
import ContextMenu from '../../../src/components/editor/context_menu/CONTEXT_MENU';

afterEach(() => jest.restoreAllMocks());

jest.mock('@blueprintjs/core', () => {
    const React = require('react');
    return {
        ContextMenuPopover: ({content}) => <div>{content}</div>,
        Menu: ({children, ...props}) => <div {...props}>{children}</div>,
        MenuDivider: ({title}) => title ? <div>{title}</div> : <hr/>,
        MenuItem: ({text, label, labelElement, onClick, disabled, 'aria-label': ariaLabel}) => (
            <button type="button" aria-label={ariaLabel} disabled={disabled} onClick={onClick}>
                {text}{label && <span>{label}</span>}{labelElement}
            </button>
        ),
    };
});

test('Monaco context menu opens file operations in the active file directory', () => {
    const node = {id: '/src/index.ts', type: 'file', label: 'index.ts'};
    const openFileDialog = jest.spyOn(virtualFS, 'openFileDialog').mockImplementation(() => {});
    jest.spyOn(virtualFS, 'getTreeObjectItemById').mockImplementation(id => id === node.id ? node : null);
    const domNode = document.createElement('div');
    const editor = {
        getDomNode: () => domNode,
        getModel: () => ({uri: {path: node.id}}),
        getAction: () => null,
    };
    render(<MonacoEditorContextMenu editor={editor}/>);

    fireEvent.contextMenu(domNode, {clientX: 48, clientY: 72});
    fireEvent.click(screen.getByRole('button', {name: 'New file'}));
    expect(openFileDialog).toHaveBeenLastCalledWith({node});

    fireEvent.contextMenu(domNode, {clientX: 48, clientY: 72});
    fireEvent.click(screen.getByRole('button', {name: /^New folder/}));
    expect(openFileDialog).toHaveBeenLastCalledWith({node, type: 'folder'});
});

test('Monaco context menu runs editor commands with the editor focused', async () => {
    const node = {id: '/src/index.ts', type: 'file', label: 'index.ts'};
    jest.spyOn(virtualFS, 'getTreeObjectItemById').mockImplementation(id => id === node.id ? node : null);
    const focus = jest.fn();
    const trigger = jest.fn();
    const domNode = document.createElement('div');
    const editor = {
        getDomNode: () => domNode,
        getModel: () => ({uri: {path: node.id}}),
        focus,
        trigger,
        getAction: id => id === 'editor.action.clipboardCopyAction' ? {run: jest.fn()} : null,
    };
    render(<MonacoEditorContextMenu editor={editor}/>);

    fireEvent.contextMenu(domNode, {clientX: 48, clientY: 72});
    expect(screen.getByText('Edit')).toBeInTheDocument();
    expect(screen.getByText('Code')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: /^Undo/})).toBeInTheDocument();
    expect(screen.getByRole('button', {name: /^Find\s/})).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name: /^Copy(?:Ctrl\+C|⌘ C)$/}));
    await waitFor(() => expect(trigger).toHaveBeenCalledWith('contextmenu', 'editor.action.clipboardCopyAction', null));
    fireEvent.contextMenu(domNode, {clientX: 48, clientY: 72});
    fireEvent.click(screen.getByRole('button', {name: /^Undo/}));
    await waitFor(() => expect(trigger).toHaveBeenCalledWith('contextmenu', 'undo', null));
    expect(focus).toHaveBeenCalledTimes(2);
});

test('file-browser context menu omits editor-only Edit and Code sections', () => {
    render(<ContextMenu contextElement={{id: '/src/index.ts', type: 'file'}} offset={{left: 10, top: 10}}/>);

    expect(screen.getByText('Project')).toBeInTheDocument();
    expect(screen.queryByText('Edit')).not.toBeInTheDocument();
    expect(screen.queryByText('Code')).not.toBeInTheDocument();
});

test.each([
    ['MacIntel', '⌘ Z', '⌘ ⌥ N', '⌘ ⇧ Z'],
    ['Win32', 'Ctrl+Z', 'Ctrl+Alt+N', 'Ctrl+Y'],
    ['Linux x86_64', 'Ctrl+Z', 'Ctrl+Alt+N', 'Ctrl+Shift+Z'],
])('shows shortcuts for the current OS (%s)', (platform, undoShortcut, newFolderShortcut, redoShortcut) => {
    const originalPlatform = Object.getOwnPropertyDescriptor(navigator, 'platform');
    Object.defineProperty(navigator, 'platform', {configurable: true, value: platform});
    try {
        render(<ContextMenu
            contextElement={{id: '/src/index.ts', type: 'file'}}
            offset={{left: 10, top: 10}}
            editor={{getAction: id => id === 'editor.action.rename' ? {isSupported: () => true} : null}}
        />);

        expect(screen.getByRole('button', {name: /^New folder/})).toHaveTextContent(newFolderShortcut);
        expect(screen.getByRole('button', {name: /^Undo/})).toHaveTextContent(undoShortcut);
        expect(screen.getByRole('button', {name: /^Redo/})).toHaveTextContent(redoShortcut);
    } finally {
        if (originalPlatform) Object.defineProperty(navigator, 'platform', originalPlatform);
        else delete navigator.platform;
    }
});

test('distinguishes project rename from symbol rename shortcuts', () => {
    render(<ContextMenu
        contextElement={{id: '/src/index.ts', type: 'file'}}
        offset={{left: 10, top: 10}}
        editor={{getAction: id => id === 'editor.action.rename' ? {isSupported: () => true} : null}}
    />);

    expect(screen.getByRole('button', {name: /^Rename…/})).toHaveTextContent('Shift+F6');
    expect(screen.getByRole('button', {name: /^Rename symbol/})).toHaveTextContent('F2');
});

test('Monaco context menu uses Monaco context-menu events and can reopen after dismissal', () => {
    const node = {id: '/src/index.ts', type: 'file', label: 'index.ts'};
    jest.spyOn(virtualFS, 'getTreeObjectItemById').mockImplementation(id => id === node.id ? node : null);
    jest.spyOn(virtualFS, 'openFileDialog').mockImplementation(() => {});
    let handleContextMenu;
    const editor = {
        onContextMenu: handler => {
            handleContextMenu = handler;
            return {dispose: jest.fn()};
        },
        getModel: () => ({uri: {path: node.id}}),
        getAction: () => null,
    };
    render(<MonacoEditorContextMenu editor={editor}/>);
    const trigger = () => handleContextMenu({
        event: {browserEvent: {clientX: 48, clientY: 72, preventDefault: jest.fn(), stopPropagation: jest.fn()}},
    });

    act(trigger);
    expect(screen.getByRole('button', {name: 'New file'})).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name: 'New file'}));
    expect(screen.queryByRole('button', {name: 'New file'})).not.toBeInTheDocument();
    act(trigger);
    expect(screen.getByRole('button', {name: /^New folder/})).toBeInTheDocument();
});

test('Command Palette invokes Monaco quick access after closing the context menu', async () => {
    const node = {id: '/src/index.ts', type: 'file', label: 'index.ts'};
    jest.spyOn(virtualFS, 'getTreeObjectItemById').mockImplementation(id => id === node.id ? node : null);
    const domNode = document.createElement('div');
    const trigger = jest.fn();
    const editor = {
        getDomNode: () => domNode,
        getModel: () => ({uri: {path: node.id}}),
        focus: jest.fn(),
        trigger,
        getAction: () => null,
    };
    render(<MonacoEditorContextMenu editor={editor}/>);

    fireEvent.contextMenu(domNode, {clientX: 48, clientY: 72});
    fireEvent.click(screen.getByRole('button', {name: /^Command Palette/}));
    await waitFor(() => expect(trigger).toHaveBeenCalledWith('contextmenu', 'editor.action.quickCommand', null));
});
