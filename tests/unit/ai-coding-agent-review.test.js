import {
    isWorkspaceQualityReviewPrompt,
    WORKSPACE_REPAIR_PROMPT,
    WORKSPACE_REVIEW_PROMPT,
    parseWorkspaceReviewReport,
    formatWorkspaceReviewReport,
    WORKSPACE_REVIEW_REPORT_CONTRACT,
    workspaceStyleReviewContext,
    includeWorkspaceStyleFindings,
} from "../../src/components/editor/utils/aiCodingAgentReview";

describe("AI Coding Agent workspace review prompts", () => {
    const styleFiles = [
        {path: '/index.ts', content: 'import {render} from "./view"; export const renderPlugin = render;'},
        {path: '/view.ts', content: 'import css from "./styles.css"; export const render = () => `<div class="panel">Content</div>`;'},
        {path: '/styles.css', content: '.panel {display:grid}'},
    ];
    test('review includes style repair evidence and retains host findings if the model overlooks them', () => {
        expect(workspaceStyleReviewContext(styleFiles)).toContain('Share one DOM across child renderers');
        const cleanReport = {status: 'completed', summary: 'Tests passed.', findings: [], limitations: []};
        const report = includeWorkspaceStyleFindings(cleanReport, styleFiles);
        expect(report.findings.map(finding => finding.file)).toEqual(['/index.ts', '/view.ts']);
        expect(report.findings[0].repair).toContain('preserving state');
        expect(parseWorkspaceReviewReport(JSON.stringify(report), styleFiles)).toEqual(report);
        includeWorkspaceStyleFindings(report, styleFiles);
        expect(report.findings).toHaveLength(2);
    });
    test('review detects when a repair registers styles on the deployed path', () => {
        const repaired = styleFiles.map(file => file.path === '/view.ts' ? {...file,
            content: 'import css from "./styles.css"; import {DOM} from "@anikitenko/fdo-sdk"; export function render() {const dom = new DOM(); const panel = dom.createClassFromStyle(css.panel); return dom.renderHTML(`<div class="${panel}">Content</div>`); }'} : file);
        const report = includeWorkspaceStyleFindings({status: 'completed', summary: 'Reviewed.', findings: [], limitations: []}, repaired);
        expect(report.findings).toEqual([]);
        expect(workspaceStyleReviewContext(repaired)).toContain('[]');
    });
    test("keeps review first and repair workflows distinct", () => {
        expect(isWorkspaceQualityReviewPrompt(WORKSPACE_REVIEW_PROMPT)).toBe(true);
        expect(WORKSPACE_REVIEW_PROMPT).toContain("Do not modify files");
        expect(WORKSPACE_REPAIR_PROMPT).toContain("Automatically repair");
        expect(WORKSPACE_REPAIR_PROMPT).toContain("Re-run plugin tests");
    });

    test('renders a blocked review as unverified, with blockers and unchanged files', () => {
        const report = parseWorkspaceReviewReport(JSON.stringify({status: 'blocked', summary: 'Current sources could not be assessed.',
            findings: [], limitations: ['Build output was unavailable.']}), []);
        const rendered = formatWorkspaceReviewReport(report);
        expect(rendered).toContain('Workspace review could not complete');
        expect(rendered).toContain('does not establish that the workspace is clean');
        expect(rendered).toContain('Build output was unavailable.');
        expect(rendered).toContain('Workspace files were unchanged.');
        expect(rendered).not.toContain('### File:');
    });

    test('requires evidence, a repair plan and an existing file before findings can be repaired', () => {
        const report = {status: 'completed', summary: 'Found a defect.', limitations: [],
            findings: [{severity: 'error', file: '/logic.ts', issue: 'Null input crashes.', evidence: 'input.trim() has no null guard.', repair: 'Handle null input.'}]};
        expect(parseWorkspaceReviewReport(JSON.stringify(report), [{path: '/logic.ts'}])).toEqual(report);
        expect(() => parseWorkspaceReviewReport(JSON.stringify(report), [])).toThrow('existing workspace file');
        report.findings[0].evidence = '';
        expect(() => parseWorkspaceReviewReport(JSON.stringify(report), [{path: '/logic.ts'}])).toThrow('evidence');
    });

    test('rejects a generated review file rather than treating it as a clean workspace', () => {
        expect(() => parseWorkspaceReviewReport('### File: /review.ts\nexport const review = {};')).toThrow('unverified');
        expect(WORKSPACE_REVIEW_REPORT_CONTRACT).toContain('Do not invoke tools');
        expect(WORKSPACE_REVIEW_REPORT_CONTRACT).toContain('host handles repairs in a separate request');
    });

    test('reports applied repairs and host test outcomes without exposing generated files', () => {
        const rendered = formatWorkspaceReviewReport({status: 'partial', summary: 'A fix was applied.', findings: [], limitations: ['Verification failed.']},
            {changed: true, repairSummary: 'Repair: 1 file updated.', tests: 'Tests: still failing.'});
        expect(rendered).toContain('partially completed');
        expect(rendered).toContain('Repair: 1 file updated.');
        expect(rendered).toContain('Tests: still failing.');
        expect(rendered).toContain('Workspace changes were applied.');
    });
});
