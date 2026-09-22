import {parse} from '@babel/parser';
import postcss from 'postcss';

// Parse source as data, in both the editor and staged generation. Never execute
// generated code or resolve imports while a workspace is still being assembled.
export function validateGeneratedFileSyntax({path = '', content = ''}, {entry = false} = {}) {
    const errors = [];
    try {
        if (/\.css$/i.test(path)) {
            postcss.parse(content, {from: path});
        } else if (/\.json$/i.test(path)) {
            JSON.parse(content);
        } else if (/\.[cm]?[jt]sx?$/i.test(path)) {
            const ast = parse(content, {sourceType: 'unambiguous',
                allowUndeclaredExports: true, plugins: ['typescript', 'jsx', 'decorators-legacy']});
            if (!entry) return errors;
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
                const isConstruction = expression => expression?.type === 'NewExpression'
                    && expression.callee.type === 'Identifier' && expression.callee.name === name;
                const instantiated = declarations.some(statement => isConstruction(statement)
                    || (statement.type === 'ExpressionStatement' && isConstruction(statement.expression))
                    || (statement.type === 'VariableDeclaration' && statement.declarations.some(declaration => isConstruction(declaration.init))));
                if (!name || !instantiated) {
                    errors.push(`${path}: plugin entry file must instantiate its plugin at module scope, for example new ${name || 'Plugin'}(); Comments, strings and uncalled functions do not instantiate it.`);
                }
            }
        }
    } catch (error) {
        const line = error.loc?.line || error.line;
        const column = error.loc ? error.loc.column + 1 : error.column;
        errors.push(`${path}${line ? `:${line}:${column || 1}` : ''}: invalid source syntax: ${error.reason || error.message}`);
    }
    return errors;
}
