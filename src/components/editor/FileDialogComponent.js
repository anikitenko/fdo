import React, {useEffect, useState} from 'react';
import {Button, Callout, Checkbox, Classes, Dialog, DialogBody, DialogFooter, FormGroup, InputGroup} from '@blueprintjs/core';
import virtualFS from './utils/VirtualFS';
import {createVirtualFile} from './utils/createVirtualFile';
import {packageNewFileContent} from './utils/packageNewFileContent';
import {getFullPathOfFileFolder} from './utils/getFullPathOfFileFolder';
import {validateWorkspaceDestination} from './utils/workspaceFileOperations';
import * as styles from './EditorPage.module.css';

const types = [
    {name: 'TypeScript', ext: '.ts'}, {name: 'TypeScript JSX', ext: '.tsx'},
    {name: 'JavaScript', ext: '.js'}, {name: 'JavaScript JSX', ext: '.jsx'},
    {name: 'JavaScript module', ext: '.mjs'}, {name: 'JSON', ext: '.json'},
    {name: 'HTML', ext: '.html'}, {name: 'Stylesheet', ext: '.css'},
    {name: 'Markdown', ext: '.md'}, {name: 'Text', ext: '.txt'},
];
const copyName = node => node.type === 'folder' ? `${node.label}-copy` : node.label.replace(/(\.[^.]+)?$/, '-copy$1');

export default function FileDialogComponent() {
    const [dialog, setDialog] = useState(virtualFS.getFileDialog());
    const [name, setName] = useState('');
    const [extension, setExtension] = useState('');
    const [updateImports, setUpdateImports] = useState(true);
    const [error, setError] = useState('');
    const {node, action, type, filter} = dialog.data || {};
    const directory = type === 'folder' || node?.type === 'folder' && !!action;
    const title = action === 'delete' ? `Delete ${directory ? 'directory' : 'file'}` : action === 'rename' ? `Rename ${directory ? 'directory' : 'file'}` : action === 'move' ? 'Move' : action === 'duplicate' ? 'Duplicate' : directory ? 'New directory' : 'New file';
    const parent = node ? getFullPathOfFileFolder(node.id, node.type, !!action) : '/';
    const filename = extension && !name.endsWith(extension) ? name + extension : name;
    const destination = filename.startsWith('/') || filename.startsWith('\\') ? filename : parent + filename;
    const availableTypes = directory || action ? [] : types.filter(item => !filter || filter.includes('.*') || filter.includes(item.ext));
    useEffect(() => virtualFS.notifications.subscribe('fileDialog', setDialog), []);
    useEffect(() => {
        if (!dialog.show) return;
        setName(action === 'move' ? node.id : action === 'rename' ? node.label || node.id.split('/').pop() : action === 'duplicate' ? copyName(node) : '');
        setExtension('');setError('');setUpdateImports(true);
    }, [dialog]);
    const close = () => virtualFS.closeFileDialog();
    const submit = () => {
        try {
            if (action === 'delete') {virtualFS.checkpointFileOperation();virtualFS.deleteFile(node.id);close();return;}
            const target = validateWorkspaceDestination(destination);
            if (!name.trim()) {setError('Enter a name or path.');return;}
            if (target !== node?.id || !action) virtualFS.assertAvailablePath(target);
            if (action === 'rename' || action === 'move') virtualFS.rename(node, target, {updateImports});
            else if (action === 'duplicate') virtualFS.duplicate(node, target);
            else if (directory) {virtualFS.createFolder(target);virtualFS.revealPath(target);virtualFS.selectProjectPath(target);}
            else {createVirtualFile(target, packageNewFileContent(target));virtualFS.revealPath(target);virtualFS.setTreeObjectItemBool(target, 'isSelected');}
            close();
        } catch (error) {setError(error.message);}
    };
    return <Dialog isOpen={dialog.show} onClose={close} title={title} className={Classes.DARK} style={{width: 520, maxWidth: 'calc(100vw - 32px)'}}>
        <DialogBody>
            {action === 'delete' ? <p>Delete <strong>{node?.id}</strong>{directory ? ' and all its contents' : ''}? A snapshot is saved before deletion so you can restore it from the snapshot timeline.</p> : <FormGroup label={action === 'move' ? 'Destination path' : 'Name'} labelFor="workspace-file-name" helperText={action ? `Current path: ${node?.id}` : `In ${parent}`}>
                <InputGroup id="workspace-file-name" value={name} placeholder={action ? 'Location/New name' : 'Name'} autoFocus
                    onFocus={event => {if (action) event.target.select();}}
                    onChange={event => {setName(event.target.value);setError('');}}
                    onKeyDown={event => {if (event.key === 'Enter') {event.preventDefault();submit();}}}/>
            </FormGroup>}
            {availableTypes.length > 0 && <div className={styles.fileTypeChoices} role="group" aria-label="File type">
                {availableTypes.map(item => <Button key={item.ext} size="small" active={extension === item.ext} onClick={() => setExtension(extension === item.ext ? '' : item.ext)}>{item.name} ({item.ext})</Button>)}
            </div>}
            {name && action !== 'delete' && <p className={`${Classes.TEXT_MUTED} ${Classes.TEXT_SMALL} ${styles.fileDestination}`}>Path: <code>{destination.replace(/\/{2,}/g, '/')}</code></p>}
            {(action === 'rename' || action === 'move') && <Checkbox checked={updateImports} onChange={event => setUpdateImports(event.target.checked)} label="Update TypeScript and JavaScript imports"/>}
            {(action === 'rename' || action === 'move') && <p className={`${Classes.TEXT_MUTED} ${Classes.TEXT_SMALL}`}>Updates imports into and inside moved files, open tabs, and package entry paths. Existing files are never overwritten.</p>}
            {error && <Callout intent="danger" role="alert">{error}</Callout>}
        </DialogBody>
        <DialogFooter actions={<><Button onClick={close}>Cancel</Button><Button intent={action === 'delete' ? 'danger' : 'primary'} disabled={action !== 'delete' && !name.trim()} onClick={submit}>{action ? title : 'Create'}</Button></>}/>
    </Dialog>;
}
