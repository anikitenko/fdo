import React,{useEffect,useRef,useState} from 'react';
import {Button,Callout,Dialog,DialogBody,DialogFooter,FormGroup,HTMLSelect,HTMLTable,Spinner,Tag} from '@blueprintjs/core';
import {attachWebExportRecovery,migrationBrief} from '../../utils/plugins/exporting/webExportRecovery';

export default function PluginExportDialog({plugin,onClose,onReviewCapabilities}) {
    const [format,setFormat]=useState('archive'),[review,setReview]=useState(null),[reviewing,setReviewing]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState('');
    const generation=useRef(0);
    const [notice,setNotice]=useState(''),[opening,setOpening]=useState(false);
    useEffect(()=>()=>{generation.current++;},[]);
    const inspect=async()=>{
        const current=++generation.current;setReviewing(true);setError('');setReview(null);setSaved('');setNotice('');
        try{const result=await window.electron.plugin.previewExport(plugin.id);if(current!==generation.current)return;
            if(!result?.success){setError(result?.error || 'The plugin could not be reviewed.');return;}setReview(result);
        }catch(failure){if(current===generation.current)setError(failure.message);}
        finally{if(current===generation.current)setReviewing(false);}
    };
    const choose=value=>{setFormat(value);setSaved('');setError('');setNotice('');if(value==='web' && !review && !reviewing)void inspect();};
    const save=async kind=>{
        setSaving(true);setError('');setSaved('');setNotice('');
        try {
            const result=await window.electron.plugin.exportAs(plugin.id,{format:kind,token:review?.token});
            if(!result?.success){setError(result?.error || 'The export could not be saved.');return;}
            if(!result.canceled)setSaved(result.path);
        }catch(failure){setError(failure.message);}
        finally{setSaving(false);}
    };
    const report=review?.report,blocked=!!report?.blockers.length;
    const recovery=report?.recovery || (report?attachWebExportRecovery({...report}).recovery:null);
    const copyBrief=async()=>{
        setError('');setSaved('');
        try{await navigator.clipboard.writeText(migrationBrief({...report,recovery},plugin.name));setNotice('Migration brief copied. It is also included in the migration work package.');}
        catch{setError('The brief could not be copied. Export the migration work package to get the same plan as a file.');}
    };
    const openSource=async()=>{
        setOpening(true);setError('');setSaved('');
        try {const result=await window.electron.system.openPluginInEditor('builtin',plugin.id);if(!result?.success){setError(result?.error || 'The plugin source could not be opened.');return;}
            setNotice('Source opened in the IDE. Save and deploy source edits before reviewing the installed version. For GitOps, update and synchronize the repository.');
        }catch(failure){setError(failure.message);}finally{setOpening(false);}
    };
    const groups=Object.values((report?.requirements || []).reduce((result,item)=>{
        const group=result[item.adapter] || (result[item.adapter]={...item,capabilities:[]});group.capabilities.push(item.capability);return result;
    },{}));
    return <Dialog isOpen title={'Export As · '+plugin.name} onClose={onClose} canOutsideClickClose={!saving} canEscapeKeyClose={!saving} isCloseButtonShown={!saving}
        style={{width:800,maxWidth:'calc(100vw - 32px)'}}>
        <DialogBody>
            <FormGroup label="Export format" labelFor="plugin-export-format">
                <HTMLSelect id="plugin-export-format" fill value={format} disabled={saving} onChange={event=>choose(event.target.value)} options={[
                    {value:'archive',label:'FDO plugin archive (.zip)'},
                    {value:'web',label:'Standalone web application / Docker (.zip)'},
                ]}/>
            </FormGroup>
            {format==='archive'?<p>Export the plugin project and its compiled bundle for use in FDO.</p>:<>
                <Callout intent="primary" title="Frontend + backend, independent of FDO">
                    Converted source with Docker packaging and templates for AWS ECS, Azure Container Apps and Google Cloud Run. Runs without Electron or an installed FDO SDK.
                </Callout>
                <p>The export carries the public host contract and approved capability policies. Configure deployment services and cloud access independently; desktop credentials and data stay here.</p>
                {reviewing && <div role="status" style={{display:'flex',gap:12,alignItems:'center',padding:16}}><Spinner size={20}/>Checking conversion and building the application…</div>}
                {report && <>
                    <Callout intent={blocked?'warning':'success'} title={blocked?'Web migration required':'Application conversion prepared'}>
                        {blocked?recovery.summary:'Includes Dockerfile, docker-compose.yml, frontend and backend. Extract the ZIP and run sh start.sh. Review service credentials and volume mappings for your deployment.'}
                    </Callout>
                    {blocked && <>
                        <p>{recovery.unchanged}</p>
                        <Callout title="Continue in a separate migration workspace" style={{marginTop:12}}>
                            Export a source copy with a migration plan and verification steps. This work package is not deployable. Discarding it leaves the installed plugin untouched.
                        </Callout>
                        <div style={{display:'flex',flexWrap:'wrap',gap:8,margin:'12px 0'}}>
                            <Button icon="clipboard" disabled={saving} onClick={copyBrief}>Copy migration brief</Button>
                            <Button icon="code" disabled={saving || opening} loading={opening} onClick={openSource}>Open plugin source</Button>
                            {recovery.tasks.some(task=>task.kind==='permission') && onReviewCapabilities && <Button icon="lock" disabled={saving} onClick={onReviewCapabilities}>Review capabilities</Button>}
                        </div>
                        <section aria-label="Migration tasks">
                            {recovery.tasks.map((task,index)=><details key={task.id} open={index===0 || undefined} style={{margin:'10px 0',padding:10,border:'1px solid #b6c2cd',borderRadius:6}}>
                                <summary style={{cursor:'pointer',fontWeight:600}}>{task.title} <Tag minimal intent={task.kind==='exporter'?'warning':'primary'}>{task.kind==='exporter'?'Exporter / backend work':task.kind==='permission'?'Permission review':'Source change'}</Tag></summary>
                                <p><strong>Owner:</strong> {task.owner}</p><p style={{overflowWrap:'anywhere'}}>{task.message}</p>
                                {!!task.locations?.length && <p style={{overflowWrap:'anywhere'}}>Source: {task.locations.map(item=>(item.file || item.path)+':'+item.line).join(', ')}</p>}
                                {!!task.capabilities?.length && <p style={{overflowWrap:'anywhere'}}>Capabilities: <code>{task.capabilities.join(', ')}</code></p>}
                                <ol>{task.steps.map(step=><li key={step} style={{marginBottom:5}}>{step}</li>)}</ol>
                                <details><summary style={{cursor:'pointer'}}>Verify this work</summary><ul>{task.verify.map(item=><li key={item}>{item}</li>)}</ul></details>
                                <p><strong>Review again:</strong> {task.reviewWhen}</p>
                            </details>)}
                        </section>
                        <p className="bp6-text-muted">Review installed version rechecks source and grants. It does not write code, approve permissions or implement adapters.</p>
                    </>}
                    {report.toolchain && <details open={!!report.toolchain.warnings?.length || undefined} style={{marginTop:12}}>
                        <summary style={{cursor:'pointer'}}>Container CLI tools · {report.toolchain.tools.length} requirements{report.toolchain.warnings?.length?' · configuration required':''}</summary>
                        <p>Base image: <code>{report.toolchain.baseImage}</code></p>
                        <p>Tool installation and version checks run during the image build. Installing a tool does not grant permission to execute it.</p>
                        <HTMLTable compact striped style={{width:'100%'}}><thead><tr><th>Tool</th><th>Version</th><th>Installation</th></tr></thead>
                            <tbody>{report.toolchain.tools.map(tool=><tr key={tool.id}><td>{tool.id}{tool.authentication && <div className="bp6-text-muted">Authenticate separately: {tool.authentication.methods.join(', ')}</div>}</td><td><code>{tool.version}</code></td><td>{tool.installer?.type==='provided'?'Included in base image':tool.installer?.type==='artifact'?'Verified artifact':tool.installer?.type==='apt'?'Debian package':tool.installer?.type==='azure-cli'?'Microsoft package':'Installer definition required'}{tool.installer?.packages && <div><code>{tool.installer.packages.join(', ')}</code></div>}{tool.installer?.packageVersion && <div><code>{tool.installer.packageVersion}</code></div>}{tool.installer?.platforms && <details><summary>Artifact sources</summary>{Object.entries(tool.installer.platforms).map(([platform,artifact])=><p key={platform} style={{overflowWrap:'anywhere'}}>{platform}: {artifact.url}<br/><code>SHA-256: {artifact.sha256}</code></p>)}</details>}<div className="bp6-text-muted">{{declared:'Plugin declaration','declared-custom':'Custom dependency','inferred-single-tool-scope':'Inferred from approved scope',provided:'Base toolchain'}[tool.source] || tool.source}</div></td></tr>)}</tbody>
                        </HTMLTable>
                        {!!report.toolchain.unresolved.length && <ul>{report.toolchain.unresolved.map(item=><li key={item.scope}><strong>{item.scope}</strong>: {item.reason}</li>)}</ul>}
                        {!!report.toolchain.warnings?.length && <Callout intent="warning" title="Complete tool requirements before building">Declare the required tools in package.json under <code>fdo.deployment.tools</code> and export again, or complete <code>deployment/toolchain.json</code> in this project.</Callout>}
                        <Button icon="code" disabled={saving || opening} loading={opening} onClick={openSource}>Edit plugin tool requirements</Button>
                        <p>Run <code>node tools.cjs check</code> to inspect availability and versions. Credentials and cloud roles are configured independently.</p>
                    </details>}
                    {report.analysis && <details style={{marginTop:12}}><summary style={{cursor:'pointer'}}>Analysis scope · {report.analysis.included.length} runtime files · {report.analysis.excluded.length} unimported files excluded</summary>
                        <p>Only dependencies of <code>{report.analysis.entry}</code> affect conversion. Imported scripts are checked too.</p>
                        {!!report.analysis.excluded.length && <p style={{maxHeight:120,overflow:'auto',overflowWrap:'anywhere'}}>Excluded: {report.analysis.excluded.join(', ')}</p>}
                    </details>}
                    <details style={{marginTop:16}}><summary style={{cursor:'pointer'}}>Capabilities and services · {report.requirements.length} permissions · contract {report.contractVersion}</summary>
                        <div style={{maxHeight:260,overflow:'auto',marginTop:8}}><HTMLTable striped compact style={{width:'100%'}}>
                            <thead><tr><th style={{width:'36%',minWidth:190}}>Capability / service</th><th>Conversion</th></tr></thead>
                            <tbody>{groups.map(item=><tr key={item.adapter}><td style={{width:'36%',minWidth:190,overflowWrap:'anywhere'}}>{item.capabilities.map(capability=><div key={capability}><code>{capability}</code></div>)}</td><td><Tag minimal intent={item.status==='blocked'?'warning':item.status==='supported'?'success':'primary'}>{item.status==='configuration'?'Configuration required':item.status==='blocked'?'Adapter required':'Supported'}</Tag><p style={{margin:'6px 0'}}>{item.description}</p></td></tr>)}
                            {report.adapters.filter(adapter=>!report.requirements.some(item=>item.adapter===adapter.id)).map(adapter=><tr key={adapter.id}><td>{adapter.id}</td><td>{adapter.description}</td></tr>)}
                            {!report.requirements.length && !report.adapters.length && <tr><td colSpan={2}>No privileged capabilities or host services were detected.</td></tr>}</tbody>
                        </HTMLTable></div>
                    </details>
                    <details style={{marginTop:12}}><summary style={{cursor:'pointer'}}>Deployment notes</summary><ul>{report.warnings.map(message=><li key={message}>{message}</li>)}</ul></details>
                </>}
                <div style={{display:'flex',gap:8,marginTop:16}}><Button icon="refresh" disabled={saving || reviewing} onClick={inspect}>Review installed version</Button>
                    <Button icon="document" disabled={saving || !review || reviewing} onClick={()=>save('report')}>Save conversion report</Button></div>
            </>}
            {error && <Callout intent="danger" role="alert" style={{marginTop:16}}>{error}</Callout>}
            {saved && <Callout intent="success" role="status" style={{marginTop:16}}>Saved to <span style={{overflowWrap:'anywhere'}}>{saved}</span></Callout>}
            {notice && <Callout intent="primary" role="status" style={{marginTop:16}}>{notice}</Callout>}
        </DialogBody>
        <DialogFooter actions={<><Button disabled={saving} onClick={onClose}>Close</Button><Button intent="primary" icon="export" loading={saving}
            disabled={saving || format==='web' && (reviewing || !report || blocked)} onClick={()=>save(format)}>{format==='web'?'Export web application':'Export plugin archive'}</Button>
            {format==='web' && blocked && <Button intent="primary" icon="archive" disabled={saving || reviewing} loading={saving} onClick={()=>save('migration')}>Export migration work package</Button>}</>}/>
    </Dialog>;
}
