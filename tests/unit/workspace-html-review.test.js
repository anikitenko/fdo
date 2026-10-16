/** @jest-environment node */
import {findWorkspaceHtmlIssues, PLUGIN_HTML_MIGRATION_GUIDANCE} from '../../src/utils/plugins/validation/workspaceHtmlReview';
import {includeWorkspaceAuthoringFindings, workspaceReviewContext, parseWorkspaceReviewReport} from '../../src/components/editor/utils/aiCodingAgentReview';

const source = (path,content)=>({path,content});

test('finds nested/dynamic raw fragments across production files, including markup inside SDK wrappers',()=>{
    const files = [source('/render.ts', 'export function render(value) {return `<main class="panel"><h1>${value}</h1>${items.map(item => `<p>${item}</p>`).join("")}</main>`;}'),
        source('/features/panel.ts', `export const panel = dom.renderHTML(dom.createElement('section', {}, '<button id="run" data-action="run">Run</button>'));`),
        source('/footer.ts', `export const closing = '</section>';`),
        source('/broken.ts','export const = <')];
    const findings = findWorkspaceHtmlIssues(files);
    expect(findings.map(finding=>finding.file)).toEqual(['/render.ts','/features/panel.ts','/footer.ts']);
    expect(findings[0].evidence).toContain('2 raw HTML fragment(s)');
    expect(findings[0].evidence).toContain('h1, main, p');
    expect(findings[1].evidence).toContain('button');
    expect(findings[0].repair).toContain('handler bindings');
    expect(findings[0].repair).toContain('escaping');
});

test('ignores comments, comparisons, generics, escaped text, JSON samples and non-production sources',()=>{
    const files = [source('/logic.ts', `// return '<div>comment</div>';
        const generic = '<T>'; const compare = 'a < b'; const escaped = '&lt;p&gt;Text&lt;/p&gt;';
        type Choice = '<button>type only</button>';
        const sample = '{"html":"<div>user data</div>"}';
        const comment = '<!-- <button>comment</button> -->';`),
        source('/local-result.ts', 'target.textContent = "<b>Plain result data</b>"; target["textContent"] = `<p>${value}</p>`;'),
        ...['/render.test.ts','/tests/render.ts','/__tests__/view.js','/fixtures/markup.ts','/docs/example.ts','/sdk.d.ts'].map(path=>source(path,`export const html = '<p>Fixture</p>';`))];
    expect(findWorkspaceHtmlIssues(files)).toEqual([]);
});

test('helper-based production composition is clean while raw nested children remain migration candidates',()=>{
    const files = [source('/render.ts', `import {DOM,DOMText} from '@anikitenko/fdo-sdk';
        export function render() {const dom = new DOM(), text = new DOMText(); dom.collectStylesFrom(text);
        return dom.renderHTML(dom.createElement('section', {id:'panel','aria-label':'Status'},text.createPText('Ready')));}`)];
    expect(findWorkspaceHtmlIssues(files)).toEqual([]);
    const raw = files.map(file=>({...file,content:file.content.replace("text.createPText('Ready')","'<p>Ready</p>'")}));
    expect(findWorkspaceHtmlIssues(raw)).toHaveLength(1);
    expect(PLUGIN_HTML_MIGRATION_GUIDANCE).toContain('not browser Nodes');
    expect(PLUGIN_HTML_MIGRATION_GUIDANCE).toContain('installed declarations');
    expect(PLUGIN_HTML_MIGRATION_GUIDANCE).toContain('wrap an unchanged raw HTML subtree');
});

test('recognizes document wrappers and incomplete concatenation fragments without treating generics as HTML',()=>{
    const files = [source('/shell.ts', /* language=TEXT */ `export const shell = '<!doctype html><html><body>Ready</body></html>';`),
        source('/parts.ts', `export const open = '<div class="'; export const close = '</DIV></main>';`),
        source('/generic.ts', `export const description = '<T>';`)];
    const findings = findWorkspaceHtmlIssues(files);
    expect(findings.map(finding=>finding.file)).toEqual(['/shell.ts','/parts.ts']);
    expect(findings[0].evidence).toContain('html');
    expect(findings[1].evidence).toContain('2 raw HTML fragment(s)');
});

test('host findings survive an empty model report, are idempotent and disappear after migration',()=>{
    const files = [source('/view.ts',`export const render = () => '<p>Ready</p>';`)];
    const report = {status:'completed',summary:'Tests passed.',findings:[],limitations:[]};
    includeWorkspaceAuthoringFindings(report,files);
    includeWorkspaceAuthoringFindings(report,files);
    expect(report.findings).toHaveLength(1);
    expect(parseWorkspaceReviewReport(JSON.stringify(report),files)).toEqual(report);
    expect(workspaceReviewContext(files)).toContain('SDK HELPER MIGRATION CONTRACT');
    expect(workspaceReviewContext(files)).toContain('Handwritten HTML');
    const clean = includeWorkspaceAuthoringFindings({status:'completed',summary:'Migrated',findings:[],limitations:[]},[source('/view.ts',`export const render = () => dom.createElement('p',{},'Ready');`)]);
    expect(clean.findings).toEqual([]);
});
