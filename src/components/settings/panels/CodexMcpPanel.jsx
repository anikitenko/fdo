import React, {useEffect, useState} from 'react';
import {Button, Callout, Card, Checkbox, FormGroup, HTMLSelect, Icon, InputGroup, NonIdealState, Switch, Tag} from '@blueprintjs/core';
import {ArgumentFields, PairFields, connectionPairs} from './McpConnectionFields';
import * as styles from './AIExtensionsPanel.module.css';

function ServerCard({server, assistants, busy, run, api}) {
    const [expanded, setExpanded] = useState(false);
    const [enabled, setEnabled] = useState(server.enabled);
    const [assigned, setAssigned] = useState(server.assistantIds);
    const [tools, setTools] = useState(server.enabledTools);
    useEffect(() => {setEnabled(server.enabled); setAssigned(server.assistantIds); setTools(server.enabledTools);}, [server]);
    const toggle = (setter, name, checked) => setter(current => checked ? [...current, name] : current.filter(n => n !== name));
    const changed = enabled !== server.enabled || JSON.stringify(assigned) !== JSON.stringify(server.assistantIds) || JSON.stringify(tools) !== JSON.stringify(server.enabledTools);
    return <Card className={styles.skill}>
        <div className={styles.heading}><strong>{server.name}</strong><Tag minimal>{server.enabled ? `${server.enabledTools.length} tools enabled` : 'Disabled'}</Tag></div>
        <p className={styles.endpoint}>{server.transport === 'stdio' ? `${server.command} ${(server.args || []).join(' ')}` : server.url}</p>
        <p className={styles.note}>{server.checkedAt ? `Connection checked ${new Date(server.checkedAt).toLocaleString()}` : 'Connection not checked yet'} · {server.authMode === 'oauth' ? `OAuth: ${{authorized: 'Signed in', signed_out: 'Signed out', pending: 'Waiting for browser', cancelled: 'Cancelled', error: 'Sign-in failed'}[server.oauthStatus] || 'Signed out'}` : server.hasBearerToken ? 'Bearer token saved' : 'No bearer token'}</p>
        <Switch label={`Enable ${server.name}`} checked={enabled} disabled={busy} onChange={e => setEnabled(e.target.checked)}/>
        <Button className={styles.disclosureButton} minimal icon={expanded ? 'chevron-down' : 'chevron-right'} text="Tools and settings" aria-label={`Tools and settings for ${server.name}`} aria-expanded={expanded} aria-controls={`mcp-settings-${server.id}`} onClick={() => setExpanded(value => !value)}/>
        <div id={`mcp-settings-${server.id}`} hidden={!expanded}>
            {!!server.headerNames?.length && <p className={styles.note}>Custom headers: {server.headerNames.join(', ')} (values hidden)</p>}
            {!!server.environmentKeys?.length && <p className={styles.note}>Environment: {server.environmentKeys.join(', ')} (values hidden)</p>}
            {server.authMode === 'oauth' && <div className={styles.actions}>
                <Button text={server.oauthStatus === 'authorized' ? 'Sign in again' : 'Sign in'} disabled={busy || server.oauthStatus === 'pending'} onClick={() => run(() => api.signInMcp(server.id), 'Complete sign-in in your browser. Then check the connection.')}/>
                {server.oauthStatus === 'pending' && <Button text="Cancel sign-in" disabled={busy} onClick={() => run(() => api.cancelMcpSignIn(server.id), 'Sign-in cancelled.')}/>}
                <Button text="Sign out" disabled={busy || server.oauthStatus !== 'authorized'} onClick={() => run(() => api.signOutMcp(server.id), 'Saved MCP sign-in cleared.')}/>
                {server.oauthMessage && <span role="status" className={styles.note}>{server.oauthMessage}</span>}
            </div>}
            <fieldset disabled={busy} className={styles.assignments}><legend>Allowed tools</legend>
                <p className={styles.note}>Saving enabled tools authorizes Codex to call them during requests without asking each time. Calls may send task context to this server and perform actions. This connection may also expose server resources. Select only tools you trust.</p>
                {server.tools.map(tool => <div key={tool.name}><Checkbox label={tool.name} checked={tools.includes(tool.name)} onChange={e => toggle(setTools, tool.name, e.target.checked)}/><p className={styles.note}>{tool.description}</p></div>)}
                {!server.tools.length && <p>The server exposes no tools.</p>}
            </fieldset>
            <fieldset disabled={busy} className={styles.assignments}><legend>Use with these Codex assistants</legend>
                {assistants.map(a => <Checkbox key={a.id} label={`${a.name} · ${a.model}`} checked={assigned.includes(a.id)} onChange={e => toggle(setAssigned, a.id, e.target.checked)}/>)}
                {!assistants.length && <p>Add a Codex coding assistant in AI Assistants.</p>}
            </fieldset>
            {enabled && (!tools.length || !assigned.length) && <Callout intent="warning">Select at least one tool and one assistant to make this connection available.</Callout>}
            <div className={styles.actions}>
                <Button text="Check connection" icon="refresh" disabled={busy || changed || server.authMode === 'oauth' && server.oauthStatus !== 'authorized'} onClick={() => run(() => api.checkCodexMcp({id: server.id}), `Connection checked: ${server.name}. Tool inventory refreshed.`)}/>
                <Button text="Remove server" icon="trash" minimal disabled={busy} onClick={() => run(() => api.removeCodexMcp(server.id), 'MCP server removed from FDO.')}/>
            </div>
        </div>
        {changed && <div className={styles.actions}>
            <Button text="Save MCP permissions" intent="primary" disabled={busy || !changed} onClick={() => run(() => api.updateCodexMcp({id: server.id, enabled, assistantIds: assigned, enabledTools: tools}), 'MCP permissions saved. They take effect on the next request.')}/>
            <span className={styles.note}>Unsaved changes</span>
        </div>}
    </Card>;
}

