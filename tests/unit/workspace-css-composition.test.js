import {missingWorkspaceCssImports, relativeWorkspaceImport, resolvePlannedWorkspaceCssImports, resolveWorkspaceCssComposition, workspaceCssCompositionImports, workspaceCssReachability} from '../../src/utils/plugins/validation/workspaceCssComposition';
import {validateGeneratedWorkspaceImports} from '../../src/utils/plugins/validation/generatedWorkspaceImports';

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

test('corrects the initial workbench plan folder mismatch without changing cascade or conditions', () => {
    const path = '/styles.css';
    const names = ['dashboard', 'workspace', 'library', 'space', 'category'];
    const plannedPaths = [path, '/styles/base.css', ...names.map(name => `/features/workbench/styles/${name}.css`)];
    const content = '@import "./styles/base.css";\n'
        + names.map(name => `@import url('./styles/workbench/${name}.css') layer(features) screen;`).join('\n')
        + '\n/* local styles */\n.shell { color: red; }';
    const resolved = resolvePlannedWorkspaceCssImports({path, content, plannedPaths, paths: plannedPaths});
    expect(resolved).toBe(content.replaceAll('./styles/workbench/', './features/workbench/styles/'));
    expect(validateGeneratedWorkspaceImports([{path, content: resolved}], {paths: plannedPaths})).toEqual([]);
    expect(resolvePlannedWorkspaceCssImports({path, content: resolved, plannedPaths, paths: plannedPaths})).toBe(resolved);
});

test.each([
    {name: 'ambiguous planned filenames', plannedPaths: ['/a/dashboard.css', '/b/dashboard.css']},
    {name: 'collision with unchanged files', plannedPaths: ['/a/dashboard.css'], existing: ['/other/dashboard.css']},
    {name: 'unplanned target', plannedPaths: [], existing: ['/a/dashboard.css']},
    {name: 'self import', plannedPaths: ['/styles/dashboard.css'], path: '/styles/dashboard.css'},
    {name: 'unknown target', plannedPaths: ['/a/library.css']},
    {name: 'existing resolving import', plannedPaths: ['/a/dashboard.css'], existing: ['/wrong/dashboard.css']},
    {name: 'absolute import', plannedPaths: ['/a/dashboard.css'], content: '@import "/wrong/dashboard.css";'},
    {name: 'remote import', plannedPaths: ['/a/dashboard.css'], content: '@import "https://example.com/dashboard.css";'},
    {name: 'query string', plannedPaths: ['/a/dashboard.css'], content: '@import "./wrong/dashboard.css?v=1";'},
    {name: 'invalid source', plannedPaths: ['/a/dashboard.css'], content: '@import "./wrong/dashboard.css"; .broken {'},
])('keeps $name unchanged for normal validation', ({plannedPaths, existing = [], path = '/styles.css', content = '@import "./wrong/dashboard.css";'}) => {
    expect(resolvePlannedWorkspaceCssImports({path, content, plannedPaths, paths: [path, ...plannedPaths, ...existing]})).toBe(content);
});


test('missing CSS references are diagnostic only and exclude resolving, remote and commented imports', () => {
    const content = `/* @import "./comment.css"; */
@import "./known.css";
@import url("./new.css") screen;
@import './new.css';
@import "https://example.test/remote.css";
@import "./asset.png";
@import "./self.css";
.panel { content: '@import "./string.css";'; }`;
    expect(missingWorkspaceCssImports({path: '/self.css', content, paths: ['/self.css', '/known.css']}))
        .toEqual(['./new.css']);
    expect(missingWorkspaceCssImports({path: '/self.css', content: '@import "./new.css"; .broken {', paths: []})).toEqual([]);
    expect(missingWorkspaceCssImports({path: '/self.ts', content, paths: []})).toEqual([]);
});


test('CSS ancestry combines known imports and planned compositions without looping', () => {
    const paths = ['/root.css', '/dashboard.css', '/shared.css', '/tokens.css', '/safe.css'];
    const reaches = workspaceCssReachability({paths, files: [
        {path: '/root.css', content: '@import url("./dashboard.css") layer(ui);'},
        {path: '/tokens.css', content: '@import "./shared.css";'},
    ], compositions: new Map([
        ['/dashboard.css', [{path: '/shared.css'}]],
        ['/shared.css', [{path: '/tokens.css'}]],
    ])});
    expect(reaches('/root.css', '/shared.css')).toBe(true);
    expect(reaches('/dashboard.css', '/tokens.css')).toBe(true);
    expect(reaches('/shared.css', '/safe.css')).toBe(false);
    expect(reaches('/safe.css', '/shared.css')).toBe(false);
});
