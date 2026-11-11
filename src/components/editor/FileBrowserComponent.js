import React, {useEffect, useMemo, useState} from 'react';
import {Button, Classes, Dialog, DialogBody, InputGroup, Menu, MenuItem, Tree} from '@blueprintjs/core';
import virtualFS from './utils/VirtualFS';
import {isEditableWorkspacePath} from './utils/workspaceFileOperations';
import ContextMenu from './context_menu/CONTEXT_MENU';
import FindInFilesDialog from './FindInFilesDialog';
import * as styles from './EditorPage.module.css';

const walk = (nodes, visit) => nodes.forEach(node => {visit(node);if (node.childNodes) walk(node.childNodes, visit);});
const sourcePath = id => !/^\/(?:node_modules|dist)(?:\/|$)/.test(id);

export default function FileBrowserComponent() {
    const [tree, setTree] = useState(virtualFS.getTreeObjectSortedAsc());
    const [restoring, setRestoring] = useState(virtualFS.fs.getRestoreLoading());
    const [loading, setLoading] = useState(virtualFS.fs.getNodeModulesLoading());
    const [treeLoading, setTreeLoading] = useState(virtualFS.fs.getLoading());
    const [selected, setSelected] = useState('/');
    const [context, setContext] = useState(null);
    const [filter, setFilter] = useState('');
    const [findOpen, setFindOpen] = useState(false);
    const [quickOpen, setQuickOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [quickIndex, setQuickIndex] = useState(0);
    useEffect(() => {
        const subscriptions = [
            virtualFS.notifications.subscribe('treeUpdate', value => setTree([...value])),
            virtualFS.notifications.subscribe('restoreLoading', setRestoring),
            virtualFS.notifications.subscribe('nodeModulesLoading', setLoading),
            virtualFS.notifications.subscribe('treeLoading', setTreeLoading),
            virtualFS.notifications.subscribe('fileSelected', file => {if (file) setSelected(file.id);}),
            virtualFS.notifications.subscribe('tabSwitched', id => {if (id) setSelected(id);}),
            virtualFS.notifications.subscribe('projectSelection', setSelected),
        ];
        return () => subscriptions.forEach(dispose => dispose());
    }, []);
    useEffect(() => {
        if (!restoring) return;
        let frame;
        const sync = () => {if (!virtualFS.fs.getRestoreLoading()) setRestoring(false);else frame = requestAnimationFrame(sync);};
        frame = requestAnimationFrame(sync);
        return () => cancelAnimationFrame(frame);
    }, [restoring]);
    useEffect(() => {
        if (window.localStorage?.getItem('editor.restoreDebug') === 'true') window.dispatchEvent(new CustomEvent('editor-render-debug', {detail: {component: 'tree'}}));
    });
    useEffect(() => {
        const keydown = event => {
            if (restoring || !quickOpen && !findOpen && [...document.querySelectorAll('.bp6-dialog')].some(dialog => dialog.getClientRects().length > 0)) return;
            if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'f') {event.preventDefault();event.stopPropagation();setQuickOpen(false);setFindOpen(true);return;}
            if ((event.metaKey || event.ctrlKey) && (event.key.toLowerCase() === 'p' || event.shiftKey && event.key.toLowerCase() === 'n')) {
                event.preventDefault();event.stopPropagation();setFindOpen(false);setQuery('');setQuickIndex(0);setQuickOpen(true);
            }
        };
        document.addEventListener('keydown', keydown, true);
        return () => document.removeEventListener('keydown', keydown, true);
    }, [restoring, quickOpen, findOpen]);
    const node = virtualFS.getTreeObjectItemById(selected) || tree[0];
    const editable = node && isEditableWorkspacePath(node.id) && node.id !== '/package.json';
    const openDialog = data => !restoring && virtualFS.openFileDialog({node, ...data});
    const select = (item, open = false) => {
        setSelected(item.id);
        virtualFS.setTreeObjectItemSelectedSilent(item.id);
        if (open && item.type === 'file') {virtualFS.revealPath(item.id);virtualFS.setTreeObjectItemBool(item.id, 'isSelected');}
    };
    const expand = (item, expanded) => {
        virtualFS.updateTreeObjectItem(item.id, {isExpanded: expanded});
        virtualFS.restoreTreeObjectItemsIcon(virtualFS.treeObject);
    };
    const visibleTree = useMemo(() => {
        const query = filter.trim().toLowerCase();
        const prune = nodes => nodes.flatMap(item => {
            const childNodes = item.childNodes && prune(item.childNodes);
            if (query && item.id !== '/' && !item.id.toLowerCase().includes(query) && !childNodes?.length) return [];
            return [{...item, childNodes, ...(query ? {isExpanded: true} : {})}];
        });
        return prune(tree);
    }, [tree, filter]);
    const files = Object.keys(virtualFS.files).filter(sourcePath).filter(id => {
        const needle = query.trim().toLowerCase();
        return needle.split(/\s+/).every(word => id.toLowerCase().includes(word));
    }).sort((a, b) => a.localeCompare(b)).slice(0, 100);
    const openFile = file => {const item = virtualFS.getTreeObjectItemById(file);if (item) select(item, true);setQuickOpen(false);};
    return <div className={styles.projectExplorer}>
        <div className={styles.projectToolbar} role="toolbar" aria-label="Project actions">
            <Button size="small" variant="minimal" icon="document" title="New file" aria-label="New file" disabled={restoring} onClick={() => openDialog({})}/>
            <Button size="small" variant="minimal" icon="folder-new" title="New directory" aria-label="New directory" disabled={restoring} onClick={() => openDialog({type: 'folder'})}/>
            <Button size="small" variant="minimal" icon="edit" title="Rename (Shift F6 / F2)" aria-label="Rename selected" disabled={!editable || restoring} onClick={() => openDialog({action: 'rename'})}/>
            <Button size="small" variant="minimal" icon="search" title="Find in files (⌘/Ctrl Shift F)" aria-label="Find in files" disabled={restoring} onClick={() => setFindOpen(true)}/>
            <Button size="small" variant="minimal" icon="collapse-all" title="Collapse all" aria-label="Collapse all" onClick={() => {walk(virtualFS.treeObject, item => {item.isExpanded = item.id === '/';});virtualFS.notifications.addToQueue('treeUpdate', virtualFS.getTreeObjectSortedAsc());}}/>
        </div>
        <InputGroup size="small" leftIcon="filter" aria-label="Filter project files" placeholder="Filter files…" value={filter} onChange={event => setFilter(event.target.value)}/>
        {(restoring || loading || treeLoading) && <div className={styles.editorSubtleStatus} role="status">{restoring ? 'Restoring project tree…' : treeLoading ? 'Refreshing project tree…' : 'Loading dependencies and types…'}</div>}
        <div tabIndex={0} aria-label="Project file tree" onKeyDown={event => {
            if (restoring || event.target.tagName === 'INPUT') return;
            const key = event.key;
            if (key === 'F2' || key === 'F6' && event.shiftKey) {event.preventDefault();if (editable) openDialog({action: 'rename'});}
            else if (key === 'Delete') {event.preventDefault();if (editable) openDialog({action: 'delete'});}
            else if ((event.metaKey || event.ctrlKey) && key.toLowerCase() === 'n') {event.preventDefault();openDialog(event.altKey ? {type: 'folder'} : {});}
            else if (key === 'Enter' && node) {event.preventDefault();if (node.type === 'file') select(node, true);else expand(node, !node.isExpanded);}
            else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) {
                event.preventDefault();
                const visible = [];const flatten = nodes => nodes.forEach(item => {visible.push(item);if (item.isExpanded && item.childNodes) flatten(item.childNodes);});flatten(visibleTree);
                const index = visible.findIndex(item => item.id === node?.id);
                if (key === 'ArrowRight' && node?.type === 'folder') expand(node, true);
                else if (key === 'ArrowLeft' && node?.isExpanded) expand(node, false);
                else if (key === 'ArrowLeft') {const parent = virtualFS.getTreeObjectItemById(node.id.slice(0, node.id.lastIndexOf('/')) || '/');if (parent) select(parent);}
                else if (key === 'ArrowUp' || key === 'ArrowDown') {const next = visible[Math.max(0, Math.min(visible.length - 1, index + (key === 'ArrowDown' ? 1 : -1)))];if (next) select(next);}
            }
        }}>
            <Tree contents={visibleTree} className={styles['file-tree']}
                onNodeClick={item => {if (restoring) return;select(item, item.type === 'file');if (item.type === 'folder') expand(item, !item.isExpanded);}}
                onNodeExpand={item => !restoring && expand(item, true)} onNodeCollapse={item => !restoring && expand(item, false)}
                onNodeContextMenu={(item, path, event) => {if (restoring) return;event.preventDefault();select(item);setContext({node: item, offset: {left: event.clientX, top: event.clientY}});}}/>
        </div>
        {filter && visibleTree[0]?.childNodes?.length === 0 && <p className={`${Classes.TEXT_MUTED} ${Classes.TEXT_SMALL}`}>No files match “{filter}”.</p>}
        <FindInFilesDialog isOpen={findOpen} onClose={() => setFindOpen(false)} onResult={match => {
            openFile(match.filePath);
            virtualFS.notifications.addToQueue('revealLocation', {id: match.filePath, options: {selection: {
                startLineNumber: match.line, endLineNumber: match.line, startColumn: match.column, endColumn: match.column + match.length,
            }}});
        }}/>
        <ContextMenu contextElement={context?.node} offset={context?.offset} onClose={() => setContext(null)}/>
        <Dialog isOpen={quickOpen} onClose={() => setQuickOpen(false)} title="Go to file" className={Classes.DARK} style={{width: 640, maxWidth: 'calc(100vw - 32px)'}}>
            <DialogBody>
                <InputGroup autoFocus aria-label="Search project files" placeholder="Type a file name or path…" value={query}
                    onChange={event => {setQuery(event.target.value);setQuickIndex(0);}}
                    onKeyDown={event => {
                        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {event.preventDefault();setQuickIndex(index => Math.max(0, Math.min(files.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))));}
                        if (event.key === 'Enter' && files[quickIndex]) {event.preventDefault();openFile(files[quickIndex]);}
                    }}/>
                <Menu role="listbox" aria-label="Matching project files" className={styles.quickFileResults}>
                    {files.map((file, index) => <MenuItem key={file} roleStructure="listoption" active={index === quickIndex} selected={index === quickIndex}
                        text={file.split('/').pop()} label={file} icon="document" onClick={() => openFile(file)}/>)}
                </Menu>
                {!files.length && <p role="status">No matching files.</p>}
            </DialogBody>
        </Dialog>
    </div>;
}
