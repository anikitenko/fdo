import {parse} from '@babel/parser';
import traverseModule from '@babel/traverse';
import {parseFragment} from 'parse5';
import htmlTags from 'html-tags';

const standardTags = new Set(htmlTags);

const isTextContentData = path => {
    const parent = path.findParent(item => item.isAssignmentExpression() || item.isFunction());
    if (!parent?.isAssignmentExpression() || path.node.start < parent.node.right.start || path.node.end > parent.node.right.end) return false;
    const left = parent.node.left;
    return left.type === 'MemberExpression' && (left.computed ? left.property.value : left.property.name) === 'textContent';
};

export const PLUGIN_HTML_MIGRATION_GUIDANCE = `SDK HELPER MIGRATION CONTRACT
Inspect all production UI markup, including nested fragments, loops, conditional branches, HTML strings passed to renderHTML/createElement, and frontend HTML updates. Replace handwritten HTML with public @anikitenko/fdo-sdk helpers using the installed declarations and dom-metadata/authoring contract supplied in SDK evidence. SDK helpers return HTML strings, not browser Nodes. Prefer the matching documented helper; use dom.createElement(...) on a DOM instance for tags without a dedicated helper. Do not invent helper names or signatures, use React/JSX, or wrap an unchanged raw HTML subtree in renderHTML and call it migrated.
Preserve visible text, DOM hierarchy, IDs, classes (including Pure CSS), data/ARIA attributes, form values, labels, escaping of untrusted input, event targets, frontend setup/disposal, and backend handlers. Do not remove safe escaping or treat user-entered JSON/HTML examples as UI markup. Keep existing render/export interfaces and meaningful test assertions. Share the style collector with helpers before style registration, retain complete stylesheet entries, and finish the deployed render path with dom.renderHTML so this migration does not lose styles.
Review reports identify affected files and source evidence without modifying them. Repair rewrites all confirmed raw UI markup in the approved production files, with focused imports/helpers in those files. Test fixtures, snapshots, documentation, and user data stay intact. If a fragment cannot be migrated while preserving its behavior with the installed SDK, report the concrete blocker and remaining location; do not erase it or claim completion. Verify the deployed markup, emitted styles and interactions after migration; passing old tests alone does not prove migration is complete.`;

// Inspect source only. Parse HTML fragments rather than matching markup in
// comments, escaped text, comparison expressions or TypeScript generics.
function markupTags(value) {
    if (!value.includes('<')) return [];
    // Seed JSON/config samples are data, even when their string values contain
    // markup. Migrating those would change the user's input rather than UI.
    if (/^\s*[\[{]/.test(value)) {
        try { JSON.parse(value); return []; } catch { /* An HTML fragment may start with text. */ }
    }
    const root = parseFragment(value), tags = new Set(), queue = [root];
    for (let index = 0; index < queue.length; index++) {
        const node = queue[index];
        if (node.tagName && (standardTags.has(node.tagName) || node.tagName.includes('-')
            || node.namespaceURI !== 'http://www.w3.org/1999/xhtml')) tags.add(node.tagName);
        queue.push(...(node.childNodes || []));
        if (node.content) queue.push(node.content); // <template> fragments
    }
    // Fragment parsing drops document wrappers and incomplete start/end tags.
    // These also occur in legacy concatenation-based renderers.
    const boundary = value.trim().replace(/^<!doctype[^>]*>\s*/i, '').match(/^<\/?([a-z][\w:-]*)(?=[\s/>]|$)/i);
    if (boundary && (standardTags.has(boundary[1].toLowerCase()) || boundary[1].includes('-'))) tags.add(boundary[1].toLowerCase());
    return [...tags];
}

export function findWorkspaceHtmlIssues(files = []) {
    const findings = [];
    for (const file of files) {
        if (!/\.[cm]?[jt]sx?$/.test(file.path) || /\.d\.[cm]?ts$/.test(file.path)
            || /(?:^|\/)(?:tests?|__tests__|__snapshots__|fixtures?|docs?|node_modules)(?:\/|$)/i.test(file.path)
            || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file.path)) continue;
        try {
            const ast = parse(file.content, {sourceType: 'module', plugins: ['typescript', 'jsx']});
            const locations = [], tags = new Set();
            const record = (node, value) => {
                const found = markupTags(value);
                if (!found.length) return;
                found.forEach(tag => tags.add(tag));
                locations.push(`${node.loc.start.line}:${node.loc.start.column + 1}`);
            };
            const traverse = traverseModule.default || traverseModule;
            traverse(ast, {
                StringLiteral(path) {
                    if (!path.parentPath.isTSLiteralType() && !isTextContentData(path)) record(path.node, path.node.value);
                },
                TemplateLiteral(path) {
                    if (path.parentPath.isTSLiteralType() || path.parentPath.isTSTemplateLiteralType?.() || isTextContentData(path)) return;
                    // A hole is not a literal tag name. A word/hyphen sentinel
                    // invents custom elements such as <afdo-expression>.
                    record(path.node, path.node.quasis.map(part => part.value.cooked ?? part.value.raw).join(' '));
                },
            });
            if (!locations.length) continue;
            findings.push({severity: 'warning', file: file.path,
                issue: 'Handwritten HTML markup needs migration to SDK helpers.',
                evidence: `${locations.length} raw HTML fragment(s) at ${file.path}:${locations.slice(0, 12).join(', ')}${locations.length > 12 ? ' (additional fragments in this file)' : ''}; tags: ${[...tags].sort().join(', ')}. Source evidence, not runtime verification.`,
                repair: 'Replace all confirmed UI HTML strings in this file, including nested and dynamic branches, with documented installed SDK helpers (or dom.createElement for tags without a dedicated helper). Preserve markup semantics, text, IDs, data/ARIA attributes, classes, escaping, styles and handler bindings. Do not replace test fixtures or user data. Keep the deployed render interface and style collector; verify rendered output and interactions. Report any fragment that cannot be safely migrated.',
            });
        } catch { /* Syntax/build diagnostics own unparseable modules. */ }
    }
    return findings;
}
