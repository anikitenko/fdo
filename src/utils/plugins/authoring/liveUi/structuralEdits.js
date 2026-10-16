import {inlineMoveDependencies, dependenciesAvailable} from './moveDependencies';
import {sdkDuplicateInspector} from './sdkDuplication';

// Source ranges come exclusively from the restricted interpreter's current AST.
// Dynamic/shared compositions stay opaque; no workspace code is executed here.
const containers = new Set(['main', 'section', 'div', 'article', 'aside', 'header', 'footer', 'nav', 'dialog', 'form']);
const boundedContainers = new Set(['dialog', 'form']);
const removableAttributes = new Set(['class', 'className', 'role', 'aria-label', 'aria-description', 'aria-live', 'placeholder', 'type', 'disabled', 'title']);
const flatten = node => node?.type === 'BinaryExpression' && node.operator === '+' ? [...flatten(node.left), ...flatten(node.right)] : node ? [node] : [];
const rootId = html => typeof html === 'string' ? /^\s*<[^>]*\bdata-fdo-ui-id=["']([^"']+)["']/.exec(html)?.[1] : undefined;

export function describeStructure(files, elements, calls, evaluated, html) {
    const uses = new Map(), renderedUses = new Map();
    const byId = new Map(elements.map(element => [element.id, element]));
    for (const match of html.matchAll(/\bdata-fdo-ui-id="([^"]+)"/g)) renderedUses.set(match[1], (renderedUses.get(match[1]) || 0) + 1);
    for (const {node, file} of calls.values()) {
        const key = file + ':' + node.start;
        uses.set(key, (uses.get(key) || 0) + 1);
    }
    for (const element of elements) {
        const {node, file, attributes} = calls.get(element.id);
        const unique = renderedUses.get(element.id) === 1 && uses.get(file + ':' + node.start) === 1;
        element.structure = {file, start: node.start, end: node.end, unique, removable: unique && Object.keys(attributes).every(key => removableAttributes.has(key)) && (element.tag !== 'button' || attributes.disabled === true) && !['label', 'input', 'select', 'option', 'form'].includes(element.tag) && !/<[a-z]/i.test(evaluated.get(node.arguments[2]) || ''),
        reason: unique ? 'Action targets and non-empty containers cannot be removed visually. Use the IDE to update their bindings.' : 'This SDK call is shared or repeated. Edit its structure in the IDE.'};
        if (element.sdkComponent) {
            element.structure.removable = false;
            element.structure.reason = 'SDK component identity and controller bindings stay in code. Use its component properties, appearance and body/footer controls.';
            if (!unique) element.sdkComponent.reason = 'This component call is shared or repeated. Edit it in the IDE.';
            continue;
        }
        // A named, already verified SDK instance is usable at this exact call site.
        if (!unique || !containers.has(element.tag) || node.callee.object.type !== 'Identifier' || node.arguments.length < 2 || node.arguments.length > 3) continue;
        const child = node.arguments[2];
        const terms = flatten(child);
        // String composition only. Arrays/helper output can have hidden structure.
        if (terms.some(term => !['Identifier', 'CallExpression', 'StringLiteral'].includes(term.type) || typeof evaluated.get(term) !== 'string')) continue;
        element.structure.container = {receiver: files[file].slice(node.callee.object.start, node.callee.object.end),
            start: child?.start ?? node.arguments[1].end, end: child?.end ?? node.arguments[1].end, missing: !child,
            // Empty-string placeholders preserve source separators/comments but
            // have no rendered child or user-visible arrangement slot.
            terms: terms.filter(term => evaluated.get(term) !== '').map(term => {
                const value = evaluated.get(term), id = rootId(value);
                return {start: term.start, end: term.end, id: id && value === evaluated.get(calls.get(id)?.node) ? id : undefined};
            })};
    }
    const inspectDuplicate = sdkDuplicateInspector(elements, calls, evaluated);
    for (const parent of elements) {
        const terms = parent.structure.container?.terms || [];
        terms.forEach((term, index) => {
            const child = byId.get(term.id);
            if (!child?.structure.unique) return;
            // Multiple parents/uses are ambiguous, even if produced by one call.
            if (child.structure.position) child.structure.position = {ambiguous: true};
            else child.structure.position = {parentId: parent.id, index, count: terms.length, up: index > 0, down: index < terms.length - 1};
            const call = calls.get(child.id), parentCall = calls.get(parent.id);
            if (!child.structure.position.ambiguous && term.start === call.node.start && term.end === call.node.end && call.dom === parentCall.dom) {
                const duplication = inspectDuplicate(child);
                child.structure.duplicable = !!duplication.count;
                child.structure.duplicateElementCount = duplication.count;
                child.structure.duplicateReason = duplication.reason;
            } else child.structure.duplicateReason = 'Named/shared fragments need an independent inline composition before they can be duplicated.';
        });
    }
    for (const element of elements) {
        const position = element.structure.position;
        if (!position || position.ambiguous) continue;
        const parent = byId.get(position.parentId);
        if (boundedContainers.has(element.tag) || boundedContainers.has(parent.tag)) {
            element.structure.moveReason = 'Dialog and form bodies support insertion and reordering. Move these direct contents between containers in the IDE to preserve their form and modal relationships.';
            continue;
        }
        const parentCall = calls.get(parent.id);
        const term = parent.structure.container.terms[position.index];
        const node = flatten(parentCall.node.arguments[2]).find(item => item.start === term.start && item.end === term.end);
        const sourceCall = calls.get(element.id);
        const dependencies = node?.type === 'CallExpression' && node === sourceCall.node ? inlineMoveDependencies(node, sourceCall, evaluated) : null;
        if (node?.type !== 'Identifier' && !dependencies) {
            element.structure.moveReason = 'This inline composition uses a helper call or expression that must keep its evaluation site. Move it in the IDE.';
            continue;
        }
        element.structure.moveTargets = elements.filter(destination => {
            const call = calls.get(destination.id), container = destination.structure.container;
            if (!container || boundedContainers.has(destination.tag) || destination.id === parent.id || destination.id === element.id ||
                call.file !== parentCall.file || call.scope !== parentCall.scope || call.dom !== parentCall.dom) return false;
            // A descendant cannot receive its own ancestor; source containment
            // also protects inline containers not linked through a direct term.
            let ancestor = destination;
            const visited = new Set();
            while (ancestor && !visited.has(ancestor.id)) {
                if (ancestor.id === element.id) return false;
                visited.add(ancestor.id);
                ancestor = byId.get(ancestor.structure.position?.parentId);
            }
            if (call.node.start >= element.structure.start && call.node.end <= element.structure.end) return false;
            if (node.type === 'Identifier') return call.scopeValues.has(node.name) && call.scopeValues.get(node.name) === evaluated.get(node);
            return dependenciesAvailable(dependencies, call);
        }).map(destination => ({id: destination.id, label: destination.label, file: destination.structure.file, line: calls.get(destination.id).node.loc.start.line}));
        if (!element.structure.moveTargets.length) element.structure.moveReason = 'No other container can receive this element with its current inputs. Add a destination in the same render function, or continue in the IDE.';
    }
}

