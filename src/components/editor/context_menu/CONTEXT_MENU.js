import React from 'react';
import {ContextMenuPopover, Menu, MenuDivider, MenuItem} from '@blueprintjs/core';
import virtualFS from '../utils/VirtualFS';
import {isEditableWorkspacePath} from '../utils/workspaceFileOperations';
import * as styles from './contextMenu.module.css';

const getPlatform = () => typeof navigator === 'undefined' ? '' : navigator.platform || '';
const isMacOS = platform => /Mac|iPhone|iPad|iPod/i.test(platform);

const editActions = [
    {id: 'undo', text: 'Undo', icon: 'undo', shortcut: mac => mac ? '⌘ Z' : 'Ctrl+Z', direct: true},
    {id: 'redo', text: 'Redo', icon: 'redo', shortcut: (mac, windows) => mac ? '⌘ ⇧ Z' : windows ? 'Ctrl+Y' : 'Ctrl+Shift+Z', direct: true},
    {id: 'editor.action.clipboardCutAction', text: 'Cut', icon: 'cut', shortcut: mac => mac ? '⌘ X' : 'Ctrl+X', direct: true},
    {id: 'editor.action.clipboardCopyAction', text: 'Copy', icon: 'duplicate', shortcut: mac => mac ? '⌘ C' : 'Ctrl+C', direct: true},
    {id: 'editor.action.clipboardPasteAction', text: 'Paste', icon: 'clipboard', shortcut: mac => mac ? '⌘ V' : 'Ctrl+V', direct: true},
    {id: 'editor.action.selectAll', text: 'Select all', shortcut: mac => mac ? '⌘ A' : 'Ctrl+A', direct: true},
    {id: 'actions.find', text: 'Find', icon: 'search', shortcut: mac => mac ? '⌘ F' : 'Ctrl+F', direct: true},
    {id: 'editor.action.startFindReplaceAction', text: 'Find and replace', icon: 'search-around', shortcut: mac => mac ? '⌘ ⌥ F' : 'Ctrl+H', direct: true},
];
const codeActions = [
    {id: 'editor.action.formatDocument', text: 'Format document', icon: 'code', shortcut: mac => mac ? '⇧ ⌥ F' : 'Shift+Alt+F'},
    {id: 'editor.action.quickFix', text: 'Quick fix', icon: 'wrench', shortcut: mac => mac ? '⌘ .' : 'Ctrl+.'},
    {id: 'editor.action.rename', text: 'Rename symbol', icon: 'edit', shortcut: () => 'F2'},
    {id: 'editor.action.revealDefinition', text: 'Go to definition', icon: 'arrow-right', shortcut: () => 'F12'},
    {id: 'editor.action.quickCommand', text: 'Command Palette…', icon: 'command', shortcut: () => 'F1', direct: true},
];

const runEditorAction = (editor, item) => {
    window.setTimeout(() => {
        editor?.focus?.();
        if (typeof editor?.trigger === 'function') {
            editor.trigger('contextmenu', item.id, null);
            return;
        }
        void item.action?.run?.();
    }, 0);
};

export default function ContextMenu({contextElement, offset, onClose, editor}) {
    if (!contextElement || !offset) return null;
    const editable = isEditableWorkspacePath(contextElement.id);
    const protectedEntry = !editable || contextElement.id === '/package.json';
    const creatable = contextElement.id === '/' || editable;
    const platform = getPlatform();
    const macOS = isMacOS(platform);
    const windows = /Win/i.test(platform);
    const platformShortcut = shortcut => shortcut(macOS, windows);
    const open = data => {onClose?.();virtualFS.openFileDialog({node: contextElement, ...data});};
    const resolveActions = items => items.flatMap(item => {
        const action = editor?.getAction?.(item.id);
        return action || item.direct
            ? [{...item, action, shortcut: platformShortcut(item.shortcut), disabled: action?.isSupported?.() === false}]
            : [];
    });
    const resolvedEditActions = editor ? resolveActions(editActions) : [];
    const resolvedCodeActions = editor ? resolveActions(codeActions) : [];
    const runAction = item => {onClose?.();runEditorAction(editor, item);};
    return <ContextMenuPopover isOpen isDarkTheme targetOffset={offset} onClose={onClose}
        popoverClassName={styles.popover}
        content={<Menu className={styles.menu} role="menu" aria-label="Editor and project actions">
            <MenuDivider title="Project"/>
            <MenuItem icon="document" text="New file" label={macOS ? '⌘ N' : 'Ctrl+N'} aria-label="New file" disabled={!creatable} onClick={() => open({})}/>
            <MenuItem icon="folder-new" text="New folder" label={macOS ? '⌘ ⌥ N' : 'Ctrl+Alt+N'} disabled={!creatable} onClick={() => open({type: 'folder'})}/>
            <MenuDivider/>
            <MenuItem icon="edit" text="Rename…" label="Shift+F6" disabled={protectedEntry} onClick={() => open({action: 'rename'})}/>
            <MenuItem icon="move" text="Move…" disabled={protectedEntry} onClick={() => open({action: 'move'})}/>
            <MenuItem icon="duplicate" text="Duplicate…" disabled={!editable} onClick={() => open({action: 'duplicate'})}/>
            <MenuItem icon="clipboard" text="Copy path" labelElement={<span className={styles.path} title={contextElement.id}>{contextElement.id}</span>}
                onClick={() => {void navigator.clipboard.writeText(contextElement.id);onClose?.();}}/>
            <MenuDivider/>
            <MenuItem icon="trash" text="Delete…" intent="danger" disabled={protectedEntry} onClick={() => open({action: 'delete'})}/>
            {editor && <>
                <MenuDivider title="Edit"/>
                {resolvedEditActions.map(item => <MenuItem key={item.id} icon={item.icon} text={item.text} label={item.shortcut}
                    disabled={item.disabled} onClick={() => runAction(item)}/>)}
                {resolvedCodeActions.length > 0 && <>
                    <MenuDivider title="Code"/>
                    {resolvedCodeActions.map(item => <MenuItem key={item.id} icon={item.icon} text={item.text} label={item.shortcut}
                        disabled={item.disabled} onClick={() => runAction(item)}/>)}
                </>}
            </>}
        </Menu>}/>;
}
