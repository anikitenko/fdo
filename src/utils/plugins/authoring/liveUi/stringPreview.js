// Native regex execution is restricted to fixed-width patterns plus audited
// linear whitespace and quoted-attribute patterns. Never run arbitrary regexes.
const whitespacePatterns = new Set(['\\s+', '^\\s+', '[\\r\\n]+', '\\r?\\n']);
const escapedAtoms = new Set([...'dDsSwWbBtnrvf0\\^$.*+?()[]{}|/']);
function quotedAttributePattern(pattern) {
    const prefix = /^([A-Za-z_:][A-Za-z0-9_:-]{0,63})=(["'])/.exec(pattern);
    if (!prefix) return false;
    const quote = prefix[2];
    // The repeated body cannot consume its terminator. A later candidate prefix
    // contains that same quote, so failed searches cannot rescan overlapping
    // unbounded bodies. This admits class="[^"]*", not general repetition.
    return pattern === `${prefix[1]}=${quote}[^${quote}]*${quote}`;
}
export function previewRegExp(pattern, flags, reject) {
    if (pattern.length > 128 || !/^[giu]*$/.test(flags)) reject('Preview replacement patterns support up to 128 characters and only g/i/u flags.');
    if (!whitespacePatterns.has(pattern) && !quotedAttributePattern(pattern)) {
        let inClass = false;
        for (let index = 0; index < pattern.length; index++) {
            const char = pattern[index];
            if (char === '\\') {
                if (!escapedAtoms.has(pattern[++index])) reject('This replacement pattern needs a preview adapter. Use a literal search or a fixed-width pattern; captures, backreferences and general repetition are not supported.');
            } else if (char === '[' && !inClass) inClass = true;
            else if (char === ']' && inClass) inClass = false;
            else if (!inClass && '*+?{}()|'.includes(char)) reject('This replacement pattern needs a preview adapter. Use a literal search or a fixed-width pattern; captures, backreferences and general repetition are not supported.');
        }
        if (inClass) reject('The replacement character class is not closed.');
    }
    try {return new RegExp(pattern, flags);}
    catch {reject('This replacement pattern is not valid.');}
}

// Build output incrementally. In particular $` and $' can expand quadratically;
// reject before allocating a large joined string, even for trusted native search.
export function replacePreviewString(input, search, replacement, {all, reject, invoke, tick, onCopy}) {
    if (typeof search !== 'string' && !(search instanceof RegExp)) reject('Preview replace requires a string or supported literal regular expression.');
    const callback = replacement?.kind === 'function';
    if (!callback && typeof replacement !== 'string') reject('Preview replace requires a string replacement or source-mapped render callback.');
    if (all && search instanceof RegExp && !search.global) reject('replaceAll requires a global regular expression (g flag).');
    const regex = search instanceof RegExp ? new RegExp(search.source, search.flags) : null;
    const global = all || !!regex?.global;
    const chunks = [];
    let length = 0, cursor = 0, position = 0;
    const append = text => {
        length += text.length;
        if (length > 500000) reject('Preview output exceeds 500 KB.');
        chunks.push(text);
    };
    const copy = (start, end) => {
        if (end > start) onCopy?.({start,end,output:length});
        append(input.slice(start,end));
    };
    const substitute = (matched, offset) => {
        if (callback) {
            const value = invoke(replacement, [matched, offset, input]);
            if (value !== null && typeof value === 'object') reject('Replacement callbacks must return primitive text, not objects or instances.');
            append(String(value));
            return;
        }
        let cursor = 0;
        for (let index = 0; index < replacement.length - 1; index++) {
            if (replacement[index] !== '$' || !['$', '&', '`', "'"].includes(replacement[index + 1])) continue;
            append(replacement.slice(cursor, index));
            const token = replacement[++index];
            append(token === '$' ? '$' : token === '&' ? matched : token === '`' ? input.slice(0, offset) : input.slice(offset + matched.length));
            cursor = index + 1;
        }
        append(replacement.slice(cursor));
    };
    while (position <= input.length) {
        tick();
        let matched, offset;
        if (regex) {
            regex.lastIndex = position;
            const result = regex.exec(input);
            if (!result) break;
            matched = result[0]; offset = result.index;
        } else {
            offset = input.indexOf(search, position);
            if (offset < 0) break;
            matched = search;
        }
        copy(cursor, offset);
        substitute(matched, offset);
        cursor = offset + matched.length;
        if (!global) break;
        position = cursor;
        if (!matched.length) {
            // Native Unicode global replacement advances a full code point.
            const code = input.codePointAt(position);
            position += regex?.unicode && code > 0xffff ? 2 : 1;
        }
    }
    copy(cursor, input.length);
    return chunks.join('');
}
