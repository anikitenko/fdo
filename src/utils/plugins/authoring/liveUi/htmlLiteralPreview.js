import {describeHtmlLiteralStructure} from './htmlLiteralStructure';
import {describeHtmlLiteralStyle} from './htmlLiteralStyles';
import {describeHtmlLiteralAttributes, htmlAttributeInsertion} from './htmlLiteralAttributes';
import {parseFragment} from 'parse5';

// Carry source provenance beside strings, never inside authored values. This
// keeps literal attributes, escaping, replacements and SDK arguments unchanged.
export function createHtmlLiteralMapper(files) {
    const origins = new Map();
    const remember = (value, segments) => {
        if (!segments.length) return;
        if (origins.has(value) && JSON.stringify(origins.get(value)) !== JSON.stringify(segments)) origins.set(value, null);
        else if (!origins.has(value)) origins.set(value, segments);
    };
    const point = (file, offset) => {
        const prefix = files[file].slice(0, offset), newline = prefix.lastIndexOf('\n');
        return {line: prefix.split('\n').length, column: offset - newline};
    };
    return {
        literal(node, file, value) {
            if (typeof value !== 'string' || !/<[a-z][\w-]*[\s>]/i.test(value)) return value;
            // Escaped or interpolated literals need a separate source adapter.
            if (files[file].slice(node.start + 1, node.end - 1) === value) remember(value, [{start:0,end:value.length,file,source:node.start + 1,quote:files[file][node.start]}]);
            return value;
        },
        replace(input, output, copies) {
            const segments = origins.get(input);
            if (!segments) return;
            const retained = copies.flatMap(copy => segments.flatMap(segment => {
                const start = Math.max(copy.start, segment.start), end = Math.min(copy.end, segment.end);
                return start < end ? [{start:copy.output + start - copy.start,end:copy.output + end - copy.start,file:segment.file,source:segment.source + start - segment.start,quote:segment.quote}] : [];
            }));
            remember(output, retained);
        },
        describe(html, existing) {
            const segments = origins.get(html);
            if (!segments) return {html,elements:[]};
            const at = offset => {
                const matches = segments.filter(item => offset >= item.start && offset < item.end);
                return matches.length === 1 ? {file:matches[0].file,offset:matches[0].source + offset - matches[0].start} : null;
            };
            const range = (start,end) => {
                const segment = segments.find(item=>start >= item.start && end <= item.end);
                return segment ? {file:segment.file,start:segment.source + start - segment.start,end:segment.source + end - segment.start,quote:segment.quote} : null;
            };
            const fragment = parseFragment(html,{sourceCodeLocationInfo:true});
            const pending = [...fragment.childNodes], additions = [], elements = [], nodes = new Map();
            for (let cursor = 0; cursor < pending.length; cursor++) {
                if (cursor >= 20000) throw new Error('Literal HTML preview node budget exceeded.');
                const node = pending[cursor];
                if (['script','style','template','iframe','object','embed','meta','link','base'].includes(node.tagName)) continue;
                for (const child of node.childNodes || []) pending.push(child);
                const location = node.sourceCodeLocation;
                if (!node.tagName || !location?.startTag || node.attrs.some(item => item.name === 'data-fdo-ui-id')) continue;
                const first = at(location.startOffset), last = at(location.endOffset - 1);
                if (!first || first.file !== last?.file || first.offset > last.offset) continue;
                if (elements.length >= 1000) throw new Error('Literal HTML preview supports up to 1,000 mapped elements.');
                const id = 'html-literal-' + (existing.length + elements.length + 1);
                const start = point(first.file,first.offset), end = point(last.file,last.offset + 1);
                const children = node.childNodes || [];
                const textNode = children.length === 1 && children[0].nodeName === '#text' ? children[0] : null;
                const textLocation = textNode?.sourceCodeLocation;
                const textStart = textLocation && at(textLocation.startOffset), textEnd = textLocation && at(textLocation.endOffset - 1);
                const unchangedText = textStart && textEnd?.file === textStart.file && segments.some(segment => segment.start <= textLocation.startOffset && segment.end >= textLocation.endOffset) && textEnd.offset - textStart.offset + 1 === textLocation.endOffset - textLocation.startOffset;
                const text = unchangedText ? {kind:'html-literal',file:textStart.file,start:textStart.offset,end:textEnd.offset + 1,value:textNode.value} : null;
                nodes.set(id,node);
                elements.push({id,tag:node.tagName,label:node.tagName + (text?.value.trim() ? ' · ' + text.value.trim().slice(0,60) : ''),
                    location:{path:first.file,...start,endLine:end.line,endColumn:end.column},text,styles:[],classNames:[],htmlLiteral:true,
                    structure:{file:first.file,start:first.offset,end:last.offset + 1,unique:true,removable:false,reason:'Literal HTML: select plain text to edit it. Supported direct siblings can be reordered; passive text without identity or bindings can be duplicated. Other insertions, removals and binding changes stay in the IDE. Inline style overrides are local to this element. Supported labels and hints are under Element attributes.'}});
                const insert = htmlAttributeInsertion(node,html);
                additions.push({offset:insert,value:' data-fdo-ui-id="' + id + '"'});
            }
            for (const element of elements) {
                const uses = elements.filter(item => item.structure.file === element.structure.file && item.structure.start === element.structure.start).length;
                element.structure.unique = uses === 1;
                describeHtmlLiteralAttributes(element,nodes.get(element.id),html,range);
                describeHtmlLiteralStyle(element,nodes.get(element.id),range);
            }
            describeHtmlLiteralStructure(elements,nodes,range);
            if (html.length + additions.reduce((sum,item)=>sum + item.value.length,0) > 500000) throw new Error('Mapped HTML preview output exceeds 500 KB.');
            for (const addition of additions.sort((a,b)=>b.offset-a.offset)) html = html.slice(0,addition.offset) + addition.value + html.slice(addition.offset);
            return {html,elements};
        },
    };
}
