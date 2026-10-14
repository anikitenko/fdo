import {parse} from '@babel/parser';
import postcss from 'postcss';

// Babel's TypeScript parser permits some import/local redeclarations that its
// transform scope builder rejects later. Check runtime bindings before a file
// is accepted, without rejecting separate type/value namespaces or inner scopes.
function conflictingImportBindings(body) {
    const imports = new Map();
    for (const node of body) {
        if (node.type !== 'ImportDeclaration' || node.importKind === 'type') continue;
        for (const specifier of node.specifiers) {
            if (specifier.importKind !== 'type') imports.set(specifier.local.name, specifier.local);
        }
    }
    const identifiers = pattern => {
        if (!pattern) return [];
        if (pattern.type === 'Identifier') return [pattern];
        if (pattern.type === 'RestElement') return identifiers(pattern.argument);
        if (pattern.type === 'AssignmentPattern') return identifiers(pattern.left);
        if (pattern.type === 'ArrayPattern') return pattern.elements.flatMap(identifiers);
        if (pattern.type === 'ObjectPattern') return pattern.properties.flatMap(property =>
            identifiers(property.type === 'RestElement' ? property.argument : property.value));
        return [];
    };
    return body.flatMap(statement => {
        const node = statement.declaration || statement;
        const bindings = node.type === 'VariableDeclaration'
            ? node.declarations.flatMap(declaration => identifiers(declaration.id))
            : ['FunctionDeclaration', 'ClassDeclaration', 'TSEnumDeclaration'].includes(node.type)
                ? identifiers(node.id) : [];
        return bindings.filter(binding => imports.has(binding.name)).map(binding => ({
            loc: binding.loc?.start,
            message: `Import binding '${binding.name}' at line ${imports.get(binding.name).loc?.start.line} conflicts with a local runtime declaration. Alias the import and update its references, or re-export the imported implementation without redeclaring it. A wrapper must call the imported alias, not itself.`,
        }));
    });
}

// The entry-shape contract keys on one observable fact: a value import of the
// SDK base from the official package. Exported so the staged repair prompt can
// state the same condition this validator enforces — the trigger below checks
// the same source, specifier type, import kinds and SDK base names.
export function importsPluginSdkBase(content = '') {
    try {
        const ast = parse(content, {sourceType: 'unambiguous',
            allowUndeclaredExports: true, plugins: ['typescript', 'jsx', 'decorators-legacy']});
        return ast.program.body.some(node => node.type === 'ImportDeclaration'
            && node.source.value === '@anikitenko/fdo-sdk' && node.importKind !== 'type'
            && node.specifiers.some(specifier => specifier.type === 'ImportSpecifier'
                && specifier.importKind !== 'type'
                && ['FDO_SDK', 'FDOSDK'].includes(specifier.imported.name || specifier.imported.value)));
    } catch {
        return false; // Unparseable repairs get no shape note; the syntax rejection owns them.
    }
}

