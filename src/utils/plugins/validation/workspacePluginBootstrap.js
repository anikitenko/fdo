import {parse} from '@babel/parser';
import traverseModule from '@babel/traverse';
const traverse = traverseModule.default || traverseModule;

// The host entry contract requires construction. Add only the missing startup
// of one concrete, unused SDK subclass with the SDK's inherited constructor.
export function repairPluginBootstrap({path = '', content = ''}) {
    const unchanged = {content, repaired: false};
    if (!/^\/index\.[cm]?[jt]sx?$/.test(path)) return unchanged;
    try {
        const ast = parse(content, {sourceType: 'module', plugins: ['typescript', 'jsx', 'decorators-legacy']});
        let candidate;
        traverse(ast, {Program(program) {
            const classes = program.get('body').map(statement => statement.isExportDeclaration()
                ? statement.get('declaration') : statement).filter(statement => statement?.isClassDeclaration?.());
            const sdkClasses = classes.filter(statement => {
                const base = statement.node.superClass;
                if (base?.type !== 'Identifier') return false;
                const binding = statement.scope.getBinding(base.name)?.path;
                return binding?.isImportSpecifier() && binding.parent.source.value === '@anikitenko/fdo-sdk'
                    && binding.parent.importKind !== 'type' && binding.node.importKind !== 'type'
                    && ['FDO_SDK', 'FDOSDK'].includes(binding.node.imported.name);
            });
            if (sdkClasses.length !== 1) return;
            const declaration = sdkClasses[0];
            const node = declaration.node;
            if (!node.id || node.abstract || node.declare || node.decorators?.length
                || node.body.body.some(member => member.kind === 'constructor')) return;
            const binding = program.scope.getBinding(node.id.name);
            if (!binding?.constant) return;
            // Existing construction, factories, registration and exports via
            // other statements are ambiguous; leave them to normal validation.
            if (binding.referencePaths.some(reference => {
                if (reference === declaration.parentPath || reference.node === declaration.parentPath.node) return false;
                return reference.node.start < node.start || reference.node.end > node.end;
            })) return;
            candidate = node.id.name;
        }});
        return candidate ? {content: `${content.trimEnd()}\n\nnew ${candidate}();\n`, repaired: true} : unchanged;
    } catch { return unchanged; }
}
