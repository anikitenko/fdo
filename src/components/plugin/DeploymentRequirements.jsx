import React, {useState} from 'react';
import PropTypes from 'prop-types';
import {Button,Callout,Dialog,DialogBody,DialogFooter,FormGroup,HTMLSelect,InputGroup,Checkbox,Tag} from '@blueprintjs/core';
import {createToolchainPlan} from '../../utils/plugins/exporting/toolchainPlan';
const plainDisclosure=({title,defaultOpen,children})=><details open={defaultOpen || undefined}><summary>{title}</summary>{children}</details>;
const clone=value=>JSON.parse(JSON.stringify(value));
const installer=(type,previous)=>type==='artifact'?{type,platforms:previous?.platforms || {'linux/amd64':{url:'',sha256:'',format:'file'}}}:type==='apt'?{type,packages:previous?.packages || []}:{type};
function ArtifactFields({value,onChange}) {
    const platforms=value.platforms || {};
    return <div>{['linux/amd64','linux/arm64'].map(platform=>{
        const artifact=platforms[platform];
        const change=patch=>onChange({...value,platforms:{...platforms,[platform]:{...artifact,...patch}}});
        return <fieldset key={platform} aria-label={platform} style={{margin:'8px 0',padding:10}}><Checkbox checked={!!artifact} label={platform} onChange={event=>{const next={...platforms};if(event.target.checked)next[platform]={url:'',sha256:'',format:'file'};else delete next[platform];onChange({...value,platforms:next});}}/>
            {artifact && <><FormGroup label="Public HTTPS artifact URL"><InputGroup aria-label="Public HTTPS artifact URL" value={artifact.url || ''} onChange={event=>change({url:event.target.value})}/></FormGroup>
                <FormGroup label="Publisher-verified SHA-256" helperText="Required. FDO has not downloaded this artifact; the image build verifies its bytes."><InputGroup aria-label="Publisher-verified SHA-256" value={artifact.sha256 || ''} onChange={event=>change({sha256:event.target.value})}/></FormGroup>
                <FormGroup label="Artifact format"><HTMLSelect aria-label="Artifact format" value={artifact.format} options={['file','tar.gz','zip']} onChange={event=>change({format:event.target.value,...(event.target.value==='file'?{member:undefined}:{member:artifact.member || ''})})}/></FormGroup>
                {artifact.format!=='file' && <FormGroup label="Executable member inside archive"><InputGroup aria-label="Executable member inside archive" value={artifact.member || ''} onChange={event=>change({member:event.target.value})}/></FormGroup>}</>}
        </fieldset>;
    })}</div>;
}
export default function DeploymentRequirements({context,disabled=false,onReview,onAsk,onOpenSource,onManage,disclosureComponent:Disclosure=plainDisclosure}) {
    const [open,setOpen]=useState(false),[rows,setRows]=useState([]),[baseImage,setBaseImage]=useState(''),[selection,setSelection]=useState(''),[notice,setNotice]=useState(''),[actionError,setActionError]=useState(''),[busy,setBusy]=useState(false),[baseIdentity,setBaseIdentity]=useState('');
    if(!context)return null;
    const choices=Object.entries(context.catalog.tools).sort(([a],[b])=>a.localeCompare(b));
    const identity=JSON.stringify(context.declaration),working=disabled || busy;
    const show=(suggested=false)=>{const declaration=context.declaration || {schemaVersion:context.catalog.schemaVersion,tools:[]};setRows(clone(declaration.tools || []));if(suggested)setRows(current=>[...current,...context.suggestions.filter(item=>!current.some(tool=>tool.id===item.id)).map(item=>({id:item.id}))]);setBaseImage(declaration.baseImage || '');setBaseIdentity(identity);setSelection(choices[0]?.[0] || '');setNotice('');setOpen(true);};
    const declaration={schemaVersion:context.catalog.schemaVersion,tools:rows,...(baseImage.trim()?{baseImage:baseImage.trim()}:{})};
    let invalid='';try{createToolchainPlan(JSON.stringify({fdo:{deployment:declaration}}),[]);}catch(error){invalid=error.message;}
    if(open && baseIdentity!==identity)invalid='The workspace declaration changed. Close and reopen this editor before reviewing changes.';
    const change=(index,patch)=>setRows(current=>current.map((row,i)=>i===index?{...row,...patch}:row));
    const preview=async()=>{setBusy(true);setNotice('');try{const result=await onReview({kind:'deployment',declaration});if(result?.status==='ready')setOpen(false);else setNotice(String(result?.message || 'The requirements could not be prepared.').replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/,''));}catch(error){setNotice(String(error.message).replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/,''));}finally{setBusy(false);}};
    const title=context.status==='invalid'?'Deployment requirements · declaration needs attention':context.status==='needs-declaration'?'Deployment requirements · tools not declared':`Deployment requirements · ${context.tools.length} declared tool${context.tools.length===1?'':'s'}`;
    return <section aria-label="Plugin deployment requirements"><Disclosure title={title} icon="box" description="CLI dependencies, installation, authentication and cloud permissions" defaultOpen={['invalid','needs-declaration','needs-review'].includes(context.status)}>
        <p>Tool requirements are part of the plugin source. Installation, cloud sign-in and resource permissions are verified in the deployment environment.</p>
        <p>Web export {context.catalog.exportContractVersion} · Tool schema {context.catalog.schemaVersion} · Default image <code>{context.catalog.baseImage}</code></p>
        <div style={{display:'flex',gap:8,flexWrap:'wrap',margin:'10px 0'}}>
            {onReview && <Button icon="edit" disabled={working || !context.editable} onClick={()=>show()}>Manage deployment requirements</Button>}
            {onReview && !!context.suggestions.length && <Button icon="add" disabled={working || !context.editable} onClick={()=>show(true)}>Review detected tools</Button>}
            {!onReview && onManage && <Button icon="edit" disabled={working} onClick={onManage}>Manage in Live UI</Button>}
            {onAsk && <Button icon="predictive-analysis" disabled={working || !context.packageAvailable} onClick={async()=>{setActionError('');try{await onAsk();}catch(error){setActionError(String(error.message).replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/,''));}}}>Prepare AI deployment review</Button>}
            {onOpenSource && <Button icon="code" disabled={working} onClick={onOpenSource}>Open package.json</Button>}
        </div>
        {!!context.errors.length && <Callout intent="warning" title="Declaration needs attention">{context.errors.map(error=><p key={error}>{error}</p>)}</Callout>}
        {!context.declaration && <p>{context.processDetected?'This source uses scoped processes. Review the actual tools required; permitted executables are not an installation list.':'No CLI calls were detected in editable source. Dynamic or external code may need an explicit declaration.'}</p>}
        <ul>{context.tools.map(tool=><li key={tool.id}><strong>{tool.id}</strong> <code>{tool.version}</code> · {tool.installer?.type==='provided'?'Provided by image':tool.installer?.type==='artifact'?'Checksum-verified artifact at build':tool.installer?.type==='apt'?'Debian package':'Trusted catalog installer'}</li>)}</ul>
        {!!context.suggestions.length && <Callout intent="primary" title="Source references to review"><ul>{context.suggestions.map(item=><li key={item.id}>{item.id} · <code>{item.path}:{item.line}</code> · {item.confirmed?'literal CLI call':'source default; verify runtime use'}</li>)}</ul></Callout>}
        {!!context.usage?.some(item=>item.dynamic) && <details><summary>Dynamic CLI choices need source review</summary><p>These command expressions are not executed or resolved by the editor. Check the active settings or preset before declaring the required binary.</p><ul>{context.usage.filter(item=>item.dynamic).map((item,index)=><li key={index}><code>{item.path}:{item.line}</code> · <code>{item.expression}</code></li>)}</ul></details>}
        {!!context.unknownCalls?.length && <Callout intent="warning" title="Custom tool definition required">{context.unknownCalls.map(item=><p key={item.path+':'+item.line}><code>{item.command}</code> at {item.path}:{item.line}. Choose a package, verified artifact or provided executable; AI cannot invent publisher trust.</p>)}</Callout>}
        <p><Tag minimal>Declaration: {context.status==='declared'?'checked':context.status}</Tag>{' '}<Tag minimal>Installation: not run here</Tag>{context.authentication.length>0 && <>{' '}<Tag minimal>Cloud sign-in / roles: not verified</Tag></>}</p>
        {context.authentication.map(auth=><details key={auth.provider}><summary>{auth.toolId} authentication · not verified</summary>
            <p>Application sign-in and CLI identity are separate. CLI state: <code>{auth.stateDirectory}</code>.</p>
            {auth.guidance && <><p>For a running local export:</p><pre>{[auth.guidance.interactive,auth.guidance.subscription,auth.guidance.verify].map(command=>'docker compose exec application '+command).join('\n')}</pre>
                <p>If the backend needs authentication before it starts, use <code>docker compose run --rm --no-deps application</code> with the same CLI commands, then start the app.</p><p>{auth.guidance.production}</p><p>{auth.guidance.state}</p></>}
        </details>)}
        <p>{context.nextStep} Use <code>node tools.cjs check</code> in the exported project to check executable availability and versions. A successful source build or preview does not verify deployment access.</p>
        {actionError && <Callout intent="danger" role="alert">{actionError}</Callout>}
        {open && <Dialog isOpen title="Manage deployment requirements" className="bp6-dark" style={{width:760,maxWidth:'calc(100vw - 32px)'}} onClose={()=>!busy && setOpen(false)} canOutsideClickClose={!busy} canEscapeKeyClose={!busy}>
            <DialogBody><fieldset disabled={working} style={{border:0,padding:0,minWidth:0}}>
                <p>Changes are reviewed as a package.json-only draft. No installer, login, permission change or cloud operation runs here.</p>
                <FormGroup label="Catalog tool"><HTMLSelect aria-label="Catalog tool" fill value={selection} options={choices.map(([id,tool])=>({value:id,label:id+' · '+tool.version}))} onChange={event=>setSelection(event.target.value)}/></FormGroup>
                <Button icon="add" disabled={!selection || rows.some(row=>row.id===selection)} onClick={()=>setRows(current=>[...current,{id:selection}])}>Add catalog tool</Button>{' '}
                <Button icon="add" onClick={()=>{let id='custom-tool';while(rows.some(row=>row.id===id))id+='-new';setRows(current=>[...current,{id,command:'my-cli',version:'*',executable:'/usr/bin/my-cli',installer:{type:'apt',packages:[]}}]);}}>Add custom tool</Button>
                {!rows.length && <p>An empty list explicitly declares no additional CLI dependencies. Verify that this matches the source.</p>}
                {rows.map((row,index)=>{const custom=!!row.installer;return <fieldset key={index} aria-label={'Tool '+(index+1)} style={{margin:'12px 0',padding:12,border:'1px solid #5f6b7c',borderRadius:6}}>
                    <div style={{display:'flex',justifyContent:'space-between',gap:8}}><strong>{row.id}</strong><Button icon="trash" intent="danger" variant="minimal" aria-label={'Remove '+row.id} onClick={()=>setRows(current=>current.filter((_,i)=>i!==index))}/></div>
                    {custom && <><FormGroup label="Tool ID"><InputGroup aria-label="Tool ID" value={row.id} onChange={event=>change(index,{id:event.target.value})}/></FormGroup><FormGroup label="Command basename"><InputGroup aria-label="Command basename" value={row.command || ''} onChange={event=>change(index,{command:event.target.value})}/></FormGroup></>}
                    <FormGroup label={'Version constraint for '+row.id} helperText="Optional. Empty uses the current host catalog default; the image build checks the actual version."><InputGroup aria-label={'Version constraint for '+row.id} value={row.version || ''} placeholder={context.catalog.tools[row.id]?.version || '*'} onChange={event=>{const next={...row};if(event.target.value)next.version=event.target.value;else delete next.version;setRows(current=>current.map((item,i)=>i===index?next:item));}}/></FormGroup>
                    {custom && <><FormGroup label="Installation"><HTMLSelect aria-label="Installation" value={row.installer.type} options={[{value:'apt',label:'Debian package'},{value:'artifact',label:'Verified executable artifact'},{value:'provided',label:'Provided by image'}]} onChange={event=>change(index,{installer:installer(event.target.value,row.installer)})}/></FormGroup>
                        {row.installer.type==='artifact'?<ArtifactFields value={row.installer} onChange={value=>change(index,{installer:value})}/>:<FormGroup label="Installed executable path"><InputGroup aria-label="Installed executable path" value={row.executable || ''} onChange={event=>change(index,{executable:event.target.value})}/></FormGroup>}
                        {row.installer.type==='apt' && <FormGroup label="Debian packages (comma separated)"><InputGroup aria-label="Debian packages (comma separated)" value={(Array.isArray(row.installer.packages)?row.installer.packages:[]).join(', ')} onChange={event=>change(index,{installer:{type:'apt',packages:event.target.value.split(',').map(item=>item.trim()).filter(Boolean)}})}/></FormGroup>}
                        <FormGroup label="Version check arguments (space separated)" helperText="Use only a non-mutating version command; authentication is separate."><InputGroup aria-label="Version check arguments (space separated)" value={(Array.isArray(row.versionArgs)?row.versionArgs:['--version']).join(' ')} onChange={event=>change(index,{versionArgs:event.target.value.split(/\s+/).filter(Boolean)})}/></FormGroup>
                        {row.installer.type==='provided' && <p>The selected image must contain this executable. Its version is still checked; “provided” does not bypass verification.</p>}
                    </>}
                </fieldset>;})}
                <FormGroup label="Custom base image (optional)" helperText="Keep empty for the host default. Custom images require an immutable @sha256 digest, Node 24, Debian bookworm and the node user."><InputGroup aria-label="Custom base image (optional)" value={baseImage} placeholder={context.catalog.baseImage} onChange={event=>setBaseImage(event.target.value)}/></FormGroup>
                {invalid && <Callout intent="warning" role="alert">{invalid}</Callout>}
                {notice && <Callout intent="danger" role="alert">{notice}</Callout>}
                <details><summary>Declaration to review</summary><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(declaration,null,2)}</pre></details>
            </fieldset></DialogBody>
            <DialogFooter actions={<><Button disabled={busy} onClick={()=>setOpen(false)}>Cancel</Button><Button intent="primary" loading={busy} disabled={working || !!invalid} onClick={preview}>Preview deployment changes</Button></>}/>
        </Dialog>}
    </Disclosure></section>;
}
DeploymentRequirements.propTypes={context:PropTypes.object,disabled:PropTypes.bool,onReview:PropTypes.func,onAsk:PropTypes.func,onOpenSource:PropTypes.func,onManage:PropTypes.func,disclosureComponent:PropTypes.elementType};