export function planSdkElementDuplicate(files, element) {
    const target = element.structure;
    if (element.htmlLiteral || !target?.unique || !target.duplicable || target.position?.ambiguous) {
        throw new Error('Duplicate requires a unique inline SDK composition without IDs or bindings. ' + (target?.duplicateReason || 'Shared declarations stay in the IDE.'));
    }
    const {file,start,end} = target, before = files[file], original = before.slice(start,end);
    const prefix = '(' + original + ') + (';
    const replacement = prefix + original + ')';
    return {file,before,after:before.slice(0,start)+replacement+before.slice(end),start,end,replacement,
        removed:original,added:replacement,selectedSource:{file,start:start+prefix.length},
        description:'Duplicate SDK ' + element.tag,affected:1};
}

export function planStructuralEdit(files, elements, element, request) {
    const target = element.structure;
    if (!target?.unique) throw new Error('This structure is shared or dynamic. Continue in the IDE.');
    let file = target.file, source = files[file];
    let start, end, replacement, description, relocations;
    if (request.kind === 'insert') {
        const container = target.container;
        if (!container) throw new Error('Select a supported static container to add a component.');
        const presets = {
            container: ['section', {'aria-label': 'New section'}, ''],
            text: ['p', {}, 'New text'],
            singleLineInput: ['input', {type:'text','aria-label':'New text input',placeholder:'Enter text'}, ''],
    input: ['textarea', {'aria-label': 'New input', placeholder: 'Enter text'}, ''],
            button: ['button', {type: 'button', disabled: true, title: 'Connect an action in the IDE'}, 'New button'],
            result: ['pre', {role: 'status', 'aria-live': 'polite'}, 'Results appear here'],
        };
        if (!Object.hasOwn(presets, request.component)) throw new Error('Choose a supported component.');
        const args = presets[request.component];
        const call = container.receiver + '.createElement(' + args.map(arg => JSON.stringify(arg)).join(', ') + ')';
        ({start, end} = container);
        const old = source.slice(start, end);
        replacement = container.missing ? ', ' + call : '(' + old + ') + ' + call;
        description = 'Add ' + request.component + ' inside ' + element.tag;
    } else if (request.kind === 'move') {
        const position = target.position;
        const parent = elements.find(item => item.id === position?.parentId);
        const container = parent?.structure.container;
        if (request.destinationId !== undefined) {
            if (!target.moveTargets?.some(item => item.id === request.destinationId)) throw new Error('Choose a supported destination in the same render scope, outside this element and its descendants.');
            const destination = elements.find(item => item.id === request.destinationId);
            const into = destination.structure.container;
            const term = container.terms[position.index];
            file = parent.structure.file; source = files[file];
            const moving = source.slice(term.start, term.end);
            // Leave a neutral string at the old composition site, retaining
            // separators/comments and all separately declared action targets.
            const operations = [{start: term.start, end: term.end, text: '""'}];
            if (into.missing) operations.push({start: into.start, end: into.start, text: ', ' + moving, movedOffset: 2});
            else {
                operations.push({start: into.start, end: into.start, text: '('});
                operations.push({start: into.end, end: into.end, text: ') + ' + moving, movedOffset: 4});
            }
            operations.sort((a, b) => a.start - b.start);
            start = operations[0].start; end = operations.at(-1).end;
            replacement = ''; relocations = [];
            let cursor = start;
            for (const operation of operations) {
                if (operation.start < cursor) throw new Error('These container source ranges overlap. Continue in the IDE.');
                if (operation.start > cursor) relocations.push({start: cursor, end: operation.start, to: start + replacement.length});
                replacement += source.slice(cursor, operation.start);
                if (operation.movedOffset !== undefined) relocations.push({start: term.start, end: term.end, to: start + replacement.length + operation.movedOffset});
                replacement += operation.text;
                cursor = operation.end;
            }
            description = 'Move ' + element.tag + ' into ' + destination.tag;
            return {file, start, end, replacement, description, affected: 1, relocations};
        }
        const index = Number.isInteger(request.index) ? request.index : position?.index + (request.direction === 'up' ? -1 : request.direction === 'down' ? 1 : 0);
        if (!container || position.ambiguous || !Number.isInteger(index) || index < 0 || index >= container.terms.length || index === position.index) throw new Error('This element cannot move to that position. Select a direct child of a supported container.');
        file = parent.structure.file;
        source = files[file];
        const from = Math.min(position.index, index), to = Math.max(position.index, index);
        const slots = container.terms.slice(from, to + 1);
        const ordered = [...slots];
        const [moving] = ordered.splice(position.index - from, 1);
        ordered.splice(index - from, 0, moving);
        start = slots[0].start; end = slots.at(-1).end;
        replacement = ''; relocations = [];
        ordered.forEach((term, slot) => {
            relocations.push({start: term.start, end: term.end, to: start + replacement.length});
            replacement += source.slice(term.start, term.end);
            if (slot < slots.length - 1) replacement += source.slice(slots[slot].end, slots[slot + 1].start);
        });
        description = 'Move ' + element.tag + ' to position ' + (index + 1);
    } else if (request.kind === 'remove') {
        if (!target.removable) throw new Error(target.reason);
        ({start, end} = target);
        // Preserve variables/composition and avoid orphaning their references.
        replacement = '""';
        description = 'Remove ' + element.tag;
    } else throw new Error('Unsupported structural operation.');
    return {file, start, end, replacement, description, affected: 1, ...(relocations ? {relocations} : {})};
}
