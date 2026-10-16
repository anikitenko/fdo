import {sdkStyleContext} from './sdkComponentAppearance';
export const SDK_MOTION_PRESETS = [{value:'none',label:'None'},{value:'fade',label:'Fade'},{value:'scale',label:'Fade and scale'},{value:'slide',label:'Fade and slide'}];
export const SDK_MOTION_EASINGS = ['ease','ease-in','ease-out','ease-in-out','linear'];
const transforms={fade:'none',scale:'scale(0.96)',slide:'translateY(8px)'};
export function sdkMotionStyle(identity,preset,duration,easing) {
    if (!Object.hasOwn(transforms,preset) || !Number.isInteger(duration) || duration<50 || duration>2000 || !SDK_MOTION_EASINGS.includes(easing)) throw new Error('Choose fade, scale or slide, a duration from 50 to 2000 ms and a supported easing.');
    const state=identity === 'fdo.popover' ? '&:popover-open' : '&[open]';
    const initial={opacity:'0',transform:transforms[preset]};
    return {...initial,transition:`opacity ${duration}ms ${easing}, transform ${duration}ms ${easing}, display ${duration}ms allow-discrete, overlay ${duration}ms allow-discrete`,
        [state]:{opacity:'1',transform:'none'},'@starting-style':{[state]:initial},
        '@media (prefers-reduced-motion: reduce)':{transition:'none',transform:'none'}};
}
const canonical=value=>JSON.stringify(value,(_,item)=>item && typeof item==='object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))) : item);
export function describeSdkMotion(node,file,definition,values) {
    if (!['fdo.dialog','fdo.confirmation-dialog','fdo.popover'].includes(definition.identity)) return null;
    const {root,options,style,styleFields,writable}=sdkStyleContext(node);
    const group=styleFields?.get('&'), value=values?.options?.style?.['&'];
    const match=/^opacity (\d+)ms (ease|ease-in|ease-out|ease-in-out|linear),/.exec(value?.transition || '');
    const duration=match ? Number(match[1]) : 180,easing=match?.[2] || 'ease-out';
    const preset=Object.keys(transforms).find(key=>transforms[key]===value?.transform) || 'none';
    let managed=false;
    try {managed=!!match && canonical(value)===canonical(sdkMotionStyle(definition.identity,preset,duration,easing));} catch { /* Unknown author styles stay untouched. */ }
    const custom=!!group && group.type !== 'NullLiteral' && !managed;
    const conflicting=styleFields && [...styleFields.keys()].some(key=>key !== '&' && /^(?:animation|transition|opacity|transform|translate|scale|rotate|@starting-style)|\[open]|:popover-open/.test(key));
    const editable=writable && !custom && !conflicting;
    const container=style || options || root;
    return {file,editable,reason:editable ? '' : 'Custom animation or computed/shared styles are preserved. Edit motion in the IDE.',
        preset:managed ? preset : 'none',duration,easing,managed,
        start:group?.start ?? container.start+1,end:group?.end ?? container.start+1,insert:!group,missingStyle:!style,missingOptions:!options};
}
export function planSdkMotion(element,request) {
    const target=element.sdkComponent?.motion;
    if (!element.structure?.unique || element.sdkComponent?.reason || !target?.editable) throw new Error(target?.reason || 'Select a unique SDK component with literal styles.');
    const removing=request.preset==='none';
    if(removing && !target.managed) throw new Error('There is no managed motion preset to remove.');
    let replacement=removing ? 'null' : JSON.stringify(sdkMotionStyle(element.sdkComponent.identity,request.preset,request.duration,request.easing));
    if(target.insert) {
        replacement='"&": ' + replacement + ', ';
        if(target.missingStyle) replacement='"style": {' + replacement + '}, ';
        if(target.missingOptions) replacement='"options": {' + replacement + '}, ';
    }
    return {...target,replacement,description:(removing ? 'Remove' : 'Set') + ' ' + element.sdkComponent.name + ' motion',affected:1};
}
