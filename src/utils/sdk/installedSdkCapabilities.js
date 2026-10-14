import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
export function installedSdkCapabilities(requireSdk, sdk, {methodSignatures = new Map()} = {}) {
    const entry = requireSdk.resolve('@anikitenko/fdo-sdk');
    const root = path.dirname(path.dirname(entry));
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const ts = requireSdk('typescript');
    const classes = new Map();
    const signatures = methodSignatures;
    const hash = createHash('sha256');
    hash.update(fs.readFileSync(entry));
    const declarations = path.join(root, 'dist', '@types');
    const visit = dir => {
        for (const name of fs.readdirSync(dir).sort()) {
            const target = path.join(dir, name);
            if (fs.statSync(target).isDirectory()) visit(target);
            else if (name.endsWith('.d.ts')) {
                const text = fs.readFileSync(target, 'utf8');
                hash.update(path.relative(root, target)); hash.update(text);
                const ast = ts.createSourceFile(target, text, ts.ScriptTarget.Latest, true);
                ast.forEachChild(node => {
                    if (!ts.isClassDeclaration(node) || !node.name) return;
                    signatures.set(node.name.text, node.members.filter(member => ts.isMethodDeclaration(member)
                        && !(member.modifiers || []).some(modifier => [ts.SyntaxKind.PrivateKeyword, ts.SyntaxKind.ProtectedKeyword].includes(modifier.kind)))
                        .map(member => member.getText(ast).replace(/\s+/g, ' ')));
                    classes.set(node.name.text, {methods: node.members.filter(member => ts.isMethodDeclaration(member) && member.name && ts.isIdentifier(member.name) && !(member.modifiers || []).some(modifier => [ts.SyntaxKind.PrivateKeyword, ts.SyntaxKind.ProtectedKeyword].includes(modifier.kind))).map(member => member.name.text),
                        bases: (node.heritageClauses || []).flatMap(clause => clause.types.map(type => type.expression.getText(ast)))});
                });
            }
        }
    };
    visit(declarations);
    const declaredMethods = (name, seen = new Set()) => {
        if (seen.has(name)) return [];
        seen.add(name);
        const entry = classes.get(name);
        return entry ? [...entry.methods, ...entry.bases.flatMap(base => declaredMethods(base, seen))] : [];
    };
    const api = Object.getOwnPropertyNames(sdk).sort().map(name => {
        const value = Object.getOwnPropertyDescriptor(sdk, name)?.value;
        const prototype = typeof value === 'function' ? Object.getOwnPropertyDescriptor(value, 'prototype')?.value : null;
        const methods = prototype ? Object.getOwnPropertyNames(prototype).filter(key => key !== 'constructor'
            && typeof Object.getOwnPropertyDescriptor(prototype, key)?.value === 'function').sort() : [];
        return {name, methods: [...new Set(classes.has(name) ? declaredMethods(name) : methods)].sort()};
    });
    const typesEntry = path.join(root, manifest.types || 'dist/@types/index.d.ts');
    const program = ts.createProgram([typesEntry], {noLib: true, types: [], skipLibCheck: true});
    const checker = program.getTypeChecker();
    const moduleSymbol = program.getSourceFile(typesEntry)?.symbol;
    const typeExports = moduleSymbol ? checker.getExportsOfModule(moduleSymbol).filter(symbol => {
        const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
        return (target.flags & ts.SymbolFlags.Type) && !(target.flags & ts.SymbolFlags.Value);
    }).map(symbol => symbol.name).sort() : [];
    return {typeExports, schemaVersion: 1, sdkVersion: manifest.version, fingerprint: hash.digest('hex'), api,
        workspace: {paths: 'virtual absolute paths only', writes: 'approved plan or diagnostic repair scope'},
        permissions: 'Determined by the host runtime; this inventory grants none.'};
}
export const readSkillFingerprint = content => /<!-- fdo-sdk-fingerprint: ([a-f0-9]{64}) -->/.exec(content || '')?.[1] || null;
export const stampSkillFingerprint = (content, fingerprint) => content.replace(/<!-- fdo-sdk-fingerprint: [^\n]*? -->\s*/g, '').trimEnd()
    + `\n\n<!-- fdo-sdk-fingerprint: ${fingerprint} -->\n`;
