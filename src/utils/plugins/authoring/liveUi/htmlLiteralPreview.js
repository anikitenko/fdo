import {describeHtmlLiteralStructure} from './htmlLiteralStructure';
import {describeHtmlLiteralStyle} from './htmlLiteralStyles';
import {describeHtmlLiteralAttributes, htmlAttributeInsertion} from './htmlLiteralAttributes';
import {parseFragment} from 'parse5';

// Carry source provenance beside strings, never inside authored values. This
// keeps literal attributes, escaping, replacements and SDK arguments unchanged.
export function createHtmlLiteralMapper(files) {
    const origins = new Map();
    const transformed = new Map();
    let mappedSegments = 0;
    const remember = (value, segments, changes = []) => {
        if (changes.length) {
            const combined = [...(transformed.get(value) || []),...changes];
            if (combined.length > 20000) throw new Error('HTML source mapping budget exceeded.');
            transformed.set(value,combined);
        }
        segments = segments.filter(segment=>segment.end > segment.start);
        if (!segments.length) return;
        if (segments.length > 20000 || (mappedSegments += segments.length) > 100000) throw new Error('HTML source mapping budget exceeded.');
        if (origins.has(value) && JSON.stringify(origins.get(value)) !== JSON.stringify(segments)) origins.set(value, null);
        else if (!origins.has(value)) origins.set(value, segments);
    };
    const point = (file, offset) => {
        const prefix = files[file].slice(0, offset), newline = prefix.lastIndexOf('\n');
        return {line: prefix.split('\n').length, column: offset - newline};
    };
    const concatenate = parts => {
        let value = '', segments = [], changes = [];
        for (const part of parts) {
            const text = String(part);
            if (value.length + text.length > 500000) throw new Error('Preview output exceeds 500 KB.');
            const mapped = origins.get(text);
            changes.push(...(transformed.get(text) || []).map(change=>({start:change.start + value.length,end:change.end + value.length})));
            if (mapped) segments.push(...mapped.map(segment => ({...segment,start:segment.start + value.length,end:segment.end + value.length})));
            value += text;
        }
        remember(value, segments, changes);
        return value;
    };
    return {
        literal(node, file, value) {
            if (typeof value !== 'string') return value;
            // Only unchanged source bytes acquire writable offsets. Escapes and
            // computed text remain protected even when their surrounding markup maps.
            if (files[file].slice(node.start + 1, node.end - 1) === value) remember(value, [{start:0,end:value.length,file,source:node.start + 1,quote:files[file][node.start]}]);
            return value;
        },
        template(node, file, values) {
            let value = '', segments = [], changes = [];
            node.quasis.forEach((quasi,index) => {
                const text = quasi.value.cooked;
                if (value.length + text.length > 500000) throw new Error('Preview output exceeds 500 KB.');
                if (text && files[file].slice(quasi.start,quasi.end) === text) segments.push({start:value.length,end:value.length + text.length,file,source:quasi.start,quote:'`'});
                value += text;
                if (index < values.length) {
                    const text = String(values[index]), mapped = origins.get(text);
                    if (value.length + text.length > 500000) throw new Error('Preview output exceeds 500 KB.');
                    if (mapped) segments.push(...mapped.map(segment => ({...segment,start:value.length + segment.start,end:value.length + segment.end})));
                    changes.push(...(transformed.get(text) || []).map(change=>({start:change.start + value.length,end:change.end + value.length})));
                    value += text;
                }
            });
            remember(value, segments, changes);
            return value;
        },
        concatenate,
        wrap(input, output) {
            const segments = origins.get(input);
            const shift = input ? output.indexOf(input) : -1;
            if (segments && shift >= 0 && shift === output.lastIndexOf(input)) {
                remember(output,segments.map(segment => ({...segment,start:segment.start + shift,end:segment.end + shift})),
                    (transformed.get(input) || []).map(change=>({start:change.start + shift,end:change.end + shift})));
            }
        },
        replace(input, output, copies) {
            const segments = origins.get(input);
            if (!segments) return;
            const changes = [];
            let cursor = 0;
            for (const copy of copies) {
                if (copy.output > cursor) changes.push({start:cursor,end:copy.output});
                for (const change of transformed.get(input) || []) {
                    const start = Math.max(copy.start,change.start), end = Math.min(copy.end,change.end);
                    if (start < end) changes.push({start:copy.output + start - copy.start,end:copy.output + end - copy.start});
                }
                cursor = copy.output + copy.end - copy.start;
            }
            if (cursor < output.length) changes.push({start:cursor,end:output.length});
            const retained = copies.flatMap(copy => segments.flatMap(segment => {
                const start = Math.max(copy.start, segment.start), end = Math.min(copy.end, segment.end);
                return start < end ? [{start:copy.output + start - copy.start,end:copy.output + end - copy.start,file:segment.file,source:segment.source + start - segment.start,quote:segment.quote}] : [];
            }));
            remember(output, retained, changes);
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
            const unique = source => !!source && segments.filter(segment=>segment.file === source.file && source.start >= segment.source
                && source.end <= segment.source + segment.end - segment.start).length === 1;
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
                const captions = children.filter(child=>child.nodeName === '#text' && child.value.trim());
                const textNode = children.length === 1 && children[0].nodeName === '#text' ? children[0] : captions.length === 1 ? captions[0] : null;
                const textLocation = textNode?.sourceCodeLocation;
                const textStart = textLocation && at(textLocation.startOffset), textEnd = textLocation && at(textLocation.endOffset - 1);
                const unchangedText = textStart && textEnd?.file === textStart.file && segments.some(segment => segment.start <= textLocation.startOffset && segment.end >= textLocation.endOffset) && textEnd.offset - textStart.offset + 1 === textLocation.endOffset - textLocation.startOffset;
                const text = unchangedText ? {kind:'html-literal',file:textStart.file,start:textStart.offset,end:textEnd.offset + 1,value:textNode.value,
                    ...(children.length > 1 ? {partial:true} : {})} : null;
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
                const tag = nodes.get(element.id).sourceCodeLocation.startTag;
                const changedTag = (transformed.get(html) || []).some(change=>change.start < tag.endOffset && change.end > tag.startOffset);
                describeHtmlLiteralAttributes(element,nodes.get(element.id),html,range,unique,changedTag);
                describeHtmlLiteralStyle(element,nodes.get(element.id),range,unique);
            }
            describeHtmlLiteralStructure(elements,nodes,range);
            if (html.length + additions.reduce((sum,item)=>sum + item.value.length,0) > 500000) throw new Error('Mapped HTML preview output exceeds 500 KB.');
            for (const addition of additions.sort((a,b)=>b.offset-a.offset)) html = html.slice(0,addition.offset) + addition.value + html.slice(addition.offset);
            return {html,elements};
        },
    };
}
