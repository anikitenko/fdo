import {useEffect, useRef, useState} from 'react';
import virtualFS from '../../editor/utils/VirtualFS';
import {liveUiWorkspacePayload} from '../../../utils/plugins/authoring/liveUi/workspaceState';
import {applyVisualEdit} from './applyVisualEdit';
import * as monaco from 'monaco-editor';
import {focusLiveUiAiSelection} from './focusAiSelection';
import {reviewPluginSupportChange} from '../../../utils/sdk/pluginSupportEditing';

export function useLiveUiConnection() {
    const session = useRef(null), last = useRef(''), busy = useRef(null), alive = useRef(true);
    const openingRef = useRef(false);
    const [opening, setOpening] = useState(false), [error, setError] = useState('');
    const selection = useRef(null), designSession = useRef(null);
    // Keep a completion signal so an explicit Open waits for synchronization
    // instead of silently discarding the user's click while IPC is in flight.
    const acquire = () => {
        let finish;
        busy.current = new Promise(resolve => {finish = resolve;});
        return () => {busy.current = null; finish();};
    };
    const payload = () => {
        const editor = monaco.editor.getEditors?.().find(editor => editor.hasTextFocus?.());
        const position = editor?.getPosition();
        if (position && editor.getModel()) selection.current = {path: editor.getModel().uri.path, line: position.lineNumber, column: position.column};
        return {...liveUiWorkspacePayload(virtualFS), selection: selection.current};
    };
    useEffect(() => {
        alive.current = true;
        const unsubscribe = window.electron.liveUi?.onApply?.(async request => {
            if (busy.current) {
                await window.electron.liveUi.applied(request.sessionId, request.requestId, {status: 'busy', message: 'The IDE is synchronizing. Retry Apply.'});
                return;
            }
            const release = acquire();
            let result;
            try {
                if (designSession.current?.id !== request.sessionId) designSession.current = {id: request.sessionId};
                result = await applyVisualEdit({workspace: virtualFS, base: request.base, patch: request.patch, patches: request.patches, storage: localStorage, designSession: designSession.current, keepCheckpoint: request.keepCheckpoint === true,
                    isActive: () => alive.current,
                    canCommit: () => window.electron.liveUi.canCommit(request.sessionId, request.requestId),
                    validate: async latestContent => {
                        if (request.supportOnly === true) {
                            reviewPluginSupportChange(request.base.files, latestContent);
                            return {success: true};
                        }
                        const types = await window.electron.plugin.typecheck({latestContent});
                        if (!types.success) return {success: false, error: types.error || types.diagnostics?.map(item => `${item.path}:${item.line}: ${item.message}`).join('\n') || 'Type validation failed.'};
                        const build = await window.electron.plugin.build({latestContent});
                        return {success: build.success, error: build.error};
                    }});
                if (result.status === 'applied') last.current = JSON.stringify(result.workspace);
            } catch (failure) {result = {status: 'error', message: failure.message || String(failure)};}
            finally {
                try {await window.electron.liveUi.applied(request.sessionId, request.requestId, result);} catch { /* Owner/window disconnected; source remains authoritative. */ }
                release();
            }
        });
        const unsubscribeReveal = window.electron.liveUi?.onReveal?.(location => {
            if (location.workspaceId !== virtualFS.sandboxName) return;
            const file = virtualFS.getTreeObjectItemById(location.path);
            if (!file) return;
            virtualFS.setTreeObjectItemSelectedSilent(location.path);
            virtualFS.tabs.add(file);
            virtualFS.notifications.addToQueue('fileSelected', file);
            setTimeout(() => {
                for (const editor of monaco.editor.getEditors()) if (editor.getModel()?.uri.path === location.path) {
                    editor.setPosition({lineNumber: location.line, column: location.column});
                    editor.revealPositionInCenter({lineNumber: location.line, column: location.column});
                    editor.focus();
                }
            }, 100);
        });
        const unsubscribeAi = window.electron.liveUi?.onAiSelection?.(async location => {
            if (location.workspaceId !== virtualFS.sandboxName) return;
            if (virtualFS.aiCodingBusy) {
                setError('Finish or stop the current AI request before changing its source selection.');
                return;
            }
            try {
                const file = virtualFS.getTreeObjectItemById(location.path);
                if (!file) return;
                const selected = await focusLiveUiAiSelection({workspace: virtualFS, selection: location,
                    getEditors: () => monaco.editor.getEditors(), isActive: () => alive.current,
                    openFile: () => {
                        virtualFS.setTreeObjectItemSelectedSilent(location.path);
                        virtualFS.tabs.add(file);
                        virtualFS.notifications.addToQueue('fileSelected', file);
                    }});
                if (selected) virtualFS.notifications.addToQueue('liveUiAiSelection', {workspaceId: location.workspaceId});
                else if (alive.current) setError('The selected source changed or could not be opened. Refresh Live UI before editing with AI.');
            } catch (failure) {if (alive.current) setError(failure.message || 'The selected source could not be opened. Refresh Live UI before editing with AI.');}
        });
        const timer = setInterval(async () => {
            if (!session.current || busy.current || openingRef.current || virtualFS.fs.getRestoreLoading?.()) return;
            const release = acquire();
            try {
                const data = payload();
                const fingerprint = JSON.stringify(data);
                if (fingerprint !== last.current) {
                    const result = await window.electron.liveUi.publish(session.current, data);
                    if (result?.status === 'closed') {
                        session.current = null;
                        return;
                    }
                    last.current = fingerprint;
                }
            } catch (failure) {
                session.current = null;
                if (alive.current) setError('The Live UI preview could not be updated. Select “Live UI editor” to try again.');
            } finally {release();}
        }, 750);
        return () => {alive.current = false; clearInterval(timer); unsubscribe?.(); unsubscribeReveal?.(); unsubscribeAi?.();};
    }, []);
    const open = async () => {
        if (openingRef.current) return;
        openingRef.current = true;
        setOpening(true); setError('');
        let release;
        try {
            while (busy.current) await busy.current;
            if (!alive.current) return;
            release = acquire();
            setError('');
            const data = payload();
            const result = await window.electron.liveUi.open(data);
            session.current = result.sessionId;
            last.current = JSON.stringify(data);
        } catch (failure) {if (alive.current) setError(failure.message || String(failure));}
        finally {release?.(); openingRef.current = false; if (alive.current) setOpening(false);}
    };
    return {open, opening, error};
}
