import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {loadTypeScriptRuntime} from './typeScriptRuntime';
export function installedSdkCapabilities(requireSdk, sdk, {methodSignatures = new Map()} = {}) {
    const entry = requireSdk.resolve('@anikitenko/fdo-sdk');
    const root = path.dirname(path.dirname(entry));
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const ts = requireSdk('typescript/unstable/ast');
    const {API, SymbolFlags, nativeBinary} = loadTypeScriptRuntime(requireSdk);
    const classes = new Map();
    const signatures = methodSignatures;
    const hash = createHash('sha256');
    hash.update(fs.readFileSync(entry));
    hash.update(JSON.stringify(manifest));
    for (const file of ['dom-authoring-contract.json', 'dom-authoring-contract.schema.json', 'ui-components.json', 'ui-components.schema.json', 'ui-previews.json', 'ui-previews.schema.json']) {
        const artifact = path.join(root, 'dist', file);
        if (fs.existsSync(artifact)) {hash.update(file); hash.update(fs.readFileSync(artifact));}
    }
    const declarations = path.join(root, 'dist', '@types');
    const declarationFiles = [];
    const collect = dir => {
        for (const name of fs.readdirSync(dir).sort()) {
            const target = path.join(dir, name);
            if (fs.statSync(target).isDirectory()) collect(target);
            else if (name.endsWith('.d.ts')) declarationFiles.push(target);
        }
    };
    collect(declarations);
    const configPath = path.join(root, '__fdo_capabilities_tsconfig.json');
    const config = JSON.stringify({files: declarationFiles, compilerOptions: {noLib: true, types: [], skipLibCheck: true}});
    const compilerApi = new API({cwd: root, tsserverPath: nativeBinary, fs: {
        readFile: name => {if (path.resolve(name) === configPath) return config; try {return fs.readFileSync(name, 'utf8');} catch {return null;}},
        fileExists: name => path.resolve(name) === configPath || fs.existsSync(name),
    }});
    let snapshot;
    try {
        snapshot = compilerApi.updateSnapshot({openProjects: [configPath]});
        const project = snapshot.getProject(configPath);
        if (!project) throw new Error('TypeScript did not create an SDK inventory project');
        const program = project.program;

        const visit = dir => {
            for (const name of fs.readdirSync(dir).sort()) {
                const target = path.join(dir, name);
                if (fs.statSync(target).isDirectory()) visit(target);
                else if (name.endsWith('.d.ts')) {
                    const text = fs.readFileSync(target, 'utf8');
                    hash.update(path.relative(root, target)); hash.update(text);
                    const ast = program.getSourceFile(target);
                    ast.forEachChild(node => {
                        if (!ts.isClassDeclaration(node) || !node.name) return;
                        signatures.set(node.name.text, node.members.filter(member => ts.isMethodDeclaration(member)
                            && !(member.modifiers || []).some(modifier => [ts.SyntaxKind.PrivateKeyword, ts.SyntaxKind.ProtectedKeyword].includes(modifier.kind)))
                            .map(member => member.getText(ast).replace(/\s+/g, ' ')));
                        const properties = node.members.filter(member => (ts.isPropertyDeclaration(member) || ts.isGetAccessorDeclaration(member))
                            && member.name && ts.isIdentifier(member.name)
                            && !(member.modifiers || []).some(modifier => [ts.SyntaxKind.PrivateKeyword, ts.SyntaxKind.ProtectedKeyword].includes(modifier.kind)))
                            .map(member => {
                                /** @type {import('typescript/unstable/ast').Node | undefined} */
                                const propertyType = member.type;
                                return {name: member.name.text, type: propertyType?.getText(ast) || 'unknown',
                                    static: (member.modifiers || []).some(modifier => modifier.kind === ts.SyntaxKind.StaticKeyword)};
                            });
                        classes.set(node.name.text, {properties, methods: node.members.filter(member => ts.isMethodDeclaration(member) && member.name && ts.isIdentifier(member.name) && !(member.modifiers || []).some(modifier => [ts.SyntaxKind.PrivateKeyword, ts.SyntaxKind.ProtectedKeyword].includes(modifier.kind))).map(member => member.name.text),
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
        const declaredProperties = (name, seen = new Set()) => {
            if (seen.has(name)) return [];
            seen.add(name);
            const entry = classes.get(name);
            return entry ? [...entry.properties, ...entry.bases.flatMap(base => declaredProperties(base, seen))] : [];
        };
        const api = Object.getOwnPropertyNames(sdk).sort().map(name => {
            const value = Object.getOwnPropertyDescriptor(sdk, name)?.value;
            const prototype = typeof value === 'function' ? Object.getOwnPropertyDescriptor(value, 'prototype')?.value : null;
            const methods = prototype ? Object.getOwnPropertyNames(prototype).filter(key => key !== 'constructor'
                && typeof Object.getOwnPropertyDescriptor(prototype, key)?.value === 'function').sort() : [];
            // Describe services from declarations without invoking runtime getters.
            const properties = [...new Map(declaredProperties(name).reverse().map(item => [`${item.static}:${item.name}`, item])).values()]
                .sort((a, b) => a.name.localeCompare(b.name));
            return {name, methods: [...new Set(classes.has(name) ? declaredMethods(name) : methods)].sort(), properties};
        });
        const typesEntry = path.join(root, manifest.types || 'dist/@types/index.d.ts');
        const checker = project.checker;
        const moduleSymbol = checker.getSymbolAtLocation(program.getSourceFile(typesEntry));
        const typeExports = moduleSymbol ? checker.getExportsOfModule(moduleSymbol).filter(symbol => {
            const target = symbol.flags & SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
            return (target.flags & SymbolFlags.Type) && !(target.flags & SymbolFlags.Value);
        }).map(symbol => symbol.name).sort() : [];
        return {typeExports, schemaVersion: 1, sdkVersion: manifest.version, fingerprint: hash.digest('hex'), api,
            workspace: {paths: 'virtual absolute paths only', writes: 'approved plan or diagnostic repair scope'},
            permissions: 'Determined by the host runtime; this inventory grants none.'};
    } finally {snapshot?.dispose(); compilerApi.close();}
}
export const readSkillFingerprint = content => /<!-- fdo-sdk-fingerprint: ([a-f0-9]{64}) -->/.exec(content || '')?.[1] || null;
export const stampSkillFingerprint = (content, fingerprint) => content.replace(/<!-- fdo-sdk-fingerprint: [^\n]*? -->\s*/g, '').trimEnd()
    + `\n\n<!-- fdo-sdk-fingerprint: ${fingerprint} -->\n`;