// Parse source as data, in both the editor and staged generation. Never execute
// generated code or resolve imports while a workspace is still being assembled.
export function validateGeneratedFileSyntax({path = '', content = ''}, {entry = false} = {}) {
    const errors = [];
    let topLevelBindings = [];
    let staticSdkDestructures = new Set();
    // Quote the parser's exact position: babel reports where it stopped
    // but never what it found there, and a live model re-emitted the same
    // invalid expression twice while "expected }" gave it nothing to
    // localize. The window is the source itself at the reported
    // line/column — read verbatim, never interpreted.
    const syntaxErrorMessage = error => {
        const line = error.loc?.line || error.line;
        const column = error.loc ? error.loc.column + 1 : error.column;
        const rows = typeof content === 'string' ? content.split('\n') : [];
        const row = line >= 1 && line <= rows.length ? String(rows[line - 1]) : '';
        const at = column >= 1 ? column - 1 : 0;
        const window = row ? `${row.slice(Math.max(0, at - 60), at)}|${row.slice(at, at + 60)}` : '';
        // Babel states what it expected and never what it found; the marker
        // showed the found text only visually, and a live model repeated a
        // stray-comma defect three times while the sentence beside it read
        // merely "expected \":\"". Name the token the source actually has at
        // the reported position: the word beginning there, else the single
        // punctuation character — read from the source, never interpreted.
        let scan = at;
        while (row && scan < row.length && /\s/.test(row[scan]) && scan - at < 8) scan++;
        const char = row ? row[scan] : undefined;
        const found = char === undefined ? ''
            : /[\w$]/.test(char) ? (row.slice(scan).match(/^[\w$]+/) || [''])[0] : char;
        // A redeclaration names only the DUPLICATE site; the fix lives at the
        // original declaration, which babel never reports — a live model
        // nudged seven characters around its 16,000-char file twice while the
        // pair stayed split across it. List every declaration of that
        // identifier by verbatim keyword matching, never by interpretation.
        let redeclaration = '';
        const declarationMatch = /Identifier '([^']+)' has already been declared/.exec(String(error.reason || error.message || ''));
        if (declarationMatch && typeof content === 'string') {
            const escaped = declarationMatch[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const declarationPattern = new RegExp(`(?:function\\*?|class|const|let|var)\\s+${escaped}\\b`);
            const declarationLines = [...new Set([
                ...topLevelBindings.filter(binding => binding.name === declarationMatch[1]).map(binding => binding.loc?.start.line).filter(Boolean),
                ...rows.map((source, index) => (declarationPattern.test(source) && !/^\s*(?:\/\/|\*)/.test(source) ? index + 1 : 0)).filter(Boolean),
            ])].sort((a, b) => a - b);
            if (declarationLines.length >= 2) {
                const shownSites = declarationLines.slice(0, 6).join(', ')
                    + (declarationLines.length > 6 ? `, … (+${declarationLines.length - 6} more)` : '');
                redeclaration = ` ${declarationMatch[1]} is declared at line${declarationLines.length === 1 ? '' : 's'} ${shownSites} — exactly one declaration may remain; delete or rename the others.`;
                if (staticSdkDestructures.has(declarationMatch[1])) redeclaration += ' One declaration destructures helpers from the SDK DOM class. Those are not static constructor properties; use the installed instance methods and HTML-string helpers, not invented JSX factories. Resolve the rendering contract as well as the duplicate name.';
            }
        }
        // A live model returned this file three times byte-identical against
        // this rejection: an unescaped inner backtick closed the enclosing
        // handler template early and babel's symptom ("expected \",\"" at
        // Cyrillic text) points past the cause — the reported row reads
        // perfectly valid alone, so the model found nothing to change. The
        // cause is decidable from characters and the parser's own position,
        // never from intent: a backtick one or two characters before the
        // reported token must have CLOSED a template (otherwise that token
        // would sit in template text and could not error), and a second
        // unescaped backtick later on the row shows quoting continues after
        // the close. Name both positions and the two ways out.
        let templateNote = '';
        if (row && at > 0) {
            const closer = row.lastIndexOf('`', at);
            let probe = at;
            let reopened = -1;
            while ((probe = row.indexOf('`', probe)) !== -1) {
                if (row[probe - 1] !== '\\') { reopened = probe; break; }
                probe++;
            }
            if (closer >= 0 && at - closer <= 2 && row[closer - 1] !== '\\' && reopened !== -1) {
                templateNote = ` The unescaped backtick at ${line}:${closer + 1} closed a template literal opened earlier: the parser resumed reading code right after it, so the rest of this row parses as code — that is why it stops here. Escape it and the next unescaped backtick on this row by putting a backslash before each, keeping the whole span template text, or hold this message in ordinary quoted strings so no backtick crosses the template boundary.`;
            }
        }
        // A function-valued property uses a function TYPE, not a method's
        // return annotation. Describe the grammar only when the parser asked
        // for an arrow at this exact colon; never rewrite source heuristically.
        const functionTypeNote = /\.[cm]?tsx?$/i.test(path) && found === ':'
            && String(error.reason || error.message).includes('expected "=>"')
            ? ' Function-type syntax uses => before the return type: readonly handler: (context: Context) => void;. Method syntax is handler(context: Context): void;. Do not mix the property colon with a method return annotation. Preserve the property name, parameter types and return type; replace the reported return-type colon with => for the function-valued property. Inspect other function types in this file for the same mistake.'
            : '';
        return `${path}${line ? `:${line}:${column || 1}` : ''}: invalid source syntax: ${error.reason || error.message}${found ? ` The source has ${JSON.stringify(found)} there.` : ''}${redeclaration}${templateNote}${functionTypeNote}${window ? ` Source at that position (| marks ${line}:${column || 1}): "${window}"` : ''}`;
    };
    try {
        if (/\.css$/i.test(path)) {
            postcss.parse(content, {from: path});
        } else if (/\.json$/i.test(path)) {
            JSON.parse(content);
        } else if (/\.[cm]?[jt]sx?$/i.test(path)) {
            const ast = parse(content, {sourceType: 'unambiguous',
                allowUndeclaredExports: true, errorRecovery: true, plugins: ['typescript', 'jsx', 'decorators-legacy']});
            const bindingIds = node => {
                if (!node) return [];
                if (node.type === 'Identifier') return [node];
                if (node.type === 'RestElement') return bindingIds(node.argument);
                if (node.type === 'AssignmentPattern') return bindingIds(node.left);
                if (node.type === 'ArrayPattern') return node.elements.flatMap(bindingIds);
                if (node.type === 'ObjectPattern') return node.properties.flatMap(property => bindingIds(property.value || property.argument));
                return [];
            };
            const sdkDomImports = new Set(ast.program.body.filter(node => node.type === 'ImportDeclaration'
                && node.source.value === '@anikitenko/fdo-sdk').flatMap(node => node.specifiers.filter(item => item.type === 'ImportSpecifier'
                    && item.imported.name === 'DOM' && item.importKind !== 'type' && node.importKind !== 'type').map(item => item.local.name)));
            topLevelBindings = ast.program.body.flatMap(statement => {
                const node = statement.declaration || statement;
                if (node.type === 'ImportDeclaration') return node.specifiers.map(item => item.local);
                if (node.type === 'VariableDeclaration') return node.declarations.flatMap(declaration => {
                    const bindings = bindingIds(declaration.id);
                    if (declaration.id.type === 'ObjectPattern' && declaration.init?.type === 'Identifier' && sdkDomImports.has(declaration.init.name)) {
                        bindings.forEach(binding => staticSdkDestructures.add(binding.name));
                    }
                    return bindings;
                });
                return ['FunctionDeclaration', 'ClassDeclaration'].includes(node.type) && node.id ? [node.id] : [];
            });
            if (ast.errors?.length) {
                // Recovery-mode messages state the grammar rule and point at the
                // offending token — a live file reported "'readonly' type
                // modifier is only permitted on array and tuple literal types"
                // at `readonly` here, where the thrown first-error path blamed a
                // nearby `)` and a repair round went into understanding it.
                // Report every recovered error, bounded and deduplicated, so one
                // round can clear more than the first defect; the entry-shape
                // analysis below runs only on source that parsed clean.
                const seen = new Set();
                for (const error of ast.errors) {
                    if (errors.length >= 3) break;
                    const message = syntaxErrorMessage(error);
                    if (seen.has(message)) continue;
                    seen.add(message);
                    errors.push(message);
                }
                return errors;
            }
            for (const conflict of conflictingImportBindings(ast.program.body).slice(0, 3)) {
                errors.push(syntaxErrorMessage(conflict));
            }
            if (errors.length || !entry) return errors;
            const body = ast.program.body;
            const sdkNames = new Set(['FDO_SDK', 'FDOSDK']);
            let importsSdkBase = false;
            for (const node of body) {
                if (node.type !== 'ImportDeclaration' || node.source.value !== '@anikitenko/fdo-sdk') continue;
                for (const specifier of node.specifiers) {
                    if (specifier.type === 'ImportSpecifier' && specifier.importKind !== 'type'
                        && node.importKind !== 'type' && sdkNames.has(specifier.imported.name)) {
                        sdkNames.add(specifier.local.name);
                        importsSdkBase = true;
                    }
                }
            }
            const declarations = body.map(node => node.declaration || node);
            const classes = declarations.filter(node => node.type === 'ClassDeclaration'
                && node.superClass?.type === 'Identifier' && sdkNames.has(node.superClass.name));
            if (importsSdkBase && !classes.length) {
                errors.push(`${path}: plugin entry imports the SDK base but has no executable plugin class. Preserve real newlines; a // comment must not swallow declarations.`);
            }
            for (const node of classes) {
                const name = node.id?.name;
                const isConstruction = expression => {
                    if (!expression) return false;
                    if (expression.type === 'NewExpression'
                        && expression.callee.type === 'Identifier' && expression.callee.name === name) return true;
                    // Arguments of ordinary calls are evaluated immediately:
                    // registerPlugin(new Plugin()) constructs at module scope.
                    // Do not descend into callbacks, optional calls or branches,
                    // where construction may never execute.
                    if (['CallExpression', 'NewExpression'].includes(expression.type) && !expression.optional) {
                        return expression.arguments.some(isConstruction);
                    }
                    if (['TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression', 'TSTypeAssertion', 'ParenthesizedExpression'].includes(expression.type)) {
                        return isConstruction(expression.expression);
                    }
                    return false;
                };
                const instantiated = declarations.some(statement => isConstruction(statement)
                    || (statement.type === 'ExpressionStatement' && isConstruction(statement.expression))
                    || (statement.type === 'VariableDeclaration' && statement.declarations.some(declaration => isConstruction(declaration.init))));
                if (!name || !instantiated) {
                    errors.push(`${path}: plugin entry file must instantiate its plugin at module scope, for example new ${name || 'Plugin'}(); Comments, strings and uncalled functions do not instantiate it.`);
                }
            }
        }
    } catch (error) {
        errors.push(syntaxErrorMessage(error));
    }
    return errors;
}
