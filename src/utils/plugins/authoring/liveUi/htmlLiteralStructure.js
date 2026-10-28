const voidTags = new Set(['area','br','col','hr','img','input','param','source','track','wbr']);
const containers = new Set(['main','section','div','article','aside','header','footer','nav','dialog','form','ul','ol']);

export function describeHtmlLiteralStructure(elements,nodes,range) {
    const byNode = new Map(elements.map(element=>[nodes.get(element.id),element]));
    const intactSubtree = root => {
        const pending = [root];
        for (let index = 0; index < pending.length; index++) {
            const node = pending[index];
            if (node.tagName && (!byNode.has(node) || node.namespaceURI !== 'http://www.w3.org/1999/xhtml')) return false;
            for (const child of node.childNodes || []) pending.push(child);
        }
        return true;
    };
    // Duplicate passive leaves only: never clone identity, binding or reference attributes.
    const passiveTags = new Set(['p','span','h1','h2','h3','h4','h5','h6','small','strong','em','blockquote']);
    for (const element of elements) {
        const node = nodes.get(element.id), location = node.sourceCodeLocation;
        const parent = byNode.get(node.parentNode);
        const intact = location && range(location.startOffset,location.endOffset);
        if (element.structure.unique && parent?.structure.unique && containers.has(node.parentNode.tagName)
            && passiveTags.has(node.tagName) && element.text && !element.text.partial && location.endTag && intact
            && (node.attrs || []).every(attr => ['class','style','title','aria-label','aria-description','lang','dir'].includes(attr.name))) {
            element.structure.duplicable = true;
        }
    }
    for (const parent of elements) {
        const node = nodes.get(parent.id), location = node.sourceCodeLocation;
        if (!parent.structure.unique || !containers.has(node.tagName) || !location.endTag || node.namespaceURI !== 'http://www.w3.org/1999/xhtml') continue;
        const content = range(location.startTag.endOffset,location.endTag.startOffset);
        if (!content) continue;
        const children = (node.childNodes || []).filter(child=>child.nodeName !== '#comment' && (child.nodeName !== '#text' || child.value.trim()));
        const terms = children.map(child=>{
            const element = byNode.get(child), source = child.sourceCodeLocation;
            const intact = source && range(source.startOffset,source.endOffset);
            return {id:element?.id,start:intact?.start,end:intact?.end,
                movable:!!element?.structure.unique && !!intact && (!!source.endTag || voidTags.has(child.tagName)) && intact.file === content.file && child.namespaceURI === node.namespaceURI && intactSubtree(child)};
        });
        if (terms.length < 2) continue;
        parent.htmlChildren = {file:content.file,terms};
        terms.forEach((term,index)=>{
            if (!term.movable) return;
            const child = elements.find(element=>element.id === term.id);
            const allowedIndices = terms.flatMap((_,destination)=>terms.slice(Math.min(index,destination),Math.max(index,destination)+1).every(item=>item.movable) ? [destination] : []);
            child.structure.position = {parentId:parent.id,index,count:terms.length,allowedIndices,up:allowedIndices.includes(index-1),down:allowedIndices.includes(index+1)};
            child.structure.moveReason = 'Reorder direct siblings in this HTML container. Cross-container moves and binding changes stay in the IDE.';
        });
    }
}

export function planHtmlLiteralMove(files,elements,element,request) {
    const position = element.structure?.position;
    const parent = elements.find(item=>item.id === position?.parentId);
    const container = parent?.htmlChildren;
    const destination = request.index !== undefined ? request.index : position?.index + (request.direction === 'up' ? -1 : request.direction === 'down' ? 1 : 0);
    if (!element.htmlLiteral || !element.structure?.unique || !container || request.destinationId !== undefined || !Number.isInteger(destination) || destination === position.index || !position.allowedIndices.includes(destination)) throw new Error('Choose another supported sibling position in the same unchanged HTML container.');
    const first = Math.min(position.index,destination), last = Math.max(position.index,destination);
    const slots = container.terms.slice(first,last+1), ordered = [...slots];
    const [moving] = ordered.splice(position.index-first,1);
    ordered.splice(destination-first,0,moving);
    const file = container.file, before = files[file], start = slots[0].start, end = slots.at(-1).end;
    let replacement = '';
    const relocations = [];
    ordered.forEach((term,index)=>{
        relocations.push({start:term.start,end:term.end,to:start + replacement.length});
        replacement += before.slice(term.start,term.end);
        if(index < slots.length-1) replacement += before.slice(slots[index].end,slots[index+1].start);
    });
    return {file,before,after:before.slice(0,start)+replacement+before.slice(end),start,end,replacement,removed:before.slice(start,end),added:replacement,relocations,
        description:'Move ' + element.tag + ' to sibling position ' + (destination+1),affected:1};
}

export function planHtmlLiteralDuplicate(files,element) {
    if (!element.htmlLiteral || !element.structure?.unique || !element.structure.duplicable) throw new Error('Only unchanged static text elements without identity or bindings can be duplicated.');
    const {file,start,end} = element.structure;
    const before = files[file], added = before.slice(start,end);
    return {file,before,after:before.slice(0,end)+added+before.slice(end),start:end,end,replacement:added,removed:'',added,
        selectedSource:{file,start:end},description:'Duplicate ' + element.tag,affected:1};
}
