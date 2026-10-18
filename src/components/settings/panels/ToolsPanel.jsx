import * as styles from '../../css/SettingsDialog.module.css';
import React, {useEffect, useState} from 'react';
import {Button, Callout, Card, Checkbox, H3, H4, InputGroup, NonIdealState, Tag} from '@blueprintjs/core';

function Installation({guide}) {
    const [copyState, setCopyState] = useState('');
    if (!guide) return <p className="bp6-text-muted">No verified installation recipe is registered for this tool. Use your operating system or tool vendor’s installation instructions.</p>;
    return <>
        {guide.url && <Button size="small" icon="download" onClick={() => window.electron.system.openExternal(guide.url)}>Install / setup instructions</Button>}
        {guide.command && <div style={{display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', marginTop:8}}>
            <code style={{userSelect:'text', overflowWrap:'anywhere'}}>{guide.command}</code>
            <Button size="small" icon="clipboard" aria-label={`Copy install command for ${guide.label}`} onClick={async () => {
                try {await navigator.clipboard.writeText(guide.command); setCopyState('Copied. Run in your terminal.');}
                catch {setCopyState('Could not copy. Select and copy the command above.');}
            }}>Copy command</Button>
            <span role="status">{copyState}</span>
        </div>}
    </>;
}
export default function ToolsPanel() {
    const [inventory, setInventory] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
    const [search, setSearch] = useState(''), [missingOnly, setMissingOnly] = useState(false);
    async function refresh() {
        setBusy(true); setError('');
        try {
            const result = await window.electron.toolSettings.inspect();
            if (!result.success) {setError('Could not inspect local tools. Reopen Settings or try again.'); return;}
            setInventory(result.inventory);
        } catch {setError('Could not inspect local tools. Reopen Settings or try again.');}
        finally {setBusy(false);}
    }
    useEffect(() => {refresh();}, []);
    const query = search.trim().toLowerCase();
    const matches = tool => [tool.label, tool.id, ...tool.capabilities, ...tool.categories].join(' ').toLowerCase().includes(query);
    const tools = (inventory?.tools || []).filter(tool => matches(tool) && (!missingOnly || tool.status !== 'found'));
    const showX11 = inventory && (!query || ['x11','xquartz','xauth','display'].some(word => word.includes(query)));
    return <div className={styles['card-panel']} style={{display:'grid', gap:12, paddingBottom:16}}>
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', gap:12}}><H3 style={{margin:0}}>Tools & Prerequisites</H3><Button icon="refresh" loading={busy} disabled={busy} onClick={refresh}>Recheck tools</Button></div>
        <p>Tools used by process capabilities on this computer. Open the vendor’s installer instructions or copy a suggested command, then recheck. Installing a tool does not grant plugins access to it.</p>
        {inventory && <p className="bp6-text-muted">{({darwin:'macOS',win32:'Windows',linux:'Linux'})[inventory.platform] || inventory.platform} · Checked {new Date(inventory.checkedAt).toLocaleString()}. Detection checks executable files in host policy paths, without running them. It does not verify versions, sign-in, or service health.</p>}
        {error && <Callout intent="danger" role="alert">{error}</Callout>}
        <InputGroup leftIcon="search" aria-label="Search tools" placeholder="Search tools, categories or capabilities…" value={search} onChange={event => setSearch(event.target.value)}/>
        <Checkbox checked={missingOnly} onChange={event => setMissingOnly(event.target.checked)}>Only missing or unavailable tools</Checkbox>
        {showX11 && <Card>
            <H4>{inventory.x11.label} <Tag minimal intent={inventory.x11.supported ? 'none' : 'warning'}>{!inventory.x11.supported ? 'Unsupported by host' : inventory.x11.xauthFound ? 'xauth found · display not checked' : 'xauth not found'}</Tag></H4>
            <p>{inventory.x11.note}</p><Installation guide={inventory.x11}/>
        </Card>}
        {tools.map(tool => <Card key={tool.id}>
            <H4 style={{display:'flex', alignItems:'center', gap:8, marginBottom:8}}>{tool.label}<Tag minimal intent={tool.status === 'found' ? 'success' : tool.status === 'unavailable' ? 'warning' : 'none'}>{tool.status === 'found' ? 'Found' : tool.status === 'unsupported' ? 'No host policy paths for this OS' : tool.status === 'unavailable' ? 'Not accessible' : 'Not found'}</Tag></H4>
            <p className="bp6-text-muted">{tool.categories.join(' · ')}</p>
            {tool.status === 'unsupported' && <p>This capability has no executable locations configured for this operating system. Installation alone will not enable execution; configure a host process scope for the installed path.</p>}
            {tool.executable && <code style={{overflowWrap:'anywhere', userSelect:'text'}}>{tool.executable}</code>}
            <details style={{margin:'8px 0'}}><summary>Capabilities and checked locations</summary>
                <ul>{tool.capabilities.map(capability => <li key={capability}><code>{capability}</code></li>)}</ul>
                <ul>{tool.paths.map(candidate => <li key={candidate}><code style={{overflowWrap:'anywhere'}}>{candidate}</code></li>)}</ul>
            </details>
            <Installation guide={tool.installation}/>
        </Card>)}
        {inventory && !tools.length && !showX11 && <NonIdealState icon="search" title="No matching tools" description="Try another search or include installed tools."/>}
        <Callout compact icon="info-sign">After installing, restart FDO if your installer changed PATH or the desktop session. A missing optional tool is not an application error. Use the vendor’s instructions for your OS version and processor architecture.</Callout>
    </div>;
}
