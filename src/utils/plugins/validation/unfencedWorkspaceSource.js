import {parse} from '@babel/parser';

function startsWithModuleKeywordAfterLeadingComments(text) {
    let i = 0;

    while (i < text.length) {
        while (i < text.length && /\s/.test(text[i])) i++;

        if (text.startsWith('//', i)) {
            i += 2;
            while (i < text.length && text[i] !== '\n') i++;
            continue;
        }

        if (text.startsWith('/*', i)) {
            i += 2;
            const end = text.indexOf('*/', i);
            if (end === -1) return false;
            i = end + 2;
            continue;
        }

        break;
    }

    if (text.startsWith('import', i)) {
        const next = text[i + 6];
        return !(next && /[A-Za-z0-9_$]/.test(next));
    }
    if (text.startsWith('export', i)) {
        const next = text[i + 6];
        return !(next && /[A-Za-z0-9_$]/.test(next));
    }
    return false;
}

// Only recognize an entire completed module. Never extract a plausible code
// fragment from prose, repair syntax, execute source, or infer its target path.
export function isUnfencedWorkspaceModule(text, path) {
    return inspectUnfencedWorkspaceModule(text, path).valid;
}

export function inspectUnfencedWorkspaceModule(text, path) {
    if (typeof text !== 'string' || !/\.[cm]?[jt]sx?$/.test(path)
        || !text.trim() || text.length > 48000
        || /^[ \t]*(?:`{3,}|~{3,}|#{1,6}[ \t]|(?:File|Filename):)/mi.test(text)) return {valid: false};
    try {
        const ast = parse(text, {sourceType: 'module', allowUndeclaredExports: true,
            plugins: [...(/\.[cm]?tsx?$/.test(path) ? ['typescript'] : []),
                ...(/\.[jt]sx$/.test(path) ? ['jsx'] : []), 'decorators-legacy']});
        return {valid: ast.program.body.some(node => /^(?:ImportDeclaration|Export)/.test(node.type))
            && !ast.program.body.some(node => node.type === 'ExpressionStatement'
                && ['Identifier', 'StringLiteral'].includes(node.expression.type))};
    } catch (error) {
        // Report syntax only for a recognizable module start, not arbitrary
        // prose. This is diagnostic evidence, never permission to apply it.
        const moduleStart = startsWithModuleKeywordAfterLeadingComments(text);
        return {valid: false, ...(moduleStart ? {syntaxError: String(error.message).slice(0, 500)} : {})};
    }
}
