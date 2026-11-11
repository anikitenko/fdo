import React, {useEffect, useState} from 'react';
import {Checkbox, Classes, Dialog, DialogBody, InputGroup, Menu, MenuDivider, MenuItem} from '@blueprintjs/core';
import virtualFS from './utils/VirtualFS';
import {findWorkspaceText} from './utils/findWorkspaceText';
import * as styles from './EditorPage.module.css';

export default function FindInFilesDialog({isOpen, onClose, onResult}) {
    const [query, setQuery] = useState(''), [matchCase, setMatchCase] = useState(false), [wholeWord, setWholeWord] = useState(false);
    const [includeDependencies, setIncludeDependencies] = useState(true), [revision, setRevision] = useState(0);
    const [result, setResult] = useState({matches: [], truncated: false}), [selected, setSelected] = useState(0);
    useEffect(() => {
        if (!isOpen) return;
        const refresh = () => setRevision(value => value + 1);
        const subscriptions = ['fileContentChanged', 'fileCreated', 'treeUpdate'].map(event => virtualFS.notifications.subscribe(event, refresh));
        return () => subscriptions.forEach(dispose => dispose());
    }, [isOpen]);
    useEffect(() => {
        if (!isOpen) return;
        const timer = setTimeout(() => {
            setResult(findWorkspaceText(virtualFS.getLatestContent(), query, {matchCase, wholeWord, includeDependencies}));setSelected(0);
        }, 150);
        return () => clearTimeout(timer);
    }, [isOpen, query, matchCase, wholeWord, includeDependencies, revision]);
    const open = match => {
        if (!match) return;
        onResult(match);onClose();
    };
    return <Dialog isOpen={isOpen} onClose={onClose} title="Find in files" icon="search" className={Classes.DARK} style={{width: 800, maxWidth: 'calc(100vw - 32px)'}}>
        <DialogBody>
            <InputGroup autoFocus leftIcon="search" aria-label="Find text in files" placeholder="Search file contents…" value={query}
                onChange={event => setQuery(event.target.value)} onKeyDown={event => {
                    if (event.key === 'Enter') {event.preventDefault();open(result.matches[selected]);}
                    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {event.preventDefault();setSelected(value => Math.max(0, Math.min(result.matches.length - 1, value + (event.key === 'ArrowDown' ? 1 : -1))));}
                }}/>
            <div className={styles.fileTypeChoices}>
                <Checkbox checked={matchCase} onChange={event => setMatchCase(event.target.checked)}>Match case</Checkbox>
                <Checkbox checked={wholeWord} onChange={event => setWholeWord(event.target.checked)}>Whole word</Checkbox>
                <Checkbox checked={includeDependencies} onChange={event => setIncludeDependencies(event.target.checked)}>Include dependencies and build output</Checkbox>
            </div>
            <p role="status" className={Classes.TEXT_MUTED}>{!query ? 'Enter text to search across files.' : result.truncated ? 'Showing the first 500 matches. Refine your search.' : `${result.matches.length} matches in ${new Set(result.matches.map(match => match.filePath)).size} files.`}</p>
            <Menu className={styles.quickFileResults} aria-label="Search results">{result.matches.flatMap((match, index) => [
                ...(index === 0 || result.matches[index - 1].filePath !== match.filePath ? [<MenuDivider key={`${match.filePath}-heading`} title={match.filePath}/>] : []),
                <MenuItem key={`${match.filePath}:${match.line}:${match.column}`} active={index === selected} label={`${match.line}:${match.column}`}
                    text={<span>{match.before}<strong>{match.text}</strong>{match.after}</span>} onClick={() => open(match)}/>,
            ])}</Menu>
        </DialogBody>
    </Dialog>;
}
