import CodexHooksPanel from './CodexHooksPanel';
import CodexMcpPanel from './CodexMcpPanel';
import React, {useEffect, useRef, useState} from 'react';
import {Button, Callout, Card, Checkbox, H2, NonIdealState, Spinner, Switch, Tab, Tabs, Tag} from '@blueprintjs/core';
import * as settingsStyles from '../../css/SettingsDialog.module.css';
import * as styles from './AIExtensionsPanel.module.css';

function SkillCard({skill, assistants, busy, onSave, onRemove}) {
    const [enabled, setEnabled] = useState(skill.enabled);
    const [assigned, setAssigned] = useState(skill.assistantIds);
    const assignmentKey = JSON.stringify(skill.assistantIds);
    useEffect(() => {setEnabled(skill.enabled); setAssigned(skill.assistantIds);}, [skill.enabled, assignmentKey]);
    const changed = enabled !== skill.enabled || JSON.stringify([...assigned].sort()) !== JSON.stringify([...skill.assistantIds].sort());
    return <Card className={styles.skill}>
        <div className={styles.heading}><strong>{skill.name}</strong><Tag minimal>{skill.enabled ? `${skill.assistantIds.length} assigned` : 'Disabled'}</Tag></div>
        <p>{skill.description}</p>
        <Switch checked={enabled} disabled={busy} label={`Enable ${skill.name}`} onChange={event => setEnabled(event.target.checked)}/>
        <fieldset disabled={busy} className={styles.assignments}>
            <legend>Use with these Codex assistants</legend>
            {assistants.map(assistant => <Checkbox key={assistant.id} checked={assigned.includes(assistant.id)}
                label={`${assistant.name} · ${assistant.model}`} onChange={event => setAssigned(current => event.target.checked
                    ? [...current, assistant.id] : current.filter(id => id !== assistant.id))}/>)}
            {!assistants.length && <p>Add a Codex coding assistant to assign this skill.</p>}
        </fieldset>
        <details><summary>View imported instructions</summary><pre className={styles.source}>{skill.content}</pre></details>
        <div className={styles.actions}>
            <Button text="Save assignments" icon="floppy-disk" intent="primary" disabled={busy || !changed}
                onClick={() => onSave({id: skill.id, enabled, assistantIds: assigned})}/>
            <Button text="Remove skill" icon="trash" minimal disabled={busy} onClick={() => onRemove(skill.id)}/>
            {changed && <span className={styles.note}>Unsaved changes</span>}
        </div>
    </Card>;
}

export default function AIExtensionsPanel({onOpenAssistants}) {
    const [inventory, setInventory] = useState({skills: [], assistants: []});
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [feedback, setFeedback] = useState('');
    const [tab, setTab] = useState('skills');
    const mounted = useRef(false);
    const operationRef = useRef(false);
    const sequence = useRef(0);
    const api = window.electron.settings.ai;
    useEffect(() => {
        mounted.current = true;
        const load = async () => {
            if (operationRef.current) return;
            const request = ++sequence.current;
            try {
                if (!api.getExtensions) throw new Error('AI Extensions are unavailable in this build. Restart FDO after updating.');
                const result = await api.getExtensions();
                if (mounted.current && request === sequence.current) {setInventory(result); setError('');}
            } catch (error) {if (mounted.current && request === sequence.current) setError(error.message);}
            finally {if (mounted.current && request === sequence.current) setLoading(false);}
        };
        load();
        api.on?.updated?.(load);
        api.on?.extensionsUpdated?.(load);
        return () => {mounted.current = false; sequence.current++; api.off?.updated?.(load); api.off?.extensionsUpdated?.(load);};
    }, []);
    const run = async (operation, message) => {
        if (operationRef.current) return;
        operationRef.current = true; setBusy(true); setError(''); setFeedback('');
        const request = ++sequence.current;
        try {
            const result = await operation();
            if (mounted.current && request === sequence.current) {
                setInventory(result);
                if (!result.canceled) setFeedback(message);
            }
        } catch (error) {if (mounted.current && request === sequence.current) setError(error.message);}
        finally {operationRef.current = false; if (mounted.current) setBusy(false);}
    };
    const skills = <div>
        <p>Import reusable instructions and assign each skill to one or more saved Codex coding assistants. The assistant initially sees names and descriptions. Full instructions load only for an explicit $skill-name mention or when requested for the current step.</p>
        <Callout title="Instruction-only skills" className={styles.info}>
            Import SKILL.md with its name and description in YAML front matter. FDO stores a copy of this file; scripts, references, MCP connections, and hooks are not imported. These extensions are separate from the generated plugin’s /SKILL.md implementation guide, which still requires your approval.
        </Callout>
        <div className={styles.actions}>
            <Button icon="import" text="Import SKILL.md" intent="primary" disabled={busy || loading || !api.importCodexSkill}
                loading={busy} onClick={() => run(() => api.importCodexSkill(), 'Skill imported. Select its Codex assistants and save assignments.')}/>
            <Button icon="refresh" text="Refresh" disabled={busy || !api.getExtensions} onClick={() => run(() => api.getExtensions(), 'AI Extensions refreshed.')}/>
            <Button text="Manage AI assistants" minimal onClick={onOpenAssistants} disabled={busy}/>
        </div>
        {!inventory.assistants.length && <Callout intent="warning">No Codex coding assistants are configured. Add Codex in AI Assistants; each saved model entry will appear as an assignment option.</Callout>}
        {!inventory.skills.length && <NonIdealState className={styles.emptyState} icon="document" title="No skills imported yet" description="Import a SKILL.md to get started, then assign it to your Codex assistants."/>}
        {inventory.skills.map(skill => <SkillCard key={skill.id} skill={skill} assistants={inventory.assistants} busy={busy}
            onSave={patch => run(() => api.updateCodexSkill(patch), 'Assignments saved. They take effect on the next request.')}
            onRemove={id => run(() => api.removeCodexSkill(id), 'Skill removed from FDO. The original file is unchanged.')}/>)}
    </div>;
    return <div className={`${settingsStyles['card-panel']} ${styles.extensions}`}>
        <div className={settingsStyles['card-setting-header']}><H2 style={{margin: 0}}>AI Extensions</H2></div>
        <p>Extend your coding assistants with reusable workflows and tools.</p>
        {error && <Callout intent="danger" role="alert">{error}</Callout>}
        {feedback && <Callout intent="success" role="status">{feedback}</Callout>}
        {loading ? <Spinner aria-label="Loading AI extensions"/> : <Tabs id="ai-extension-providers" selectedTabId="codex" renderActiveTabPanelOnly>
            <Tab id="codex" title="Codex" panel={<Tabs id="codex-extension-types" selectedTabId={tab} onChange={setTab} renderActiveTabPanelOnly>
                <Tab id="skills" title="Skills" panel={skills}/>
                <Tab id="mcp" title="MCP Tools" panel={<CodexMcpPanel inventory={inventory} busy={busy} run={run} api={api}/>}/>
                <Tab id="hooks" title="Hooks" panel={<CodexHooksPanel inventory={inventory} busy={busy} run={run} api={api}/>}/>
            </Tabs>}/>
        </Tabs>}
    </div>;
}
