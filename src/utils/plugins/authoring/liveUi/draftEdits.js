import {planDeploymentEdit,reviewDeploymentChange} from '../../deployment/deploymentEditing';
import {randomUUID} from 'node:crypto';
import {planVisualSourceEdit} from './sourceEdits';
import {planPluginSupportEdit, reviewPluginSupportChange} from '../../../sdk/pluginSupportEditing';

const locate = element => element?.structure ? {file: element.structure.file, start: element.structure.start, id: element.id} : null;
const find = (preview, location) => {
    if (!location) return null;
    const matches = (preview.elements || []).filter(element => element.structure?.file === location.file && element.structure.start === location.start);
    return matches.length === 1 ? matches[0] : matches.find(element => element.id === location.id);
};
function movedLocation(element, patch) {
    const location = locate(element);
    if (!location || location.file !== patch.file) return location;
    const relocation = patch.relocations?.find(range => location.start >= range.start && location.start < range.end);
    if (relocation) return {...location, start: relocation.to + location.start - relocation.start};
    if (location.start >= patch.end) return {...location, start: location.start + patch.added.length - patch.removed.length};
    if (location.start > patch.start || (location.start === patch.start && patch.removed === patch.before.slice(element.structure.start, element.structure.end))) return null;
    return location;
}
function combinedPatch(file, before, after) {
    let start = 0, end = before.length, nextEnd = after.length;
    while (start < end && start < nextEnd && before[start] === after[start]) start++;
    while (end > start && nextEnd > start && before[end - 1] === after[nextEnd - 1]) {end--; nextEnd--;}
    start = start === 0 ? 0 : before.lastIndexOf('\n', start - 1) + 1;
    const oldLineEnd = before.indexOf('\n', end), newLineEnd = after.indexOf('\n', nextEnd);
    end = oldLineEnd < 0 ? before.length : oldLineEnd + 1;
    nextEnd = newLineEnd < 0 ? after.length : newLineEnd + 1;
    const replacement = after.slice(start, nextEnd);
    return {file, before, after, start, end, replacement, removed: before.slice(start, end), added: replacement,
        description: file.endsWith('.css') ? 'Stylesheet changes' : 'Source changes', affected: 1};
}

// Draft contents and edit history stay in the host. The visual window supplies
// semantic operations and the exact predecessor ID, never replacement sources.
export async function prepareVisualDraft({base, previous, preview, request, render, acceptFiles}) {
    if (previous && previous.revision !== base.revision) throw new Error('Source changed. Discard this draft and select again.');
    let files = previous?.files || base.files;
    let steps = previous?.steps || [], cursor = previous?.cursor || 0;
    let origins = (preview?.elements || []).map(element => ({id: element.id, element, location: locate(element)}));
    const remap = patch => {origins = origins.map(origin => ({...origin, location: origin.location
        ? movedLocation({...origin.element, structure: {...origin.element.structure, start: origin.location.start}}, patch) : null}));};
    const retainedLocalStyles = [...(previous?.retainedLocalStyles || [])];
    let selection, historyTruncated = previous?.historyTruncated || false;
    if (request.kind === 'undo' || request.kind === 'redo') {
        const undo = request.kind === 'undo';
        const step = steps[undo ? cursor - 1 : cursor];
        if (!step) throw new Error(undo ? 'No draft edits to undo.' : 'No draft edits to redo.');
        const patches = step.patches || [step];
        const nextFiles = {...files};
        for (const patch of undo ? [...patches].reverse() : patches) {
            const removed = undo ? patch.added : patch.removed, added = undo ? patch.removed : patch.added;
            const source = nextFiles[patch.file];
            if (source.slice(patch.start, patch.start + removed.length) !== removed) throw new Error('Draft history no longer matches its source. Discard and start again.');
            remap({...patch, before: source, removed, added, end: patch.start + removed.length});
            nextFiles[patch.file] = source.slice(0, patch.start) + added + source.slice(patch.start + removed.length);
        }
        files = nextFiles;
        cursor += undo ? -1 : 1;
        selection = undo ? step.selectionBefore : step.selectionAfter;
    } else {
        const element = preview.elements?.find(item => item.id === request.elementId);
        const patch = request.kind === 'compatibility' ? planPluginSupportEdit(files, request)
            : request.kind === 'deployment' ? planDeploymentEdit(files,request) : planVisualSourceEdit(files, preview.elements || [], request,preview.actions || []);
        if (!patch) return {status: 'unchanged', message: request.kind==='deployment'?'These deployment requirements already match. No changes were added.':'These support settings already match. No changes were added.'};
        const patches = patch.patches || [patch];
        selection = locate(element);
        files = {...files};
        for (const item of patches) {
            remap(item);
            if (item.file === selection?.file) selection = movedLocation({...element, structure: {...element.structure, start: selection.start}}, item);
            files[item.file] = item.after;
        }
        steps = steps.slice(0, cursor);
        steps.push({...(['compatibility','deployment'].includes(request.kind) ? {kind: request.kind} : {}), file: patch.file, start: patch.start, removed: patch.removed, added: patch.added,
            patches: patches.map(({file, start, removed, added}) => ({file, start, removed, added})), isolatedStyle: patch.isolatedStyle,
            description: patch.description, affected: patch.affected, selectedSource: patch.selectedSource, insertedComponentId: patch.insertedComponentId, selectionBefore: locate(element), selectionAfter: selection});
        cursor++;
        const stepSize = step => (step.patches || [step]).reduce((sum, patch) => sum + patch.removed.length + patch.added.length, 0);
        if (stepSize(steps.at(-1)) > 4000000) throw new Error('This edit exceeds the draft history budget. Use a smaller source change.');
        let historySize = steps.reduce((sum, step) => sum + stepSize(step), 0);
        while (steps.length > 100 || historySize > 4000000) {
            const dropped = steps.shift();
            if (dropped.isolatedStyle) retainedLocalStyles.push(dropped.isolatedStyle);
            historySize -= stepSize(dropped);
            cursor--; historyTruncated = true;
        }
    }
    const draft = await rebuildVisualDraft({base, files, steps, cursor, retainedLocalStyles, historyTruncated, selection, request, render, acceptFiles});
    if (draft.status === 'error') return draft;
    draft.selectionMap = Object.fromEntries(origins.flatMap(origin => {
        const target = find(draft.preview, origin.location);
        return target ? [[origin.id, target.id]] : [];
    }));
    return draft;
}

