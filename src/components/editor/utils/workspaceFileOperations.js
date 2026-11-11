import {parse} from '@babel/parser';
import path from 'path';
import {resolveGeneratedImport} from '../../../utils/plugins/validation/generatedWorkspaceImports';
import {normalizeVirtualWorkspacePath} from '../../../utils/plugins/virtualWorkspacePaths';
import {pluginBuildSource} from '../../../utils/plugins/runtime/pluginBuildArtifact';

export const isPathWithin = (file, parent) => file === parent || file.startsWith(`${parent}/`);
export const isEditableWorkspacePath = file => file !== '/' && !['/node_modules', '/dist'].some(dir => isPathWithin(file, dir));

export function validateWorkspaceDestination(value) {
    if (!String(value || '').trim()) throw new Error('Enter a name or path.');
    if (/[\0<>:"|?*\x01-\x1f]/.test(value) || value.replace(/\\/g, '/').split('/').some(part => part === '..' || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
        throw new Error('Use a project path without .., reserved names, trailing dots or unsupported characters.');
    }
    const filePath = normalizeVirtualWorkspacePath(value);
    if (!isEditableWorkspacePath(filePath)) throw new Error('Choose a path outside dependencies and build output.');
    return filePath;
}

function importStrings(ast) {
    const strings = new Set();
    function visit(node) {
        if (!node || typeof node !== 'object') return;
        if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration', 'ImportExpression'].includes(node.type) && node.source?.type === 'StringLiteral') strings.add(node.source);
        if (node.type === 'TSExternalModuleReference' && node.expression?.type === 'StringLiteral') strings.add(node.expression);
        if (node.type === 'TSImportType' && node.argument?.type === 'StringLiteral') strings.add(node.argument);
        if (node.type === 'CallExpression' && (node.callee?.type === 'Import' || node.callee?.type === 'Identifier' && node.callee.name === 'require') && node.arguments?.[0]?.type === 'StringLiteral') strings.add(node.arguments[0]);
        for (const [key, child] of Object.entries(node)) {
            if (['loc', 'comments', 'tokens', 'errors', 'extra'].includes(key)) continue;
            if (Array.isArray(child)) child.forEach(visit);
            else if (child && typeof child === 'object') visit(child);
        }
    }
    visit(ast);
    return [...strings];
}

// Plan every change before touching models. Only module specifiers are edited;
// ordinary strings and comments with the same text retain their contents.
export function planWorkspaceRename(content, oldPath, newPath, directory, updateImports = true) {
    const remap = file => (directory ? isPathWithin(file, oldPath) : file === oldPath) ? newPath + file.slice(oldPath.length) : file;
    const oldPaths = new Set(Object.keys(content));
    const newPaths = new Set([...oldPaths].map(remap));
    const result = {};
    for (const [file, source] of Object.entries(content)) {
        const nextFile = remap(file);
        let nextSource = source;
        if (updateImports && /\.[cm]?[jt]sx?$/i.test(file) && isEditableWorkspacePath(file)) {
            let ast;
            try {ast = parse(source, {sourceType: 'unambiguous', allowUndeclaredExports: true, plugins: ['typescript', 'jsx', 'decorators-legacy']});}
            catch {throw new Error(`Fix syntax errors in ${file} before updating imports, or turn off Update imports.`);}
            const edits = [];
            for (const literal of importStrings(ast)) {
                const target = resolveGeneratedImport(file, literal.value, oldPaths);
                if (!target) continue;
                const nextTarget = remap(target);
                if (resolveGeneratedImport(nextFile, literal.value, newPaths) === nextTarget) continue;
                let specifier = literal.value.startsWith('/') ? nextTarget : path.posix.relative(path.posix.dirname(nextFile), nextTarget);
                if (!specifier.startsWith('.') && !specifier.startsWith('/')) specifier = `./${specifier}`;
                const candidates = [];
                if (!path.posix.extname(literal.value)) {
                    if (/\/index\.[cm]?[jt]sx?$/.test(specifier)) candidates.push(specifier.replace(/\/index\.[cm]?[jt]sx?$/, ''));
                    candidates.push(specifier.replace(/\.[cm]?[jt]sx?$/, ''));
                }
                if (/\.[cm]?js$/.test(literal.value)) candidates.push(specifier.replace(/\.[cm]?tsx?$/, path.posix.extname(literal.value)));
                candidates.push(specifier);
                specifier = candidates.find(candidate => resolveGeneratedImport(nextFile, candidate, newPaths) === nextTarget) || specifier;
                const quote = source[literal.start];
                const replacement = specifier.replace(/\\/g, '\\\\').replace(new RegExp(quote, 'g'), `\\${quote}`);
                edits.push({start: literal.start + 1, end: literal.end - 1, text: replacement});
            }
            for (const edit of edits.sort((a, b) => b.start - a.start)) nextSource = nextSource.slice(0, edit.start) + edit.text + nextSource.slice(edit.end);
        }
        result[nextFile] = nextSource;
    }
    if (content['/package.json']) {
        const manifest = JSON.parse(content['/package.json']);
        const source = pluginBuildSource(content);
        let changed = false;
        for (const key of ['source', 'main', 'module', 'types', 'typings']) {
            if (typeof manifest[key] !== 'string') continue;
            const original = normalizeVirtualWorkspacePath(manifest[key]), next = remap(original);
            if (next !== original) {manifest[key] = (manifest[key].startsWith('./') ? './' : '') + next.slice(manifest[key].startsWith('/') ? 0 : 1);changed = true;}
        }
        if (source && remap(`/${source}`) !== `/${source}` && !manifest.source) {manifest.source = remap(`/${source}`).slice(1);changed = true;}
        if (changed) result['/package.json'] = JSON.stringify(manifest, null, 2) + '\n';
    }
    return {content: result, remap};
}
