import React, {useEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import PropTypes from 'prop-types';
import {Button, ButtonGroup, NonIdealState} from '@blueprintjs/core';
import Markdown from 'markdown-to-jsx';
import * as styles from './MarkdownEditorSurface.module.css';

function PreviewLink({href, children, ...props}) {
    return <a {...props} href={href} onClick={event => {
        event.preventDefault();
        if (!href) return;
        if (href.startsWith('#')) {
            try {
                const id = decodeURIComponent(href.slice(1));
                Array.from(event.currentTarget.closest('section')?.querySelectorAll('[id]') || []).find(element => element.id === id)?.scrollIntoView?.({block:'start'});
            } catch { /* Ignore malformed fragment links without changing the app route. */ }
            return;
        }
        if (/^https?:\/\//i.test(href)) void window.electron?.system?.openExternal?.(href);
    }}>{children}</a>;
}
PreviewLink.propTypes = {href:PropTypes.string, children:PropTypes.node};
const markdownOptions = {disableParsingRawHTML:true, forceBlock:true, overrides:{a:PreviewLink}};

export default function MarkdownEditorSurface({filePath, model, editor, toolbarTarget, children}) {
    const [modes, setModes] = useState({});
    const [document, setDocument] = useState({model:null, content:''});
    const previewRef = useRef(null);
    const isMarkdown = /\.(?:md|markdown)$/i.test(filePath || '');
    const mode = isMarkdown ? modes[filePath] || 'code' : 'code';
    const content = isMarkdown && mode !== 'code' ? document.model === model ? document.content : model?.getValue?.() || '' : '';
    useEffect(() => {
        if (!isMarkdown || mode === 'code') return;
        const update = () => setDocument({model, content:model?.getValue?.() || ''});
        update();
        const subscription = model?.onDidChangeContent?.(update);
        return () => subscription?.dispose?.();
    }, [model, isMarkdown, mode]);
    useEffect(() => {
        const frame = requestAnimationFrame(() => editor?.layout?.());
        return () => cancelAnimationFrame(frame);
    }, [mode, editor]);
    useEffect(() => {
        const preview = previewRef.current;
        if (mode !== 'split' || !preview || !editor?.onDidScrollChange) return;
        let expectedCode = null, expectedPreview = null;
        const codeRange = () => Math.max(0, editor.getScrollHeight() - editor.getLayoutInfo().height);
        const previewRange = () => Math.max(0, preview.scrollHeight - preview.clientHeight);
        const fromCode = () => {
            const top = editor.getScrollTop();
            if (expectedCode !== null && Math.abs(top - expectedCode) < 1) {expectedCode = null; return;}
            expectedCode = null;
            expectedPreview = codeRange() ? top / codeRange() * previewRange() : 0;
            preview.scrollTop = expectedPreview;
        };
        const fromPreview = () => {
            if (expectedPreview !== null && Math.abs(preview.scrollTop - expectedPreview) < 1) {expectedPreview = null; return;}
            expectedPreview = null;
            expectedCode = previewRange() ? preview.scrollTop / previewRange() * codeRange() : 0;
            editor.setScrollTop(expectedCode);
        };
        const subscription = editor.onDidScrollChange(event => {if (event.scrollTopChanged) fromCode();});
        preview.addEventListener('scroll', fromPreview, {passive:true});
        fromCode();
        return () => {subscription.dispose(); preview.removeEventListener('scroll', fromPreview);};
    }, [editor, model, mode]);
    const controls = <ButtonGroup aria-label="Markdown view" className="bp6-dark">
                {[['code','code','Code'], ['preview','eye-open','Preview'], ['split','panel-stats','Split']].map(([value, icon, label]) =>
                    <Button key={value} size="small" variant="minimal" icon={icon} active={mode === value} aria-pressed={mode === value} aria-label={label} title={`${label} Markdown`}
                        onClick={() => setModes(previous => ({...previous,[filePath]:value}))}/>)}
            </ButtonGroup>;
    return <div className={styles.surface}>
        {isMarkdown && (toolbarTarget ? createPortal(controls, toolbarTarget) : controls)}
        <div className={styles.panes} data-mode={mode}>
            {/* Keep Monaco mounted so preview switches preserve undo and cursor state. */}
            <div className={styles.codePane} hidden={mode === 'preview'}>{children}</div>
            {mode !== 'code' && <section ref={previewRef} className={styles.preview} aria-label={`Markdown preview: ${filePath}`} tabIndex={0}>
                {content.trim() ? <Markdown options={markdownOptions}>{content}</Markdown>
                    : <NonIdealState icon="document" title="Nothing to preview" description="Add Markdown to this file to see its preview."/>}
            </section>}
        </div>
    </div>;
}
MarkdownEditorSurface.propTypes = {filePath:PropTypes.string, model:PropTypes.object, editor:PropTypes.object, toolbarTarget:PropTypes.object, children:PropTypes.node};
