import postcss from 'postcss';
import {isVisualCssProperty, normalizeCssProperty} from './cssProperties';
import {encodeHtmlLiteralText} from './htmlLiteralAttributes';

function declarations(value) {
    const root = postcss.parse('element{' + value + '}');
    if (root.nodes.length !== 1 || root.first.type !== 'rule' || root.first.selector !== 'element' || root.first.nodes.some(node=>!['decl','comment'].includes(node.type))) throw new Error('Only a CSS declaration list can be edited here.');
    const names = root.first.nodes.filter(node=>node.type === 'decl').map(node=>normalizeCssProperty(node.prop));
    if (new Set(names).size !== names.length) throw new Error('Duplicate inline declarations need to be resolved in the IDE.');
    return root.first;
}
export function describeHtmlLiteralStyle(element, node, range) {
    const value = node.attrs.find(item=>item.name === 'style')?.value || '';
    const location = node.sourceCodeLocation.attrs?.style;
    const target = location && range(location.startOffset,location.endOffset);
    const source = element.attributeSource;
    try {
        const rule = declarations(value);
        const present = rule.nodes.filter(item=>item.type === 'decl');
        element.inlineStyle = {editable:!!source && (!location || !!target),value,source,target,
            declarations:present.map(item=>({property:normalizeCssProperty(item.prop),value:item.value,important:!!item.important})),
            presentProperties:present.map(item=>normalizeCssProperty(item.prop)),canAddDeclarations:!!source,
            reason:source ? '' : 'This start tag is shared or transformed. Edit its styles in the IDE.'};
    } catch (error) {element.inlineStyle = {editable:false,declarations:[],presentProperties:[],canAddDeclarations:false,reason:error.message};}
}
export function inlineStyleValueError(property,value) {
    if (!isVisualCssProperty(property) || typeof value !== 'string' || !value.trim() || value.length > 500 || /[\u0000-\u001f\u007f]/.test(value)) return 'Choose a CSS property and use up to 500 characters on one line.';
    try {
        const rule = declarations(property + ':' + value);
        if (rule.nodes.length !== 1 || rule.first.type !== 'decl' || normalizeCssProperty(rule.first.prop) !== property || rule.first.important) return 'Enter one property value without extra declarations or !important.';
    } catch {return 'Enter one valid CSS property value without extra declarations.';}
    return '';
}
export function planHtmlLiteralStyle(files,element,request) {
    const style = element.inlineStyle;
    if (!element.htmlLiteral || !element.structure?.unique || !style?.editable || !style.source) throw new Error(style?.reason || 'Select a unique HTML literal element with an unchanged start tag.');
    const property = typeof request.property === 'string' ? normalizeCssProperty(request.property) : request.property;
    if (!isVisualCssProperty(property) || !['set','remove'].includes(request.action || 'set')) throw new Error('Choose a supported inline property operation.');
    const rule = declarations(style.value);
    const existing = rule.nodes.find(item=>item.type === 'decl' && normalizeCssProperty(item.prop) === property);
    if (request.action === 'remove') {
        if (!existing) throw new Error('This inline override is not present.');
        existing.remove();
    } else {
        const error = inlineStyleValueError(property,request.value);
        if (error) throw new Error(error);
        if (existing?.value === request.value.trim()) throw new Error('The inline override is unchanged.');
        if (existing) existing.value = request.value.trim();
        else rule.append(postcss.decl({prop:property,value:request.value.trim()}));
    }
    // A style attribute is a declaration list, not a formatted stylesheet rule.
    // Normalize formatting trivia only; CSS values and comments keep their text.
    rule.nodes.forEach((node,index)=>{
        if (!node.raws.before || /^\s*$/.test(node.raws.before)) node.raws.before = index ? ' ' : '';
        if (node.type === 'decl' && node.raws.between) node.raws.between = node.raws.between.replace(/[\r\n\t]+/g,' ');
    });
    if (!rule.raws.after || /^\s*$/.test(rule.raws.after)) rule.raws.after = '';
    const serialized = rule.toString();
    const css = serialized.slice(serialized.indexOf('{') + 1,-1);
    const {file,quote} = style.source;
    const target = style.target || style.source;
    const start = target.start, end = target.end;
    const replacement = css ? (style.target ? '' : ' ') + 'style=' + quote + encodeHtmlLiteralText(css) + quote : '';
    const before = files[file], after = before.slice(0,start) + replacement + before.slice(end);
    return {file,before,after,start,end,replacement,removed:before.slice(start,end),added:replacement,
        description:(request.action === 'remove' ? 'Remove ' : 'Set ') + element.tag + ' inline ' + property,affected:1};
}
