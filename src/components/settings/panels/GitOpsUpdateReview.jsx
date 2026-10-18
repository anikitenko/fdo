import React,{useEffect,useState} from 'react';
import {Button,Callout,Checkbox,Dialog,DialogBody,DialogFooter,Tag} from '@blueprintjs/core';
import {getCapabilityPresentation} from '../../../utils/presentation/capabilityPresentation';

export default function GitOpsUpdateReview({pending,busy,onDecision}) {
    const [open,setOpen]=useState(false),[selected,setSelected]=useState([]),[error,setError]=useState('');
    useEffect(()=>{setSelected([]);setError('');},[pending.reviewId]);
    const decide=async decision=>{
        setError('');
        const result=await onDecision({pluginName:pending.name,reviewId:pending.reviewId,decision,capabilities:selected});
        if(result?.success===false)setError(result.error);else setOpen(false);
    };
    const complete=pending.addedCapabilities.every(capability=>selected.includes(capability));
    return <>
        <Callout intent="warning" icon="lock" title="Update awaiting approval">
            <p>Version {pending.version} is staged. Version {pending.currentVersion} remains installed and keeps its current activation state.</p>
            <Button size="small" icon="shield" disabled={busy} onClick={()=>setOpen(true)}>Review permissions</Button>
        </Callout>
        <Dialog isOpen={open} title={`Review update for ${pending.name}`} style={{width:640}} onClose={()=>!busy&&setOpen(false)} canOutsideClickClose={false} canEscapeKeyClose={!busy} isCloseButtonShown={!busy}>
            <DialogBody>
                <p>Current: <strong>{pending.currentVersion}</strong> · <code>{pending.currentCommit.slice(0,12)}</code><br/>Candidate: <strong>{pending.version}</strong> · <code>{pending.commit.slice(0,12)}</code></p>
                <p className="bp6-text-muted">{pending.repository} · {pending.targetRevision}</p>
                {pending.inspectionError?<Callout intent="danger" title="Permission declaration needs attention">{pending.inspectionError}</Callout>:<>
                    <h4>Additional permissions ({pending.addedCapabilities.length})</h4>
                    <p>Select each permission you explicitly approve. Existing grants and profile/target restrictions are preserved. Signing and repository access grant no permissions.</p>
                    {!pending.addedCapabilities.length&&<p>These permissions were granted separately. Approve this exact staged version to apply it.</p>}
                    {pending.addedCapabilities.map(capability=>{
                        const presentation=getCapabilityPresentation(capability);
                        return <Checkbox key={capability} disabled={busy} checked={selected.includes(capability)} onChange={event=>setSelected(previous=>event.target.checked?[...previous,capability]:previous.filter(value=>value!==capability))}>
                            <strong>{presentation.title}</strong> <code>{capability}</code><br/><span className="bp6-text-muted">{presentation.description}</span>
                        </Checkbox>;
                    })}
                    {!!pending.removedCapabilities?.length&&<><h4>No longer declared</h4><p>Existing grants remain until you change them in Manage Plugins.</p>{pending.removedCapabilities.map(capability=><Tag key={capability} style={{marginRight:4,marginBottom:4}}>{capability}</Tag>)}</>}
                    <p className="bp6-text-muted">Approval applies only to the staged commit above. If applying the update fails, FDO restores the previous version and grants.</p>
                </>}
                {error&&<Callout intent="danger" role="alert">{error}</Callout>}
            </DialogBody>
            <DialogFooter actions={<>
                <Button disabled={busy} onClick={()=>setOpen(false)}>Cancel</Button>
                <Button intent="danger" disabled={busy} onClick={()=>decide('decline')}>Decline this version</Button>
                <Button intent="primary" disabled={busy||!complete||!!pending.inspectionError} onClick={()=>decide('approve')}>{pending.addedCapabilities.length?'Grant listed permissions and update':'Apply reviewed update'}</Button>
            </>}/>
        </Dialog>
    </>;
}