// Recovery regenerates previews and patches from current source; serialized
// previews, patch offsets and controller state are never trusted or executed.
export async function rebuildVisualDraft({base, files, steps, cursor, retainedLocalStyles = [], historyTruncated = false, selection, request = {kind: 'undo'}, render, acceptFiles}) {
    files = acceptFiles(files);
    const candidate = await render(files);
    const supportOnly = steps.length > 0 && steps.every(step => step.kind === 'compatibility');
    const deploymentOnly=steps.length>0 && steps.every(step=>step.kind==='deployment');
    const deploymentPolicy=deploymentOnly?reviewDeploymentChange(base.files,files):null;
    const supportPolicy = supportOnly ? reviewPluginSupportChange(base.files, files) : null;
    if (candidate.status !== 'ready' && !supportOnly && !deploymentOnly) return {status: 'error', message: candidate.message};
    const activeSteps = steps.slice(0, cursor);
    const localStyles = [...retainedLocalStyles, ...activeSteps.flatMap(step => step.isolatedStyle ? [step.isolatedStyle] : [])];
    for (const element of candidate.elements || []) element.styles = element.styles.map(style => ({...style,
        draftLocal: localStyles.some(local => local.file === style.file && local.key === style.key)}));
    const patches = Object.keys(files).filter(file => files[file] !== base.files[file]).map(file => {
        const fileSteps = activeSteps.filter(step => step.file === file || step.patches?.some(patch => patch.file === file));
        return {...combinedPatch(file, base.files[file], files[file]),
            affected: Math.max(1, ...fileSteps.map(step => step.affected || 1))};
    });
    if(!['undo','redo'].includes(request.kind) && steps[cursor-1]?.selectedSource) {selection=steps[cursor-1].selectedSource;steps[cursor-1].selectionAfter=selection;}
    let selected = find(candidate, selection);
    if(request.kind==='sdk-handler' && (!selected?.sdkBindings?.handlerContainer || selected.sdkBindings.reason)) {
        return {status:'error',message:selected?.sdkBindings?.reason || 'The handler change no longer has a static SDK action definition. Your workspace is unchanged.'};
    }
    const insertedId = !['undo','redo'].includes(request.kind) && steps[cursor - 1]?.insertedComponentId;
    if (insertedId) {
        const matches = candidate.elements.filter(element=>element.sdkComponent?.instanceId === insertedId);
        if(matches.length === 1) {selected=matches[0];steps[cursor-1].selectionAfter=locate(selected);}
    }
    return {id: randomUUID(), revision: base.revision, files, steps, cursor, retainedLocalStyles, preview: candidate, patches, patch: patches[0],
        ...(supportOnly ? {supportOnly, supportPolicy} : {}),...(deploymentOnly?{deploymentOnly,deploymentPolicy}:{}),
        selectedId: selected?.id || '', canUndo: cursor > 0, canRedo: cursor < steps.length, changedFileCount: patches.length, historyTruncated};
}

export function visualDraftResponse(draft) {
    const {files, steps, cursor, retainedLocalStyles, ...response} = draft;
    return {status: 'ready', ...response};
}
