// Published component custom properties (SDK 1.6+). They customize appearance
// without overriding controller-owned visibility, positioning or pending state.
export const SDK_COMPONENT_APPEARANCE = [
    {name:'--fdo-ui-background', label:'Background', cssProperty:'background-color', kind:'color'},
    {name:'--fdo-ui-color', label:'Text color', cssProperty:'color', kind:'color'},
    {name:'--fdo-ui-width', label:'Maximum width', cssProperty:'max-width', kind:'length'},
    {name:'--fdo-ui-padding', label:'Padding', cssProperty:'padding', kind:'spacing'},
    {name:'--fdo-ui-radius', label:'Corner radius', cssProperty:'border-radius', kind:'length'},
    {name:'--fdo-ui-border', label:'Border', cssProperty:'border', kind:'text'},
    {name:'--fdo-ui-backdrop', label:'Backdrop color', cssProperty:'background-color', kind:'color'},
    {name:'--fdo-ui-error-color', label:'Error color', cssProperty:'color', kind:'color'},
    {name:'--fdo-ui-progress-width',label:'Progress width',cssProperty:'width',kind:'length',identities:['fdo.progress-bar','fdo.toast']},
    {name:'--fdo-ui-progress-height',label:'Progress height',cssProperty:'height',kind:'length',identities:['fdo.progress-bar','fdo.toast']},
    {name:'--fdo-ui-progress-color',label:'Progress color',cssProperty:'color',kind:'color',identities:['fdo.progress-bar','fdo.toast']},
    {name:'--fdo-ui-toast-gap',label:'Notification gap',cssProperty:'gap',kind:'length',identities:['fdo.toast-region']},
    {name:'--fdo-ui-region-max-height',label:'Notification maximum height',cssProperty:'max-height',kind:'length',identities:['fdo.toast-region']},
    {name:'--fdo-ui-info-color',label:'Info color',cssProperty:'color',kind:'color',identities:['fdo.toast','fdo.inline-alert']},
    {name:'--fdo-ui-success-color',label:'Success color',cssProperty:'color',kind:'color',identities:['fdo.toast','fdo.inline-alert']},
    {name:'--fdo-ui-warning-color',label:'Warning color',cssProperty:'color',kind:'color',identities:['fdo.toast','fdo.inline-alert']},
];
const properties = node => {
    if (node?.type !== 'ObjectExpression' || node.properties.some(item => item.type !== 'ObjectProperty' || item.computed || item.method)) return null;
    const entries = node.properties.map(item => [item.key.name ?? item.key.value, item.value]);
    return new Set(entries.map(([name]) => name)).size === entries.length ? new Map(entries) : null;
};
export function sdkStyleContext(node) {
    const root=node.arguments[1], fields=properties(root), options=fields?.get('options');
    const optionsFields=properties(options), style=optionsFields?.get('style'), styleFields=properties(style);
    return {root,options,style,styleFields,writable:!!fields && (!options || !!optionsFields) && (!style || !!styleFields)};
}
export function describeSdkAppearance(node, file, definition) {
    if (!definition.editableProperties?.some(item => item.name === 'options.style' && item.kind === 'style-map')) return [];
    const {root,options,style,styleFields,writable}=sdkStyleContext(node);
    const reason = writable ? '' : 'Appearance uses computed, shared or ambiguous options/style. Edit it in the IDE to preserve every caller.';
    return SDK_COMPONENT_APPEARANCE.filter(item => (!item.identities || item.identities.includes(definition.identity)) && (item.name !== '--fdo-ui-backdrop' || ['fdo.dialog','fdo.confirmation-dialog'].includes(definition.identity)) && (item.name !== '--fdo-ui-error-color' || ['fdo.confirmation-dialog','fdo.toast','fdo.inline-alert','fdo.async-action-button'].includes(definition.identity))).map(item => {
        const value = styleFields?.get(item.name);
        const editable = writable && (!value || ['StringLiteral','NumericLiteral','NullLiteral'].includes(value.type));
        const container = style || options || root;
        return {...item, file, editable, reason: reason || (editable ? '' : 'This value is computed. Edit it in the IDE.'),
            value: ['StringLiteral','NumericLiteral'].includes(value?.type) ? String(value.value) : '',
            overridden: !!value && value.type !== 'NullLiteral',
            start:value?.start ?? container.start + 1, end:value?.end ?? container.start + 1,
            insert:!value, missingOptions:!options, missingStyle:!style};
    });
}
export function sdkAppearanceValueError(value) {
    if (typeof value !== 'string' || !value.trim() || value.length > 300 || /[;{}<>\u0000-\u001f]/.test(value) || /\/\*|\*\/|url\s*\(|expression\s*\(|!important|\\/i.test(value)) return 'Enter one CSS value of up to 300 characters, without markup, URLs, comments or rule separators.';
    return '';
}
export function planSdkAppearance(element, request) {
    const target = element.sdkComponent?.appearance?.find(item => item.name === request.property && item.editable);
    if (!element.structure?.unique || element.sdkComponent?.reason || !target) throw new Error('Choose an editable appearance value on a unique SDK component with literal options and style.');
    const action = request.action ?? 'set';
    if (!['set','reset'].includes(action)) throw new Error('Choose a supported appearance action.');
    if (action === 'reset' && !target.overridden) throw new Error('This component has no local override for that property.');
    if (action === 'set') {const error = sdkAppearanceValueError(request.value); if (error) throw new Error(error);}
    let replacement = action === 'reset' ? 'null' : JSON.stringify(request.value.trim());
    if (target.insert) {
        replacement = JSON.stringify(target.name) + ': ' + replacement + ', ';
        if (target.missingStyle) replacement = '"style": {' + replacement + '}, ';
        if (target.missingOptions) replacement = '"options": {' + replacement + '}, ';
    }
    return {...target,replacement,description:(action === 'reset' ? 'Reset ' : 'Style ') + element.sdkComponent.name + ' ' + target.label,affected:1};
}
