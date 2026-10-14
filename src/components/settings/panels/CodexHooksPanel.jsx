import React, {useEffect, useState} from 'react';
import {Button, Callout, Card, Checkbox, FormGroup, HTMLSelect, Icon, InputGroup, NonIdealState, Switch, Tag} from '@blueprintjs/core';
import {ArgumentFields, PairFields, connectionPairs} from './McpConnectionFields';
import {CODEX_HOOK_EVENTS} from '../../../utils/ai/codex/codexHookEvents';
import * as styles from './AIExtensionsPanel.module.css';

const descriptions = {
    SessionStart:'When a Codex CLI session starts.',UserPromptSubmit:'Before Codex processes a prompt.',PreToolUse:'Before a tool call; can block the call.',PostToolUse:'After a tool call; cannot undo its effects.',
    PreCompact:'Before conversation compaction.',PostCompact:'After conversation compaction.',Stop:'When Codex finishes its response; can request another pass.',SessionEnd:'When the CLI session ends.',Interrupt:'When the native session is interrupted; limited to three seconds.',
};
function HookCard({hook, assistants, busy, api, run}) {
    const [expanded,setExpanded]=useState(false), [enabled,setEnabled]=useState(hook.enabled), [assigned,setAssigned]=useState(hook.assistantIds);
    const assignmentKey=JSON.stringify(hook.assistantIds);
    useEffect(()=>{setEnabled(hook.enabled);setAssigned(hook.assistantIds);},[hook.enabled,assignmentKey]);
    const changed=enabled!==hook.enabled || JSON.stringify(assigned)!==assignmentKey;
    return <Card className={styles.skill}>
        <div className={styles.heading}><strong>{hook.name}</strong><Tag minimal>{hook.enabled?`${hook.assistantIds.length} assigned`:'Disabled'}</Tag></div>
        <p>{hook.event} · {hook.timeoutSeconds}s timeout</p>
        <p className={styles.endpoint}>{hook.command} {hook.args.join(' ')}</p>
        <Switch label={`Enable ${hook.name}`} checked={enabled} disabled={busy} onChange={e=>setEnabled(e.target.checked)}/>
        <Button minimal icon={expanded?'chevron-down':'chevron-right'} text="Hook settings" aria-label={`Hook settings for ${hook.name}`} aria-expanded={expanded} aria-controls={`hook-${hook.id}`} onClick={()=>setExpanded(value=>!value)}/>
        <div id={`hook-${hook.id}`} hidden={!expanded}>
            <p className={styles.note}>{descriptions[hook.event]} {hook.toolPattern && `Tool pattern: ${hook.toolPattern}.`}</p>
            <p className={styles.note}>Working directory: {hook.cwd || 'Your home directory'}</p>
            {!!hook.environmentKeys.length && <p className={styles.note}>Environment: {hook.environmentKeys.join(', ')} (values hidden)</p>}
            <fieldset disabled={busy} className={styles.assignments}><legend>Use with these Codex assistants</legend>
                {assistants.map(a=><Checkbox key={a.id} label={`${a.name} · ${a.model}`} checked={assigned.includes(a.id)} onChange={e=>setAssigned(current=>e.target.checked?[...current,a.id]:current.filter(id=>id!==a.id))}/>)}
                {!assistants.length && <p>Add a Codex coding assistant in AI Assistants.</p>}
            </fieldset>
            {enabled && !assigned.length && <Callout intent="warning">Assign at least one assistant to run this hook.</Callout>}
            <div className={styles.actions}>
                <Button text="Test hook" icon="play" disabled={busy || !api.testCodexHook} onClick={()=>run(()=>api.testCodexHook(hook.id),'Hook test finished. See its result below.')}/>
                <Button minimal text="Remove hook" icon="trash" disabled={busy} onClick={()=>run(()=>api.removeCodexHook(hook.id),'Hook removed.')}/>
            </div>
        </div>
        {changed && <div className={styles.actions}><Button text="Save hook assignments" intent="primary" disabled={busy} onClick={()=>run(()=>api.updateCodexHook({id:hook.id,enabled,assistantIds:assigned}),'Hook assignments saved. They take effect on the next request.')}/><span className={styles.note}>Unsaved changes</span></div>}
    </Card>;
}
export default function CodexHooksPanel({inventory,busy,run,api}) {
    const [name,setName]=useState(''),[event,setEvent]=useState('UserPromptSubmit'),[pattern,setPattern]=useState(''),[command,setCommand]=useState(''),[args,setArgs]=useState([]),[cwd,setCwd]=useState(''),[environment,setEnvironment]=useState([]),[timeout,setTimeoutValue]=useState('10');
    return <div>
        <p>Run your own commands at Codex lifecycle events and assign each hook to saved Codex coding assistants.</p>
        <Callout title="Trusted commands" className={styles.info}>Enabling a hook authorizes it to run automatically with your user permissions. It receives the event as JSON on stdin; its output may become model context. FDO runs only the commands you configure. The coding agent’s shell stays disabled.</Callout>
        <p className={styles.note}>FDO starts CLI sessions for generation steps, so session and prompt hooks can run more than once during a plan. Hooks see the temporary proposal workspace, not applied plugin files. Forced cancellation may skip native end/interrupt events.</p>
        <details className={styles.skill} open={!(inventory.hooks || []).length}><summary className={styles.disclosureSummary}><Icon icon="chevron-right" className={styles.disclosureChevron}/><span>Add hook</span></summary><Card className={styles.skill}>
            <FormGroup label="Hook name" labelFor="hook-name"><InputGroup id="hook-name" value={name} disabled={busy} onChange={e=>setName(e.target.value)} placeholder="Team coding context"/></FormGroup>
            <FormGroup label="Lifecycle event" labelFor="hook-event" helperText={descriptions[event]}><HTMLSelect id="hook-event" className={styles.selectControl} fill iconName="caret-down" value={event} disabled={busy} options={CODEX_HOOK_EVENTS} onChange={e=>{setEvent(e.target.value);if(e.target.value==='Interrupt')setTimeoutValue('3');}}/></FormGroup>
            {['PreToolUse','PostToolUse'].includes(event) && <FormGroup label="Tool name pattern (optional)" labelFor="hook-pattern" helperText="Blank matches all tools. Use * as a wildcard, for example mcp__*. Model shell and file editing tools are disabled in FDO."><InputGroup id="hook-pattern" value={pattern} disabled={busy} onChange={e=>setPattern(e.target.value)}/></FormGroup>}
            <FormGroup label="Installed hook command or executable path" labelFor="hook-command" helperText="For example node or python3. Put a script path in the argument rows. Commands and scripts must be installed separately."><InputGroup id="hook-command" value={command} disabled={busy} onChange={e=>setCommand(e.target.value)} placeholder="node"/></FormGroup>
            <ArgumentFields rows={args} onChange={setArgs} disabled={busy}/>
            <FormGroup label="Hook working directory (optional)" labelFor="hook-cwd" helperText="Absolute path; defaults to your home directory."><InputGroup id="hook-cwd" value={cwd} disabled={busy} onChange={e=>setCwd(e.target.value)}/></FormGroup>
            <PairFields kind="environment" rows={environment} onChange={setEnvironment} disabled={busy}/>
            <FormGroup label="Hook timeout (seconds)" labelFor="hook-timeout" helperText={event==='Interrupt'?'1–3 seconds.':'1–60 seconds. Timed-out commands are stopped.'}><InputGroup id="hook-timeout" type="number" min={1} max={event==='Interrupt'?3:60} value={timeout} disabled={busy} onChange={e=>setTimeoutValue(e.target.value)}/></FormGroup>
            <Button text="Add hook" icon="plus" intent="primary" disabled={busy || !name.trim() || !command.trim() || !api.addCodexHook} onClick={()=>run(async()=>{
                const result=await api.addCodexHook({name:name.trim(),event,toolPattern:pattern.trim(),command:command.trim(),args:args.map(row=>row.value),cwd:cwd.trim(),environment:connectionPairs(environment,'Environment variables'),timeoutSeconds:Number(timeout)});
                setName('');setCommand('');setArgs([]);setEnvironment([]);return result;
            },'Hook added disabled. Test it, assign assistants, then enable and save.')}/>
        </Card></details>
        {!(inventory.hooks || []).length && <NonIdealState className={styles.emptyState} icon="flow-branch" title="No hooks configured yet" description="Add a hook above to run a command at a Codex lifecycle event."/>}
        {(inventory.hooks || []).map(hook=><HookCard key={hook.id} hook={hook} assistants={inventory.assistants} busy={busy} api={api} run={run}/>)}
        {inventory.hookTest && <Callout intent={inventory.hookTest.status==='completed'?'success':inventory.hookTest.status==='blocked'?'warning':'danger'} role="status" title={`Hook test ${inventory.hookTest.status}`}>
            Synthetic event · exit code {inventory.hookTest.exitCode} · {inventory.hookTest.durationMs}ms. Testing runs the command even while disabled; it does not exercise native lifecycle dispatch.
            {inventory.hookTest.output && <details><summary className={styles.disclosureSummary}>View test output</summary><pre className={styles.source}>{inventory.hookTest.output}</pre></details>}
        </Callout>}
    </div>;
}
