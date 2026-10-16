import {parseFragment} from 'parse5';

// Numeric entities preserve both HTML and the surrounding JS literal grammar.
export const encodeHtmlLiteralText = value => value.replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])).replace(/[\\`$\r\n\t]/g, char => '&#' + char.charCodeAt(0) + ';');

// In unquoted values a trailing slash can be part of the value, rather than
// a self-closing marker. Insert after that value to preserve HTML semantics.
export function htmlAttributeInsertion(node, html) {
    const end = node.sourceCodeLocation.startTag.endOffset;
    const slashInValue = Object.values(node.sourceCodeLocation.attrs || {}).some(attribute=>attribute.endOffset >= end - 1);
    return html[end - 2] === '/' && !slashInValue ? end - 2 : end - 1;
}

export function describeHtmlLiteralAttributes(element, node, html, range) {
    const tag = node.sourceCodeLocation.startTag;
    const source = range(tag.startOffset,tag.endOffset);
    let duplicate = false;
    const onParseError = error => {if (error.code === 'duplicate-attribute') duplicate = true;};
    if (source) parseFragment(html.slice(tag.startOffset,tag.endOffset),{onParseError});
    const writable = !!source && element.structure.unique && !duplicate && node.namespaceURI === 'http://www.w3.org/1999/xhtml';
    const fields = [['aria-label','Accessible label'],['aria-description','Accessible description'],['title','Tooltip']];
    if (['input','textarea'].includes(node.tagName)) fields.push(['placeholder','Placeholder']);
    element.editableAttributes = fields.map(([name,label])=>{
        const attribute = node.attrs.find(item=>item.name === name);
        const location = node.sourceCodeLocation.attrs?.[name];
        const target = location && range(location.startOffset,location.endOffset);
        const editable = writable && (!attribute || !!target);
        return {name,label,present:!!attribute,value:attribute?.value || '',editable,
            reason: editable ? '' : duplicate ? 'Duplicate attributes need to be resolved in the IDE.' : 'This start tag is shared, transformed or not a supported HTML literal. Edit its attributes in the IDE.',
            ...(target ? {start:target.start,end:target.end,removal:[{start:target.start,end:target.end}]} : {})};
    });
    if (writable) {
        const insert = source.start + htmlAttributeInsertion(node,html) - tag.startOffset;
        element.attributeSource = {kind:'html-literal',file:source.file,start:insert,end:insert,quote:source.quote === '"' ? "'" : '"'};
    }
}
