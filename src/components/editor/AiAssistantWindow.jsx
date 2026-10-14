import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {Button, Callout, PortalProvider} from '@blueprintjs/core';
import * as styles from './AiAssistantWindow.module.css';

// The portal target never changes. Moving this host between documents keeps
// the assistant mounted, including its draft, IPC listeners and active request.
export default function AiAssistantWindow({visible, focusRequest = 0, onReturnToTab, children}) {
    const [host] = useState(() => document.createElement('div'));
    const dock = useRef(null);
    const popup = useRef(null);
    const [detached, setDetached] = useState(false);
    const [eventDocument, setEventDocument] = useState(document);
    const [error, setError] = useState('');
    const cleanupPopup = useRef(() => {});
    const mounted = useRef(true);
    host.className = styles.host;

    const redock = () => {
        const child = popup.current;
        popup.current = null;
        cleanupPopup.current();
        dock.current?.appendChild(host);
        if (mounted.current) {setDetached(false); setEventDocument(document);}
        if (child && !child.closed) child.close();
    };
    const showIde = async () => {
        try {
            const result = await window.electron.system.focusEditorWindow();
            if (!result?.success) throw new Error(result?.error || 'Unable to focus the IDE window.');
        } catch (failure) {setError(failure.message || 'Unable to focus the IDE window.');}
    };
    const returnToTab = () => {redock(); onReturnToTab?.(); void showIde();};
    useLayoutEffect(() => {dock.current?.appendChild(host);}, [host]);
    useEffect(() => {mounted.current = true; return () => {mounted.current = false; redock();};}, []);
    useEffect(() => {if (focusRequest && popup.current && !popup.current.closed) popup.current.focus();}, [focusRequest]);

    const open = () => {
        if (popup.current && !popup.current.closed) {popup.current.focus(); return;}
        let child;
        try {
            child = window.open('about:blank', 'fdo-ai-assistant', 'popup=yes,width=680,height=900');
            if (!child) throw new Error('The assistant window could not open. You can continue using the editor tab.');
            const target = child.document;
            target.title = 'AI Coding Assistant · FDO';
            const base = target.createElement('base'); base.href = document.baseURI; target.head.appendChild(base);
            target.body.className = `${document.body.className} bp6-dark ${styles.popupBody}`;
            const synchronizeStyles = () => {
                target.head.querySelectorAll('[data-fdo-assistant-style]').forEach(node => node.remove());
                document.head.querySelectorAll('style, link[rel="stylesheet"]').forEach(node => {
                    const copy = node.cloneNode(true);
                    copy.setAttribute('data-fdo-assistant-style', '');
                    if (node.tagName === 'LINK') copy.href = node.href;
                    target.head.appendChild(copy);
                });
            };
            synchronizeStyles();
            const observer = new MutationObserver(synchronizeStyles);
            observer.observe(document.head, {childList: true, subtree: true, characterData: true, attributes: true});
            const onClose = () => redock();
            child.addEventListener('beforeunload', onClose);
            // Native window closure may not emit beforeunload when the OS shuts
            // it down. Check only window lifecycle, never request progress.
            const timer = setInterval(() => {if (child.closed) redock();}, 500);
            cleanupPopup.current = () => {
                observer.disconnect(); clearInterval(timer);
                child.removeEventListener('beforeunload', onClose);
                cleanupPopup.current = () => {};
            };
            popup.current = child;
            target.body.appendChild(host);
            setEventDocument(target); setDetached(true); setError('');
            child.focus();
        } catch (failure) {
            if (child && !child.closed) child.close();
            setError(failure.message || 'Unable to open the assistant window.');
        }
    };
    return <>
        <div className={styles.controls} style={{display: visible || detached ? 'flex' : 'none'}}>
            <Button small minimal icon={detached ? 'application' : 'maximize'}
                text={detached ? 'Show assistant window' : 'Open assistant window'} onClick={open}/>
            {detached && <Button small minimal icon="minimize" text="Return to tab" onClick={returnToTab}/>}
        </div>
        {error && visible && <Callout intent="warning">{error}</Callout>}
        {detached && visible && <div className={styles.placeholder}>
            <p>The assistant is open in its own window. Your conversation and requests stay connected to this editor.</p>
        </div>}
        <div ref={dock} style={{display: visible && !detached ? 'flex' : 'none'}} className={styles.dock} aria-hidden={!visible || detached}/>
        {createPortal(<PortalProvider portalContainer={eventDocument.body}>
            <div className={styles.content}>
                {detached && <header className={styles.windowToolbar}>
                    <strong>AI Coding Assistant</strong>
                    <Button small minimal icon="code" text="Show IDE" onClick={showIde}/>
                    <Button small minimal icon="minimize" text="Return to editor" onClick={returnToTab}/>
                </header>}
                {detached && error && <Callout intent="warning">{error}</Callout>}
                {children({eventDocument})}
            </div>
        </PortalProvider>, host)}
    </>;
}
