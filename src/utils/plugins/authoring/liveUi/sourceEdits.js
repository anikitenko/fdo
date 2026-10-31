import {planToastProgress} from './sdkToastProgress';
import {planSdkCollection} from './sdkCollectionEdits';
import {planRemoveAction} from './actionLifecycle';
import {planInputKind} from './inputKinds';
import {planClassNames} from './styleAssignments';
import {planBackendAction,planBackendResult} from './backendActions';
import {planHtmlLiteralMove, planHtmlLiteralDuplicate} from './htmlLiteralStructure';
import {planHtmlLiteralStyle} from './htmlLiteralStyles';
import {encodeHtmlLiteralText} from './htmlLiteralAttributes';
import {planSdkSlotEdit} from './sdkSlotEdits';
import {planSdkOpener} from './sdkOverlayOpeners';
import {planToastAction} from './sdkToastActions';
import {planSdkMotion} from './sdkComponentMotion';
import postcss from 'postcss';
import {planSdkComponentInsertion,planSdkSlotComponentInsertion} from './sdkComponentInsertion';
import {planSdkAppearance} from './sdkComponentAppearance';
import {planSdkComponentEdit} from './sdkComponentEdits';
import {planSdkAsyncAction} from './sdkAsyncActions';
import {planAttributeEdit} from './attributeEdits';
import {planButtonAction} from './actionBindings';
import {planExistingBinding} from './existingActionBindings';
import {planHandlerEdit} from './handlerEdits';
import {planLocalAction} from './localActions';
import {planStructuralEdit, planSdkElementDuplicate} from './structuralEdits';
import {planStyleAssignment} from './styleAssignments';
import {planStyleIsolation, planNewStyle} from './styleIsolation';
import {RESPONSIVE_PRESETS, cssContainers, mediaBreakpointOf, validBreakpoint, breakpointKey, breakpointParams, breakpointLabel, compareBreakpoints} from './cssResponsive';
import {CSS_STATES, matchingStateSelectors} from './cssStates';
import {planSelectorListEdit} from './selectorListEdits';
import {VISUAL_CSS_PROPERTIES, isVisualCssProperty, normalizeCssProperty} from './cssProperties';

