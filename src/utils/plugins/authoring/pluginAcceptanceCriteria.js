import {parse} from '@babel/parser';
import traverseModule from '@babel/traverse';
const traverse = traverseModule.default || traverseModule;
export function readPluginAcceptanceCriteria(content = '') {
    const blocks = [...content.matchAll(/<!-- fdo-acceptance -->\s*~~~json\s*\n([\s\S]*?)\n~~~/gm)];
    if (blocks.length > 1) throw new Error('Use exactly one fdo-acceptance block.');
    const block = blocks[0];
    if (!block) {
        if (content.includes('<!-- fdo-acceptance -->')) throw new Error('Malformed fdo-acceptance block. Use a complete tilde-fenced JSON array.');
        return [];
    }
    const criteria = JSON.parse(block[1]);
    if (!Array.isArray(criteria) || !criteria.length || criteria.length > 24) throw new Error('Acceptance criteria must contain 1–24 entries.');
    const ids = new Set();
    const errors = [];
    for (const [index, item] of criteria.entries()) {
        const label = `Acceptance criterion ${index + 1}`;
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
            errors.push(`${label}: expected an object with id, description, testFile and testName.`);
            continue;
        }
        for (const key of ['id', 'description', 'testFile', 'testName']) {
            if (typeof item[key] !== 'string' || !item[key].trim()) errors.push(`${label}: ${key} must be a non-empty string.`);
        }
        if (typeof item.id === 'string' && ids.has(item.id)) errors.push(`${label}: duplicate id ${JSON.stringify(item.id)}; use a unique id.`);
        if (typeof item.testFile === 'string' && !/^\/(?!.*\.\.)[^\\]+\.(?:test|spec)\.[cm]?[jt]sx?$/.test(item.testFile)) {
            errors.push(`${label}: testFile ${JSON.stringify(item.testFile)} must be an absolute virtual test path such as /tests/behavior.test.ts, without traversal or backslashes. Select the test file that will contain the executable test, not the production file being tested.`);
        }
        ids.add(item.id);
    }
    if (errors.length) throw new Error(errors.join('\n'));
    return criteria;
}
export function validatePluginAcceptanceCriteria(files, {testFile} = {}) {
    const guide = files.find(file => file.path === '/SKILL.md');
    let criteria;
    try { criteria = readPluginAcceptanceCriteria(guide?.content); }
    catch (error) { return [`/SKILL.md: ${error.message}`]; }
    if (!criteria.length && guide?.content.includes('fdo-sdk-fingerprint:')) return ['/SKILL.md: The approved guide has no acceptance criteria. Restore or explicitly review its criteria.'];
    return criteria.filter(item => !testFile || item.testFile === testFile).flatMap(item => {
        const source = files.find(file => file.path === item.testFile);
        if (!source) return [`/SKILL.md: Acceptance ${item.id} requires missing test file ${item.testFile}.`];
        let found = false;
        let matchingSuite = '';
        const otherTestNames = new Set();
        try {
            const ast = parse(source.content, {sourceType: 'module', plugins: ['typescript', 'jsx']});
            traverse(ast, {CallExpression(p) {
                const callee = p.get('callee');
                if (!callee.isIdentifier()) return;
                const binding = p.scope.getBinding(callee.node.name)?.path;
                if (!binding?.isImportSpecifier() || binding.parent.source.value !== 'node:test') return;
                const imported = binding.node.imported.name;
                const name = p.node.arguments[0];
                if (imported === 'describe' && name?.type === 'StringLiteral' && name.value === item.testName) {
                    matchingSuite = ` Found ${callee.node.name}(${JSON.stringify(item.testName)}, ...) at line ${p.node.loc.start.line}; this is a describe suite, not an executable test. Keep the suite if useful, but add a top-level test or it with the exact approved name and assertions exercising the required behavior. Do not merely rename describe to test while leaving nested it calls unchanged.`;
                }
                if (!['test', 'it'].includes(imported)) return;
                if (name?.type === 'StringLiteral' && otherTestNames.size < 24) otherTestNames.add(name.value);
                if (p.getFunctionParent()) return;
                if (p.node.arguments[0]?.type !== 'StringLiteral' || p.node.arguments[0].value !== item.testName) return;
                // Require a direct executable test, not .skip/.todo or options
                // that can silently disable the acceptance test.
                if (p.node.arguments.length !== 2 || !['ArrowFunctionExpression', 'FunctionExpression'].includes(p.node.arguments[1].type)) return;
                found = true;
            }});
        } catch {
            // An unparseable file cannot establish that test declarations are
            // absent. Syntax validation owns the failure; recheck identities
            // after repair instead of emitting one false absence per criterion.
            return [];
        }
        return found ? [] : [`${item.testFile}: Acceptance ${item.id} requires a direct node:test test named ${JSON.stringify(item.testName)} with an executable callback and no skip/todo options.${matchingSuite} Required behavior: ${item.description}.${otherTestNames.size ? ` Observed test names (up to 24): ${JSON.stringify([...otherTestNames])}.` : ''}`];
    });
}
