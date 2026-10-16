import {sourceNodeRemovalRanges} from './sourceRanges';
const fieldsOf=node=>{
    if(node?.type!=='ObjectExpression' || node.properties.some(item=>item.type!=='ObjectProperty' || item.computed || item.method)) return null;
    const entries=node.properties.map(item=>[item.key.name ?? item.key.value,item.value]);
    return new Set(entries.map(([key])=>key)).size===entries.length ? new Map(entries) : null;
};
const literalData=node=>['StringLiteral','NumericLiteral','BooleanLiteral','NullLiteral'].includes(node?.type)
    || node?.type==='ArrayExpression' && node.elements.every(literalData)
    || node?.type==='ObjectExpression' && !!fieldsOf(node) && node.properties.every(item=>literalData(item.value));
export function toastProgressError(value,hasExternalLabel=false) {
    if(!value || Object.keys(value).sort().join(',')!=='label,max,value') return 'Supply a progress label, value and maximum.';
    if(typeof value.label!=='string' || !value.label.trim() && !hasExternalLabel || value.label.length>2000 || /[\r\n\u0000-\u001f]/.test(value.label)) return 'Use a progress label of up to 2,000 characters on one line.';
    if(typeof value.max!=='number' || !Number.isFinite(value.max) || value.max<=0) return 'Maximum must be a finite number greater than zero.';
    if(value.value!==null && (typeof value.value!=='number' || !Number.isFinite(value.value) || value.value<0 || value.value>value.max)) return 'Value must be between zero and the maximum, or empty for indeterminate progress.';
    return '';
}
export function describeToastProgress(node,file,definition,values,source,files) {
    if(definition.identity!=='fdo.toast' || !definition.editableProperties?.some(item=>item.name==='progress' && item.kind==='component-options')) return null;
    const root=node.arguments[1],rootFields=fieldsOf(root),progress=rootFields?.get('progress'),fields=fieldsOf(progress);
    const reason=!rootFields || progress && !fields ? 'Shared, computed or ambiguous progress options stay in the IDE.' : '';
    const known=values.progress || {},value={label:known.label ?? '',value:known.value ?? null,max:known.max ?? 100};
    const properties=['label','value','max'].map(name=>{
        const field=fields?.get(name);
        const types=name==='label' ? ['StringLiteral'] : name==='value' ? ['NumericLiteral','NullLiteral'] : ['NumericLiteral'];
        return {name,editable:!reason && (!field || types.includes(field.type)),insert:!field,start:field?.start ?? progress?.start+1,end:field?.end ?? progress?.start+1};
    });
    const derivedId=typeof values.id==='string' ? values.id+'-progress' : '';
    const referenced=Object.values(files).some(code=>/\bsetProgress\b/.test(code) || derivedId && code.includes(derivedId));
    const property=root?.properties?.find(item=>(item.key?.name ?? item.key?.value)==='progress');
    const collision=!progress && derivedId && Object.values(files).some(code=>code.includes(derivedId));
    const literalId=rootFields?.get('id')?.type==='StringLiteral';
    const computed=!!progress && !literalData(progress);
    return {file,present:!!progress,editable:!reason,reason,value,properties,hasExternalLabel:!!known.ariaLabelledBy,
        canAdd:!progress && !reason && literalId && !collision,
        addReason:reason || (!literalId ? 'Use a unique literal toast ID before adding composed progress.' : collision ? 'The derived progress ID is already referenced in the workspace. Review it in the IDE.' : ''),
        addAt:root?.start+1,removable:!!progress && !reason && !referenced && !computed,
        removeReason:reason || (computed ? 'Computed progress fields or nested options are preserved. Remove them in the IDE while updating their declarations and consumers.' : referenced ? 'Progress updates or its derived ID are referenced in the workspace. Update those consumers in the IDE before removing it.' : ''),
        removals:property && rootFields ? sourceNodeRemovalRanges(source,root.properties,property,root.end-1) : []};
}
export function planToastProgress(files,element,request) {
    const component=element.sdkComponent,target=component?.toastProgress;
    if(!element.structure?.unique || component?.reason || !target?.editable) throw new Error(target?.reason || 'Select a unique Toast with literal composition options.');
    const before=files[target.file];let edits;
    if(request.action==='add') {
        if(!target.canAdd) throw new Error(target.addReason || 'This toast already has progress.');
        edits=[{start:target.addAt,end:target.addAt,value:'"progress":{"label":"Progress","value":null,"max":100},'}];
    } else if(request.action==='remove') {
        if(!target.removable) throw new Error(target.removeReason || 'This toast has no removable composed progress.');
        edits=target.removals.map(range=>({...range,value:''}));
    } else if(request.action==='update') {
        if(!target.present) throw new Error('Add progress first.');
        const error=toastProgressError(request.value,target.hasExternalLabel);if(error) throw new Error(error);
        edits=target.properties.filter(field=>request.value[field.name]!==target.value[field.name]).map(field=>{
            if(!field.editable) throw new Error('The '+field.name+' value is computed. Preserve it or edit its expression in the IDE.');
            return {start:field.start,end:field.end,value:(field.insert ? JSON.stringify(field.name)+':' : '')+JSON.stringify(request.value[field.name])+(field.insert ? ',' : '')};
        });
        if(!edits.length) throw new Error('Progress settings are unchanged.');
    } else throw new Error('Choose add, update or remove progress.');
    const start=Math.min(...edits.map(item=>item.start)),end=Math.max(...edits.map(item=>item.end));
    let replacement=before.slice(start,end);
    for(const edit of [...edits].sort((a,b)=>b.start-a.start)) replacement=replacement.slice(0,edit.start-start)+edit.value+replacement.slice(edit.end-start);
    const after=before.slice(0,start)+replacement+before.slice(end);
    return {file:target.file,before,after,start,end,replacement,removed:before.slice(start,end),added:replacement,affected:1,description:request.action+' Toast progress'};
}