const encodeText = value => value.replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
export const decodePreviewText = value => value.replace(/&(amp|lt|gt|quot|#39);/g, entity => ({'&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'"}[entity]));

export function describeCssStyle(files, file, classKey, breakpoint = null) {
    const root = postcss.parse(files[file], {from: file});
    const describeContext = width => {
        const containers = cssContainers(root, width);
        const describe = state => {
            const selector = '.' + classKey + (state === 'base' ? '' : ':' + state);
            const rules = containers.flatMap(container => (container.nodes || []).flatMap(node => node.type === 'rule' ? matchingStateSelectors(node.selector, classKey, state).map(() => node) : []));
            const declarations = new Map(), duplicates = new Set(), present = new Set();
            for (const rule of rules) for (const declaration of rule.nodes || []) {
                const property = normalizeCssProperty(declaration.prop || '');
                if (declaration.type === 'decl') present.add(property);
                if (declaration.type === 'decl' && isVisualCssProperty(property)) {
                    if (declarations.has(property)) duplicates.add(property);
                    declarations.set(property, declaration);
                }
            }
            for (const property of duplicates) declarations.delete(property);
            const canCreateRule = (state !== 'base' || width != null) && rules.length === 0;
            const canAddDeclarations = rules.length === 1 || canCreateRule;
            return {file, key: classKey, state, breakpoint: width, selector, canCreateRule, canAddDeclarations, selectorList: rules.some(rule => rule.selectors.length > 1), presentProperties: [...present],
                availableProperties: canAddDeclarations ? VISUAL_CSS_PROPERTIES.filter(property => !present.has(property)) : [],
                ruleStart: rules.length === 1 ? rules[0].source.start.offset : null,
                declarations: [...declarations.values()].map(declaration => ({property: normalizeCssProperty(declaration.prop), value: declaration.value,
                    line: declaration.source.start.line, column: declaration.source.start.column, start: declaration.source.start.offset})),
                reason: declarations.size || canAddDeclarations ? '' : 'No unambiguous declarations in this rule. Imported, conditional, nested and complex selectors remain read-only.'};
        };
        return {...describe('base'), states: CSS_STATES.filter(item => item.value !== 'base').map(item => describe(item.value))};
    };
    const context = describeContext(breakpoint);
    if (breakpoint != null) return context;
    const widths = [...new Map([...RESPONSIVE_PRESETS, ...root.nodes.map(mediaBreakpointOf).filter(value => value != null)].map(value => [breakpointKey(value), value])).values()];
    widths.sort(compareBreakpoints);
    return {...context, responsive: widths.map(describeContext)};
}

// The host derives the patch from its own current source map. The visual window
// supplies a value, never a path/range or arbitrary replacement file.
export function planVisualSourceEdit(files, elements, request, catalog=[]) {
    if(request.kind === 'remove-action') return planRemoveAction(files,elements,catalog,request);
    const element = elements.find(item => item.id === request.elementId);
    if (!element) throw new Error('Select a current source-mapped element.');
    if (request.kind === 'sdk-binding') return planExistingBinding(files,element,request);
    if (request.kind === 'sdk-handler') return planHandlerEdit(files,element,request);
    if (['create-sdk-async-action','disconnect-sdk-async-action'].includes(request.kind)) return planSdkAsyncAction(files,element,request);
    if (request.kind === 'backend-result') return planBackendResult(files,element,request);
    if (request.kind === 'input-kind') return planInputKind(files,element,request);
    if (request.kind === 'create-backend-action') return planBackendAction(files,element,request);
    if (request.kind === 'create-local-action') return planLocalAction(files,element,request);
    if (['connect-overlay-opener','disconnect-overlay-opener'].includes(request.kind)) return planSdkOpener(files,element,request);
    if (['connect-toast-action','disconnect-toast-action'].includes(request.kind)) return planToastAction(files,element,request);
    if (request.kind === 'toast-progress') return planToastProgress(files,element,request);
    if (request.kind === 'component-collection') return planSdkCollection(files,element,request);
    if (request.kind === 'component-slot-arrange') return planSdkSlotEdit(files, element, request);
    if (request.kind === 'insert-sdk-component') return planSdkComponentInsertion(files, element, request);
    if (request.kind === 'insert-sdk-slot-component') return planSdkSlotComponentInsertion(files, element, request);
    if (element.htmlLiteral && request.kind === 'duplicate') return planHtmlLiteralDuplicate(files,element);
    if (request.kind === 'duplicate') return planSdkElementDuplicate(files,element);
    if (element.htmlLiteral && request.kind === 'move') return planHtmlLiteralMove(files,elements,element,request);
    if (request.kind === 'html-inline-style') return planHtmlLiteralStyle(files,element,request);
    if (request.kind === 'attribute') return planAttributeEdit(files, element, request);
    if (['connect-action', 'disconnect-action'].includes(request.kind)) return planButtonAction(files, element, request);
    if (request.kind === 'create-style') return planNewStyle(files, element, request);
    let file, start, end, replacement, description, affected, relocations;
    if (request.kind === 'component-motion') {
        ({file,start,end,replacement,description,affected}=planSdkMotion(element,request));
    } else if (request.kind === 'component-appearance') {
        ({file, start, end, replacement, description, affected} = planSdkAppearance(element, request));
    } else if (['component-property', 'component-slot'].includes(request.kind)) {
        ({file, start, end, replacement, description, affected} = planSdkComponentEdit(files, element, request));
    } else if (request.kind === 'text') {
        const target = element.text;
        if (!target) throw new Error('This content is computed or contains markup. Edit it in the IDE.');
        if (typeof request.value !== 'string' || request.value.length > 2000) throw new Error('Use up to 2,000 characters of plain text.');
        ({file, start, end} = target);
        replacement = target.kind === 'html-literal' ? encodeHtmlLiteralText(request.value) : JSON.stringify(encodeText(request.value));
        description = `Change ${element.tag} text`;
        affected = elements.filter(item => item.text?.file === file && item.text.start === start).length;
    } else if (request.kind === 'css') {
        const breakpoint = request.breakpoint ?? null;
        if (!validBreakpoint(breakpoint)) throw new Error('Choose an integer max-width, min-width or range breakpoint from 1 to 10000 pixels, with minimum no greater than maximum.');
        const state = request.state ?? 'base';
        if (!CSS_STATES.some(item => item.value === state)) throw new Error('Choose a supported CSS state.');
        const creatingRule = request.action === 'create-rule';
        if (creatingRule && (breakpoint == null || state !== 'base')) throw new Error('Choose a max-width breakpoint, min-width breakpoint or range and Base state to create a responsive rule.');
        if (request.action !== undefined && !['set', 'remove', 'create-rule'].includes(request.action)) throw new Error('Choose a supported CSS edit action.');
        const style = element.styles.find(item => item.file === request.styleFile && item.key === request.styleKey);
        if (!style) throw new Error('Choose a supported CSS declaration for this element.');
        const context = breakpoint == null ? style : describeCssStyle(files, style.file, style.key, breakpoint);
        const ruleStyle = state === 'base' ? context : context.states?.find(item => item.state === state);
        if (creatingRule && !ruleStyle?.canCreateRule) throw new Error('This responsive rule already exists. Select it to edit its declarations.');
        if (request.scope !== undefined && !['element', 'shared'].includes(request.scope)) throw new Error('Choose this element or the shared class.');
        const uses = elements.filter(item => item.styles.some(entry => entry.file === style.file && entry.key === style.key)).length;
        if (request.scope !== 'shared' && (!style.draftLocal || uses !== 1)) {
            const isolated = planStyleIsolation(files, elements, element, style);
            const copiedFiles = {...files};
            for (const patch of isolated.patches) copiedFiles[patch.file] = patch.after;
            const copiedElement = {...element, styles: [describeCssStyle(copiedFiles, style.file, isolated.name)]};
            // Imported effective CSS may already supply this media rule in the
            // copy, even though the writable source file had no local rule.
            if (creatingRule && !describeCssStyle(copiedFiles, style.file, isolated.name, breakpoint).canCreateRule) {
                const patches = isolated.patches.map(patch => ({...patch, description: `Prepare responsive styles for this ${element.tag}`, affected: 1}));
                return {...patches[0], patches, isolatedStyle: {file: style.file, key: isolated.name}};
            }
            const edit = planVisualSourceEdit(copiedFiles, [copiedElement], {...request, scope: 'shared', styleKey: isolated.name});
            const cssPatch = isolated.patches[1];
            const after = edit.after;
            const added = after.slice(cssPatch.start);
            const patches = [isolated.patches[0], {...cssPatch, after, replacement: added, added}].map(patch => ({...patch,
                description: `Style only this ${element.tag} with .${isolated.name}`, affected: 1}));
            return {...patches[0], patches, isolatedStyle: {file: style.file, key: isolated.name}};
        }
        const property = ruleStyle?.declarations.find(item => item.property === request.property);
        const removing = request.action === 'remove';
        const adding = creatingRule || (!removing && !property && ruleStyle?.canAddDeclarations && isVisualCssProperty(request.property) && !ruleStyle.presentProperties.includes(normalizeCssProperty(request.property)));
        if (!property && !adding) throw new Error('Choose a supported CSS declaration for this element. Adding requires one unambiguous base rule or state rule in the selected breakpoint.');
        if (!removing && !creatingRule && (typeof request.value !== 'string' || !request.value.trim() || request.value.length > 300 || /[;{}<>\r\n]/.test(request.value))) throw new Error('Enter one CSS value without rule separators or markup.');
        file = style.file;
        const root = postcss.parse(files[file], {from: file});
        const containers = cssContainers(root, breakpoint);
        const listEdit = !creatingRule && planSelectorListEdit(root, containers, ruleStyle, property, request);
        if (listEdit) {
            ({start, end, replacement} = listEdit);
            description = `${removing ? 'Remove' : adding ? 'Add' : 'Change'} ${ruleStyle.selector} ${request.property}; separate its selector list`;
        } else if (adding && ruleStyle.canCreateRule) {
            if (containers.some(container => container.nodes?.some(node => node.type === 'rule' && matchingStateSelectors(node.selector, style.key, state).length))) throw new Error('This state rule changed. Refresh before editing.');
            start = end = breakpoint != null && containers.length === 1 ? containers[0].source.end.offset - 1 : files[file].length;
            const rule = postcss.rule({selector: ruleStyle.selector});
            if (!creatingRule) rule.append({prop: request.property, value: request.value.trim()});
            const added = breakpoint != null && containers.length !== 1 ? postcss.atRule({name: 'media', params: breakpointParams(breakpoint)}).append(rule) : rule;
            replacement = '\n\n' + added.toString() + '\n';
            description = creatingRule ? `Create responsive rule for ${ruleStyle.selector}` : `Add ${ruleStyle.selector} ${request.property}`;
        } else if (adding) {
            const rules = containers.flatMap(container => (container.nodes || []).filter(node => node.type === 'rule' && matchingStateSelectors(node.selector, style.key, state).length));
            const rule = rules.length === 1 && rules[0];
            if (!rule || rule.source.start.offset !== ruleStyle.ruleStart || rule.nodes.some(node => node.type === 'decl' && normalizeCssProperty(node.prop) === normalizeCssProperty(request.property))) throw new Error('This base rule changed or already contains that property. Refresh before editing.');
            start = rule.source.start.offset; end = rule.source.end.offset;
            const next = rule.clone();
            next.append({prop: request.property, value: request.value.trim()});
            replacement = next.toString();
            description = `Add ${ruleStyle.selector} ${request.property}`;
        } else {
            let target;
            root.walkDecls(declaration => {if (declaration.source.start.offset === property.start) target = declaration;});
            if (!target) throw new Error('The CSS declaration changed. Refresh before editing.');
            start = target.source.start.offset;
            end = target.source.end.offset;
            const old = files[file].slice(start, end);
            replacement = removing ? '' : target.clone({value: request.value.trim()}).toString() + (old.endsWith(';') ? ';' : '');
            description = `${removing ? 'Remove' : 'Change'} ${ruleStyle.selector} ${request.property}`;
        }
        if (breakpoint != null) description += ` — ${breakpointLabel(breakpoint)}`;
        affected = elements.filter(item => item.styles.some(entry => entry.file === file && entry.key === style.key)).length;
    } else if (request.kind === 'class-names') {
        ({file,start,end,replacement,description,affected}=planClassNames(files,element,request));
    } else if (request.kind === 'style') {
        ({file, start, end, replacement, description, affected} = planStyleAssignment(files, elements, element, request));
    } else if (['insert', 'move', 'remove'].includes(request.kind)) {
        ({file, start, end, replacement, description, affected, relocations} = planStructuralEdit(files, elements, element, request));
    } else throw new Error('This visual edit is not supported.');
    const before = files[file];
    const after = before.slice(0, start) + replacement + before.slice(end);
    if (after === before) throw new Error('The value is unchanged.');
    return {file, before, after, start, end, replacement, description, affected,
        removed: before.slice(start, end), added: replacement, ...(relocations ? {relocations} : {})};
}
