// Delete only the selected node and a separating comma. Keep comments and
// whitespace in both adjacent gaps, including commas inside comments.
export function sourceNodeRemovalRanges(source, siblings, node, closing) {
    const index = siblings.indexOf(node), next = siblings[index + 1];
    const comma = (start, end) => {
        const gap = source.slice(start, end);
        const tokens = /\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|,/g;
        for (const match of gap.matchAll(tokens)) if (match[0] === ',') return start + match.index;
        return null;
    };
    let separator = comma(node.end, next?.start ?? closing);
    if (separator == null && index > 0) separator = comma(siblings[index - 1].end, node.start);
    return [{start: node.start, end: node.end}, ...(separator == null ? [] : [{start: separator, end: separator + 1}])];
}

