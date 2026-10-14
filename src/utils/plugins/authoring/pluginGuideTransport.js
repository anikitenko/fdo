// The host already owns /SKILL.md. Decode Markdown as a document, not as
// several independent source files. Never concatenate separate file sections.
export function decodePluginGuide(text) {
    return decodeWorkspaceMarkdown(text, "/SKILL.md");
}

export function decodeWorkspaceMarkdown(text, path) {
    let source = text.trim();
    const heading = /^### File: ([^\r\n]+)\r?\n/.exec(source);
    if (heading) {
        if (heading[1] !== path) throw new Error('Markdown file heading does not match the requested path.');
        source = source.slice(heading[0].length);
    }
    const outer = /^(`{3,})(?:markdown|md)?[ \t]*\r?\n([\s\S]*)\r?\n\1$/.exec(source);
    const content = outer ? outer[2] : source;
    if (!/^# [^\r\n]+\r?\n/.test(content)) return null;
    if (/^\s*### File:/m.test(content)) throw new Error(`A Markdown response must contain only ${path}, without additional File headings.`);
    const lines = content.split('\n');
    let fence = null;
    let titles = 0;
    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        if (!fence && /^# /.test(line) && ++titles > 1) throw new Error('Return one Markdown document with one top-level title.');
        const marker = /^([ \t]*)(`{3,}|~{3,})([^\r\n]*)\r?$/.exec(line);
        if (!marker) continue;
        const [, indent, run, info] = marker;
        if (!fence) {
            if (run[0] === '`' && info.includes('`')) throw new Error(`Invalid Markdown code fence in ${path}.`);
            fence = {character: run[0], length: run.length, start: index};
            if (run[0] === '`') lines[index] = `${indent}~~~${info.trimEnd()}`;
        } else if (run[0] === fence.character && run.length >= fence.length && !info.trim()) {
            if (fence.character === '`') lines[index] = `${indent}~~~`;
            fence = null;
        } else if (fence.character === '`' && run[0] === '~') {
            // Avoid changing literal example text into a closing delimiter.
            throw new Error('A backtick example contains tilde fence lines; return the guide with unambiguous tilde-fenced examples.');
        } else if (fence.character === '`' && run[0] === '`' && run.length >= fence.length && info.trim()) {
            throw new Error(`Ambiguous nested Markdown fences in ${path}. Use four backticks for the outer document and three for examples.`);
        }
    }
    if (fence) throw new Error(`Unclosed Markdown code fence in ${path} at line ${fence.start + 1}. Return the complete document.`);
    return lines.join('\n');
}
