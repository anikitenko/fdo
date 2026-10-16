import React, {useEffect,useState} from 'react';
import {Button,FormGroup,HTMLSelect,InputGroup} from '@blueprintjs/core';
import {EditorSection} from './EditorSection';
import {SDK_MOTION_PRESETS,SDK_MOTION_EASINGS} from '../../utils/plugins/authoring/liveUi/sdkComponentMotion';
export function SdkComponentMotion({element,disabled,onPropose}) {
    const motion=element.sdkComponent.motion;
    const [preset,setPreset]=useState(motion?.preset || 'none'),[duration,setDuration]=useState(String(motion?.duration || 180)),[easing,setEasing]=useState(motion?.easing || 'ease-out');
    useEffect(()=>{setPreset(motion?.preset || 'none');setDuration(String(motion?.duration || 180));setEasing(motion?.easing || 'ease-out');},[motion]);
    if(!motion) return null;
    const blocked=disabled || !element.structure?.unique || !!element.sdkComponent.reason || !motion.editable;
    const invalid=preset !== 'none' && (!/^\d+$/.test(duration) || Number(duration)<50 || Number(duration)>2000);
    const changed=!blocked && !invalid && (preset !== motion.preset || (preset !== 'none' && (Number(duration)!==motion.duration || easing!==motion.easing)));
    const preview=()=>{if(changed) onPropose({kind:'component-motion',preset,duration:Number(duration),easing});};
    return <EditorSection title="Component motion" icon="play" description="Opening and closing transitions">
        <p className="bp6-text-muted">{motion.reason || 'Saved in this component’s styles. Presets respect reduced-motion preferences and keep controller-owned visibility and positioning intact.'}</p>
        <FormGroup label="Motion preset" labelFor="sdk-motion-preset"><HTMLSelect id="sdk-motion-preset" fill value={preset} disabled={blocked} options={SDK_MOTION_PRESETS} onChange={event=>setPreset(event.target.value)}/></FormGroup>
        <FormGroup label="Duration (ms)" labelFor="sdk-motion-duration" intent={invalid ? 'danger' : 'none'} helperText={invalid ? 'Enter a whole number from 50 to 2000 milliseconds.' : '50–2000 milliseconds.'}><InputGroup id="sdk-motion-duration" type="number" min={50} max={2000} step={10} value={duration} disabled={blocked || preset==='none'} aria-invalid={!!invalid} onValueChange={setDuration} onKeyDown={event=>{if(event.key==='Enter' && !event.repeat && !event.nativeEvent.isComposing){event.preventDefault();preview();}}}/></FormGroup>
        <FormGroup label="Motion easing" labelFor="sdk-motion-easing"><HTMLSelect id="sdk-motion-easing" fill value={easing} disabled={blocked || preset==='none'} options={SDK_MOTION_EASINGS} onChange={event=>setEasing(event.target.value)}/></FormGroup>
        <Button fill icon="eye-open" disabled={!changed} onClick={preview}>Preview motion</Button>
        <p className="bp6-text-muted">Use Replay entrance above the canvas to replay the selected overlay. None removes a preset created here. Custom or shared motion remains editable in code.</p>
    </EditorSection>;
}
