import {parse} from '@babel/parser';
import postcss from 'postcss';

// These are source excerpts for model context, never replacement workspace
// files. Preserve inferred return implementations rather than inventing types.
export function compactWorkspaceDependency(path, content) {
    if (content.length <= 1800) return content;
    try {
        if (/\.css$/i.test(path)) {
            const root = postcss.parse(content, {from: path});
            const entries = new Set();
            root.walkRules(rule => entries.add(`${rule.selector} { /* declarations omitted */ }`));
            root.walkAtRules(rule => {
                if (rule.name === 'import' || /keyframes$/i.test(rule.name)) entries.add(`@${rule.name} ${rule.params}${rule.nodes ? ' { /* frames omitted */ }' : ';'}`);
            });
            root.walkDecls(decl => {
                if (decl.prop.startsWith('--')) entries.add(`/* custom property: ${decl.prop} */`);
            });
            return `/* Selector inventory; implementation remains in the completed stylesheet. */\n${[...entries].join('\n')}`;
        }
        if (!/\.[cm]?[jt]sx?$/i.test(path)) return content;
        const ast = parse(content, {sourceType: 'unambiguous', allowUndeclaredExports: true,
            plugins: ['typescript', 'jsx', 'decorators-legacy']});
        const excerpts = [];
        for (const statement of ast.program.body) {
            // Keep imports, exports, declarations and their supporting types.
            // Executable top-level setup is irrelevant to consumers' interfaces.
            if (!/Declaration$/.test(statement.type)) continue;
            const edits = [];
            const visit = node => {
                if (!node || typeof node !== 'object') return;
                if (node.body && (node.returnType || node.kind === 'constructor')
                    && /^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression|ClassMethod|ClassPrivateMethod|ObjectMethod)$/.test(node.type)) {
                    edits.push({start: node.body.start, end: node.body.end, text: '{ /* implementation omitted */ }'});
                    return;
                }
                // Explicitly typed values carry their public shape in the type
                // annotation. Untyped values retain their initializer verbatim.
                if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier' && node.id.typeAnnotation && node.init) {
                    edits.push({start: node.init.start, end: node.init.end, text: '/* value omitted; see declared type */ undefined'});
                    return;
                }
                for (const [key, value] of Object.entries(node)) {
                    if (['loc', 'comments', 'leadingComments', 'trailingComments', 'innerComments'].includes(key)) continue;
                    if (Array.isArray(value)) value.forEach(visit);
                    else if (value && typeof value === 'object') visit(value);
                }
            };
            visit(statement);
            let excerpt = content.slice(statement.start, statement.end);
            for (const edit of edits.sort((a, b) => b.start - a.start)) {
                excerpt = excerpt.slice(0, edit.start - statement.start) + edit.text + excerpt.slice(edit.end - statement.start);
            }
            excerpts.push({statement, excerpt});
        }
        // Consumers need the public interface and the declarations it refers
        // to, not every private helper or test fixture accumulated so far.
        // Keep inferred implementations intact and conservatively retain any
        // declaration named in a retained excerpt (including type references).
        // CommonJS/export= shapes cannot be resolved this way.
        if (/\b(?:module\s*\.\s*exports|exports\s*[.\[])/.test(content)
            || ast.program.body.some(node => node.type === 'TSExportAssignment')) return content;
        const retained = new Set(excerpts.filter(({statement}) =>
            statement.type.startsWith('Export') || statement.type === 'ImportDeclaration'));
        const names = node => {
            if (!node) return [];
            if (node.type === 'Identifier') return [node.name];
            if (node.type === 'ObjectPattern') return node.properties.flatMap(item => names(item.value || item.argument));
            if (node.type === 'ArrayPattern') return node.elements.flatMap(names);
            if (node.type === 'RestElement') return names(node.argument);
            if (node.type === 'AssignmentPattern') return names(node.left);
            return [];
        };
        let changed = true;
        while (changed) {
            changed = false;
            const referenced = new Set([...retained].flatMap(item => item.excerpt.match(/[$\p{ID_Start}][$\u200C\u200D\p{ID_Continue}]*/gu) || []));
            for (const item of excerpts) {
                const bindings = [...names(item.statement.id), ...(item.statement.declarations || []).flatMap(declaration => names(declaration.id))];
                if (!retained.has(item) && (!bindings.length || bindings.some(name => referenced.has(name)))) {
                    retained.add(item);
                    changed = true;
                }
            }
        }
        return `/* Dependency declarations only; omitted implementations remain in the completed file. Do not copy these excerpts as source. */\n${excerpts.filter(item => retained.has(item)).map(item => item.excerpt).join('\n')}`;
    } catch {
        // Context compaction must never make valid source unavailable merely
        // because its syntax is unsupported by this optional optimization.
        return content;
    }
}