export default function CodexMcpPanel({inventory, busy, run, api}) {
    const [name, setName] = useState(''); const [url, setUrl] = useState(''); const [token, setToken] = useState('');
    const [transport, setTransport] = useState('http'); const [authMode, setAuthMode] = useState('bearer');
    const [command, setCommand] = useState(''); const [args, setArgs] = useState([]); const [cwd, setCwd] = useState('');
    const [headers, setHeaders] = useState([]); const [environment, setEnvironment] = useState([]);
    const [clientId, setClientId] = useState(''); const [scopes, setScopes] = useState(''); const [callbackPort, setCallbackPort] = useState('0');
    return <div>
        <p>Connect remote or local MCP servers, select tools, and assign them to saved Codex coding assistants.</p>
        <Callout title="HTTP and command servers" className={styles.info}>Use remote HTTPS or local loopback HTTP endpoints, or launch an installed command over stdio. Command servers run as separate trusted tools with your user permissions and the environment you configure. Codex’s own shell remains disabled. Connection testing starts command servers but does not call their tools.</Callout>
        <details className={styles.skill} open={!(inventory.mcpServers || []).length}><summary className={styles.disclosureSummary}><Icon icon="chevron-right" className={styles.disclosureChevron}/><span>Add MCP server</span></summary><Card className={styles.skill}>
            <FormGroup label="Server name" labelFor="mcp-name"><InputGroup id="mcp-name" value={name} disabled={busy} onChange={e => setName(e.target.value)} placeholder="Team documentation"/></FormGroup>
            <FormGroup label="Transport" labelFor="mcp-transport"><HTMLSelect className={styles.selectControl} fill iconName="caret-down" id="mcp-transport" value={transport} disabled={busy} options={[{label: 'HTTP · remote or local', value: 'http'}, {label: 'Command · stdio', value: 'stdio'}]} onChange={e => setTransport(e.target.value)}/></FormGroup>
            {transport === 'http' ? <>
                <FormGroup label="MCP endpoint" labelFor="mcp-url" helperText="HTTPS for remote servers; HTTP is allowed for localhost, 127.0.0.1, or [::1]."><InputGroup id="mcp-url" value={url} disabled={busy} onChange={e => setUrl(e.target.value)} placeholder="https://example.com/mcp"/></FormGroup>
                <FormGroup label="Authentication" labelFor="mcp-auth"><HTMLSelect className={styles.selectControl} fill iconName="caret-down" id="mcp-auth" value={authMode} disabled={busy} options={[{label: 'None / custom headers', value: 'none'}, {label: 'Bearer token', value: 'bearer'}, {label: 'OAuth · browser sign-in', value: 'oauth'}]} onChange={e => setAuthMode(e.target.value)}/></FormGroup>
                {authMode === 'bearer' && <FormGroup label="Bearer token (optional)" labelFor="mcp-token"><InputGroup id="mcp-token" type="password" autoComplete="off" value={token} disabled={busy} onChange={e => setToken(e.target.value)}/></FormGroup>}
                {authMode === 'oauth' && <>
                    <FormGroup label="OAuth client ID (optional)" labelFor="mcp-client" helperText="Leave blank for dynamic client registration. Enter an existing public client ID if your server requires one."><InputGroup id="mcp-client" value={clientId} disabled={busy} onChange={e => setClientId(e.target.value)}/></FormGroup>
                    <FormGroup label="OAuth scopes (optional)" labelFor="mcp-scopes"><InputGroup id="mcp-scopes" value={scopes} disabled={busy} onChange={e => setScopes(e.target.value)}/></FormGroup>
                    <FormGroup label="OAuth callback port" labelFor="mcp-callback" helperText="0 chooses an available loopback port. For a pre-registered client, register http://127.0.0.1:PORT/callback with your provider and enter that port here."><InputGroup id="mcp-callback" type="number" value={callbackPort} disabled={busy} onChange={e => setCallbackPort(e.target.value)}/></FormGroup>
                </>}
                <PairFields kind="header" rows={headers} onChange={setHeaders} disabled={busy}/>
            </> : <>
                <FormGroup label="Installed command or executable path" labelFor="mcp-command" helperText="For example node, npx, uvx, or an absolute executable path. FDO does not install server dependencies."><InputGroup id="mcp-command" value={command} disabled={busy} onChange={e => setCommand(e.target.value)} placeholder="npx"/></FormGroup>
                <ArgumentFields rows={args} onChange={setArgs} disabled={busy}/>
                <FormGroup label="Working directory (optional)" labelFor="mcp-cwd" helperText="Absolute path. Blank starts the server in your home directory."><InputGroup id="mcp-cwd" value={cwd} disabled={busy} onChange={e => setCwd(e.target.value)}/></FormGroup>
                <PairFields kind="environment" rows={environment} onChange={setEnvironment} disabled={busy}/>
            </>}
            <p className={styles.note}>Connection testing sends only MCP initialization and discovery requests. New servers are saved disabled until you choose tools and assistants.</p>
            <div className={styles.actions}>
                <Button intent="primary" text={busy ? 'Working…' : transport === 'http' && authMode === 'oauth' ? 'Add server and sign in' : 'Test and add server'} loading={busy} disabled={busy || !name.trim() || !(transport === 'stdio' ? command.trim() : url.trim()) || !api.checkCodexMcp} onClick={() => run(async () => {
                    let result = await api.checkCodexMcp({name: name.trim(), transport, url: transport === 'http' ? url.trim() : '',
                        bearerToken: transport === 'http' && authMode === 'bearer' ? token : '', authMode: transport === 'stdio' ? 'none' : authMode,
                        headers: transport === 'http' ? connectionPairs(headers, 'Custom headers') : {}, command: transport === 'stdio' ? command.trim() : '',
                        args: transport === 'stdio' ? args.map(row => row.value) : [], cwd: transport === 'stdio' ? cwd.trim() : '', environment: transport === 'stdio' ? connectionPairs(environment, 'Environment variables') : {},
                        oauthClientId: clientId.trim(), oauthScopes: scopes.trim(), oauthCallbackPort: Number(callbackPort)});
                    if (transport === 'http' && authMode === 'oauth') {const added = result.mcpServers.find(s => s.name === name.trim()); result = await api.signInMcp(added.id);}
                    setName(''); setUrl(''); setToken(''); setHeaders([]); setEnvironment([]); return result;
                }, transport === 'http' && authMode === 'oauth' ? 'Complete sign-in in your browser, then check the connection.' : 'MCP connection succeeded. Choose tools and assistants, enable the server, then save permissions.')}/>
                <Button text="Use OpenAI Docs example" minimal disabled={busy} onClick={() => {setTransport('http'); setAuthMode('none'); setName('OpenAI Docs'); setUrl('https://developers.openai.com/mcp'); setToken(''); setHeaders([]);}}/>
            </div>
        </Card></details>
        {!(inventory.mcpServers || []).length && <NonIdealState className={styles.emptyState} icon="data-connection" title="No MCP servers connected yet" description="Add an MCP server above to connect tools to your Codex assistants."/>}
        {(inventory.mcpServers || []).map(server => <ServerCard key={server.id} server={server} assistants={inventory.assistants} busy={busy} api={api} run={run}/>)}
    </div>;
}
