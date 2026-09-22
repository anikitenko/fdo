import {relativeWorkspaceImport, resolveWorkspaceCssComposition, workspaceCssCompositionImports} from '../../src/utils/workspaceCssComposition';
import {validateGeneratedWorkspaceImports} from '../../src/utils/generatedWorkspaceImports';

const path = '/styles/features.css';
const helpers = ['workspace', 'library', 'personal-space'].map(name => ({path: `/styles/features/${name}.css`}));
const paths = [path, ...helpers.map(helper => helper.path)];

test('resolves the recorded split CSS folder mistake without altering local rules or cascade order', () => {
    const imports = helpers.map(helper => `@import "./${helper.path.split('/').at(-1)}";`).join('\n');
    const rules = '\n\n.result[data-state="success"] { color: green; }\n@media (prefers-reduced-motion: reduce) { .workspace { animation: none; } }\n';
    const content = imports + rules;
    expect(validateGeneratedWorkspaceImports([{path, content}], {paths})).toHaveLength(3);
    const resolved = resolveWorkspaceCssComposition({path, content, helpers, paths});
    expect(resolved).toBe(workspaceCssCompositionImports(path, helpers) + rules);
    expect(validateGeneratedWorkspaceImports([{path, content: resolved}], {paths})).toEqual([]);
    expect(resolveWorkspaceCssComposition({path, content: resolved, helpers, paths})).toBe(resolved);
});

test('preserves quotes, url syntax, import conditions, comments and whitespace', () => {
    const content = '/* first */\n@import url(  \'./library.css\' ) layer(theme) supports(display: grid) screen;\n@import "./workspace.css" print;\n';
    expect(resolveWorkspaceCssComposition({path, content, helpers, paths})).toBe(
        content.replace('./library.css', './features/library.css').replace('./workspace.css', './features/workspace.css'));
});

test.each([
    {content: '@import "./missing.css";'},
    {content: '@import "./library.css";', paths: [...paths, '/styles/library.css']},
    {content: '@import "./library.css";', helpers: [...helpers, {path: '/other/library.css'}], paths: [...paths, '/other/library.css']},
    {content: '@import "./library.css";', helpers: []},
    {content: '@import "./library.css";', paths: [path]},
    {content: '@import "./library.css"; .broken {'},
    {content: '@import "https://example.com/library.css";'},
    {content: '@import "./library.css?theme=dark";'},
])('leaves unknown, ambiguous, resolving or invalid references for validation: %j', options => {
    expect(resolveWorkspaceCssComposition({path, helpers, paths, ...options})).toBe(options.content);
});

test.each([
    ['/styles/features.css', '/styles/features/library.css', './features/library.css'],
    ['/styles/features/library.css', '/styles/base.css', '../base.css'],
    ['/styles.css', '/styles/base.css', './styles/base.css'],
    ['/styles/features/library.css', '/styles/features/controls.css', './controls.css'],
])('computes exact relative references from %s to %s', (from, to, expected) => {
    expect(relativeWorkspaceImport(from, to)).toBe(expected);
});
