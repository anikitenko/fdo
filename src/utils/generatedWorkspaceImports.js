import {parse} from '@babel/parser';
import postcss from 'postcss';

const extensions = ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts'];
const normalize = path => {
    const parts = [];
    for (const part of path.split('/')) {
        if (part === '..') parts.pop();
        else if (part && part !== '.') parts.push(part);
    }
    return `/${parts.join('/')}`;
};

// Match the virtual workspace resolver without accessing disk or evaluating source.
export function resolveGeneratedImport(importer, specifier, paths) {
    if (!specifier.startsWith('.') && !specifier.startsWith('/')) return null;
    const base = normalize(specifier.startsWith('/') ? specifier : `${importer.slice(0, importer.lastIndexOf('/'))}/${specifier}`);
    return [base, ...extensions.map(ext => base + ext), ...extensions.map(ext => `${base}/index${ext}`)]
        .find(path => paths.has(path)) || null;
}

function analyze({path, content}) {
    const imports = [], exports = new Set();
    let unknownExports = false;
    if (/\.css$/i.test(path)) {
        postcss.parse(content).walkAtRules('import', rule => {
            const specifier = /^(?:url\(\s*)?["']([^"']+)["']/.exec(rule.params)?.[1];
            if (specifier) imports.push({specifier, names: []});
        });
        return {imports, exports: null}; // CSS becomes a generated style map.
    }
    if (!/\.[cm]?[jt]sx?$/i.test(path)) return {imports, exports: null};
    const ast = parse(content, {sourceType: 'unambiguous', allowUndeclaredExports: true,
        plugins: ['typescript', 'jsx', 'decorators-legacy']});
    const binding = node => {
        if (!node) return;
        if (node.type === 'Identifier') exports.add(node.name);
        else if (node.type === 'ObjectPattern') node.properties.forEach(item => binding(item.value || item.argument));
        else if (node.type === 'ArrayPattern') node.elements.forEach(binding);
        else if (node.type === 'RestElement') binding(node.argument);
        else if (node.type === 'AssignmentPattern') binding(node.left);
    };
    for (const node of ast.program.body) {
        if (node.type === 'ImportDeclaration') imports.push({specifier: node.source.value,
            names: node.specifiers.flatMap(item => item.type === 'ImportDefaultSpecifier' ? ['default']
                : item.type === 'ImportSpecifier' ? [item.imported.name || item.imported.value] : [])});
        if (node.type === 'ExportDefaultDeclaration') exports.add('default');
        if (node.type === 'ExportAllDeclaration') {
            unknownExports = true;
            imports.push({specifier: node.source.value, names: []});
        }
        if (node.type === 'ExportNamedDeclaration') {
            if (node.declaration?.id) binding(node.declaration.id);
            node.declaration?.declarations?.forEach(item => binding(item.id));
            node.specifiers.forEach(item => exports.add(item.exported.name || item.exported.value));
            if (node.source) imports.push({specifier: node.source.value, names: node.specifiers
                .filter(item => item.type === 'ExportSpecifier').map(item => item.local.name || item.local.value)});
        }
        if (node.type === 'TSExportAssignment') unknownExports = true;
    }
    // CommonJS export shape is dynamic. Leave its semantic checks to the compiler.
    if (/\b(?:module\s*\.\s*exports|exports\s*[.\[])/.test(content)) unknownExports = true;
    return {imports, exports: unknownExports ? null : exports};
}

// sources may include unchanged files. Validate only subjects; pending paths
// resolve successfully but their exports are checked once source is available.
export function validateGeneratedWorkspaceImports(subjects, {sources = subjects, paths, checkMissing = true} = {}) {
    const sourceMap = new Map(sources.map(file => [file.path, file]));
    const available = new Set(paths || sourceMap.keys());
    const cache = new Map();
    const read = file => {
        if (!cache.has(file.path)) {
            try { cache.set(file.path, analyze(file)); }
            catch { cache.set(file.path, {imports: [], exports: null}); } // Syntax validator owns parse failures.
        }
        return cache.get(file.path);
    };
    const errors = [];
    for (const file of subjects) {
        for (const {specifier, names} of read(file).imports) {
            if (!specifier.startsWith('.') && !specifier.startsWith('/')) continue;
            const target = resolveGeneratedImport(file.path, specifier, available);
            if (!target) {
                if (checkMissing) errors.push(`${file.path}: local import "${specifier}" has no file in the workspace or approved plan. Use an existing or planned dependency.`);
            } else if (target === file.path) {
                errors.push(`${file.path}: local import "${specifier}" resolves to this same file. Import the intended dependency instead; do not import or re-export the module itself.`);
            } else if (sourceMap.has(target)) {
                const declared = read(sourceMap.get(target)).exports;
                const missing = declared && names.filter(name => !declared.has(name));
                if (missing?.length) errors.push(`${file.path}: ${target} does not export ${missing.join(', ')}. Keep imports and the dependency's actual public interface consistent.`);
            }
        }
    }
    return errors;
}
