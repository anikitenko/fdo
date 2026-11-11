export function findWorkspaceText(files, query, {matchCase = false, wholeWord = false, includeDependencies = true, limit = 500} = {}) {
    const matches = [];
    if (!query) return {matches, truncated: false};
    const needle = matchCase ? query : query.toLowerCase();
    const word = character => !!character && /[\p{L}\p{N}_$]/u.test(character);
    for (const [filePath, content] of Object.entries(files)) {
        if (!includeDependencies && /^\/(node_modules|dist)(\/|$)/.test(filePath)) continue;
        const lines = String(content).split(/\r?\n/);
        for (let index = 0; index < lines.length; index++) {
            const line = lines[index], haystack = matchCase ? line : line.toLowerCase();
            for (let offset = haystack.indexOf(needle); offset !== -1; offset = haystack.indexOf(needle, offset + Math.max(1, needle.length))) {
                if (wholeWord && (word(line[offset - 1]) || word(line[offset + query.length]))) continue;
                if (matches.length === limit) return {matches, truncated: true};
                const start = Math.max(0, offset - 60), end = Math.min(line.length, offset + query.length + 100);
                matches.push({filePath, line: index + 1, column: offset + 1, length: query.length,
                    before: (start ? '…' : '') + line.slice(start, offset), text: line.slice(offset, offset + query.length),
                    after: line.slice(offset + query.length, end) + (end < line.length ? '…' : '')});
            }
        }
    }
    return {matches, truncated: false};
}
