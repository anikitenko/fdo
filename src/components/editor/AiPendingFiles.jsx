import React, {useEffect, useId, useRef, useState, useSyncExternalStore} from 'react';
import {getPendingFiles, subscribePendingFiles} from './utils/aiPendingFiles';
import {Dialog, DialogBody} from '@blueprintjs/core';
import * as styles from './AiPendingFiles.module.css';

export default function AiPendingFiles() {
    const {files, previousFiles, activePath, status} = useSyncExternalStore(subscribePendingFiles, getPendingFiles);
    const [previewPath, setPreviewPath] = useState(null);
    const previewIsPrevious = previewPath?.previous;
    const preview = (previewIsPrevious ? previousFiles : files).find(file => file.path === previewPath?.path && typeof file.content === 'string');
    useEffect(() => { if (!preview) setPreviewPath(null); }, [preview]);
    const [collapsed, setCollapsed] = useState(false);
    const [height, setHeight] = useState(180);
    const panel = useRef(null);
    const drag = useRef(null);
    const listId = useId();
    const resize = value => {
        const available = panel.current?.parentElement?.clientHeight || 600;
        setHeight(Math.max(96, Math.min(value, available * 0.6)));
    };
    if (!files.length && !previousFiles.length) return null;
    const fileRows = (items, previous = false) => items.map(file => <li key={file.path} title={file.path} className={styles.fileRow}>
        <span className={styles.fileIcon} aria-hidden="true">{file.ready ? '✓' : '○'}</span>
        <span className={styles.fileName}>{file.path}</span>
        {typeof file.content === 'string' && <button type="button" className={styles.previewButton}
            aria-label={`Preview ${previous ? 'previous ' : ''}${file.path}`} title="Preview generated source (read-only)"
            onClick={() => setPreviewPath({path: file.path, previous})}>Preview</button>}
        {!previous && status === 'generating' && file.path === activePath && <span className={styles.generating}>Generating…</span>}
    </li>);
    return <section ref={panel} aria-label="AI pending files" className={styles.panel}
                    style={{height: collapsed ? 'auto' : height, maxHeight: collapsed ? 'none' : '60%'}}>
        {!collapsed && <div className={styles.resizeHandle} role="separator" tabIndex={0}
            aria-label="Resize AI files" aria-orientation="horizontal" aria-valuemin={96} aria-valuenow={height}
            title="Drag to resize · Arrow keys to adjust · Double-click to reset"
            onPointerDown={event => {
                if (event.button !== 0) return;
                drag.current = {y: event.clientY, height: panel.current.getBoundingClientRect().height};
                event.currentTarget.setPointerCapture(event.pointerId);
                event.preventDefault();
            }}
            onPointerMove={event => {
                if (drag.current) resize(drag.current.height + drag.current.y - event.clientY);
            }}
            onPointerUp={() => { drag.current = null; }}
            onPointerCancel={() => { drag.current = null; }}
            onLostPointerCapture={() => { drag.current = null; }}
            onDoubleClick={() => setHeight(180)}
            onKeyDown={event => {
                if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                    event.preventDefault();
                    resize(panel.current.getBoundingClientRect().height + (event.key === 'ArrowUp' ? 24 : -24));
                }
            }}/>}
        <button type="button" className={styles.heading} aria-expanded={!collapsed} aria-controls={listId}
                onClick={() => setCollapsed(value => !value)}>
            <span aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
            <strong>AI files · {files.length}{previousFiles.length ? ` · ${previousFiles.length} previous` : ''}</strong>
        </button>
        <p className={styles.status}>{status === 'applied' ? 'Applied to workspace' : status === 'stopped' ? 'Not applied · request ended' : 'Pending validation · not applied'}</p>
        <ul id={listId} hidden={collapsed} className={styles.files}>
            {fileRows(files)}
            {!!previousFiles.length && <li><details open={!files.length}>
                <summary>Previous attempt · not applied</summary>
                {!files.length && status === 'generating' && <p className={styles.status}>Preparing a new plan. Previous files are for reference.</p>}
                <ul className={styles.files}>{fileRows(previousFiles, true)}</ul>
            </details></li>}
        </ul>
        <Dialog isOpen={!!preview} onClose={() => setPreviewPath(null)} title="AI file preview" className={styles.previewDialog}>
            <DialogBody>
                <p className={styles.previewPath}>{preview?.path}</p>
                <p className={styles.previewNote}>{previewIsPrevious
                    ? 'Read-only · Previous attempt. Not applied and not part of the current proposal.'
                    : 'Read-only · Latest generated version. Not applied to the workspace; may change during validation.'}</p>
                <pre className={styles.previewSource} tabIndex={0} aria-label={`Read-only source for ${preview?.path || 'AI file'}`}><code>{preview?.content}</code></pre>
            </DialogBody>
        </Dialog>
    </section>;
}
