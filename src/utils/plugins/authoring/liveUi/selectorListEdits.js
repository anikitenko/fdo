import {matchingStateSelectors} from './cssStates';

// Split a simple list before changing one branch's declarations. Unselected
// branches keep the original body; the edited branch follows at the same source
// site so an equal-specificity overlap can observe the explicit edit.
export function planSelectorListEdit(root, containers, style, property, request) {
    let declaration;
    if (property) root.walkDecls(node => {if (node.source.start.offset === property.start) declaration = node;});
    const rules = containers.flatMap(container => (container.nodes || []).filter(node => node.type === 'rule' && matchingStateSelectors(node.selector, style.key, style.state).length));
    const rule = declaration?.parent || (rules.length === 1 ? rules[0] : null);
    if (!rule || rule.type !== 'rule' || rule.selectors.length < 2) return null;
    const matches = matchingStateSelectors(rule.selector, style.key, style.state);
    if (matches.length !== 1) throw new Error('This selector list is ambiguous. Edit it in the IDE.');
    if (!property && rule.source.start.offset !== style.ruleStart) throw new Error('This CSS rule changed. Refresh before editing.');
    const selected = rule.clone({selector: matches[0]});
    const remaining = rule.clone({selector: rule.selectors.filter(selector => selector.trim() !== matches[0]).join(', ')});
    if (declaration) {
        const target = selected.nodes[rule.nodes.indexOf(declaration)];
        if (request.action === 'remove') target.remove();
        else target.value = request.value.trim();
    } else selected.append({prop: request.property, value: request.value.trim()});
    return {start: rule.source.start.offset, end: rule.source.end.offset,
        replacement: remaining.toString() + '\n' + selected.toString()};
}
