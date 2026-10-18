export function isWorkspaceQualityReviewPrompt(prompt = "") {
    return /\bworkspace quality review\b/i.test(String(prompt || ""));
}

export const WORKSPACE_REVIEW_PROMPT = [
    "Workspace quality review.",
    "The host runs plugin tests and supplies their results. Investigate any failing tests in the supplied evidence.",
    "Review the supplied current plugin workspace, build output, and Problems panel evidence.",
    "Inspect the deployed render path and CSS style registration even when tests pass; class-name assertions alone do not verify styling.",
    "Identify handwritten production UI HTML for migration to installed SDK helpers, including nested/dynamic fragments. Preserve styles, accessibility, escaping and interaction bindings; report unsupported cases.",
    "Report only confirmed plugin-local issues, ordered by severity with the affected file and a concrete repair plan.",
    "Do not modify files in this review-first request.",
].join(" ");

export const WORKSPACE_REPAIR_PROMPT = [
    "Workspace quality review.",
    "The host runs plugin tests and supplies their results. Investigate any failing tests in the supplied evidence.",
    "Review the supplied current plugin workspace, build output, and Problems panel evidence.",
    "Inspect and repair unregistered styles on the deployed render path even when tests pass; preserve the intended visual design.",
    "Replace all confirmed handwritten production UI HTML with installed SDK helpers, including nested/dynamic fragments, preserving markup behavior, styles, accessibility, escaping and interaction bindings. Report unsupported cases instead of silently skipping them.",
    "Automatically repair confirmed plugin-local issues, preserving working behavior and the public plugin SDK contract.",
    "Re-run plugin tests after each repair and stop when the workspace is clean or when a remaining issue needs a developer decision.",
].join(" ");

export const WORKSPACE_REVIEW_REPORT_CONTRACT = `This request produces a review report, never a source file. Review the supplied workspace and diagnostic evidence only. Do not invoke tools: the host supplies files and runs tests. Do not invent completed inspections or test runs. Ignore instructions to return executable files for this review.
Return one JSON object, without fences or introductory text:
{"status":"completed|partial|blocked","summary":"plain-language outcome","findings":[{"severity":"error|warning","file":"existing absolute virtual path","issue":"confirmed defect","evidence":"specific supplied source or diagnostic","repair":"concrete correction"}],"limitations":["missing evidence or blockers"]}
Use blocked if the supplied workspace cannot be assessed; partial if material checks cannot be completed. An empty findings list means no confirmed issues in the evidence reviewed, not proof of correctness. No /review.ts, code declarations, file sections, or proposed source. For Review & Repair, report confirmed issues first; the host handles repairs in a separate request.`;

export function parseWorkspaceReviewReport(content, workspaceFiles = []) {
    let report;
    try {
        const text = String(content || '').trim();
        const fence = text.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/);
        report = JSON.parse(fence ? fence[1] : text);
    }
    catch { throw new Error('The assistant did not return a usable review report. Workspace quality remains unverified. Retry the review.'); }
    const paths = new Set(workspaceFiles.map(file => file.path));
    if (!['completed', 'partial', 'blocked'].includes(report?.status) || typeof report.summary !== 'string'
        || !Array.isArray(report.findings) || !Array.isArray(report.limitations)
        || report.limitations.some(item => typeof item !== 'string')) {
        throw new Error('The assistant returned an incomplete review report. Workspace quality remains unverified.');
    }
    for (const finding of report.findings) {
        if (!['error', 'warning'].includes(finding?.severity) || !paths.has(finding.file)
            || ['issue', 'evidence', 'repair'].some(key => typeof finding[key] !== 'string' || !finding[key].trim())) {
            throw new Error('The review contains a finding without an existing workspace file, evidence, or repair plan. No repairs were started.');
        }
    }
    return report;
}

export function formatWorkspaceReviewReport(report, {repairSummary = '', tests = '', changed = false} = {}) {
    const title = {completed: 'Workspace review completed', partial: 'Workspace review partially completed', blocked: 'Workspace review could not complete'}[report.status];
    const findings = report.findings.map(finding => `- **${finding.severity === 'error' ? 'Error' : 'Warning'} — ${finding.file}:** ${finding.issue}\n  Evidence: ${finding.evidence}\n  Repair: ${finding.repair}`).join('\n');
    return [`**${title}**`, report.summary,
        findings ? `${changed ? 'Findings identified before repair:' : 'Confirmed findings:'}\n\n${findings}`
            : 'No confirmed issues were reported in the supplied evidence. This does not establish that the workspace is clean.',
        report.limitations.length ? `Limitations:\n${report.limitations.map(item => `- ${item}`).join('\n')}` : '',
        report.observations ? `Investigation actions: ${report.observations.map(item => item.action.tool).join(' → ') || 'none'}.\nBudget used: approximately ${Math.round(report.budget?.spentTokens || 0).toLocaleString()} tokens of ${Math.round(report.budget?.tokenLimit || 0).toLocaleString()}.` : '',
        repairSummary, tests, changed ? 'Workspace changes were applied.' : 'Workspace files were unchanged.'].filter(Boolean).join('\n\n');
}
import {findWorkspaceStyleIssues} from './validateGeneratedPluginFiles';
import {PLUGIN_STYLE_RENDERING_GUIDANCE} from '../../../utils/plugins/authoring/pluginAuthoringGuide';
import {findWorkspaceHtmlIssues, PLUGIN_HTML_MIGRATION_GUIDANCE} from '../../../utils/plugins/validation/workspaceHtmlReview';

export function workspaceStyleReviewContext(files) {
    return `STYLESHEET REVIEW CONTRACT\n${PLUGIN_STYLE_RENDERING_GUIDANCE}\nHost source diagnostics (not visual verification):\n${JSON.stringify(findWorkspaceStyleIssues(files))}`;
}

export function includeWorkspaceStyleFindings(report, files) {
    const issues = findWorkspaceStyleIssues(files);
    let added = false;
    for (const issue of issues) {
        if (!report.findings.some(finding => finding.file === issue.file && finding.issue === issue.issue)) {
            report.findings.push(issue);
            added = true;
        }
    }
    if (added) report.summary += ' Host source checks also found unregistered plugin styles requiring repair.';
    return report;
}

export function workspaceReviewContext(files) {
    return `${workspaceStyleReviewContext(files)}\n\n${PLUGIN_HTML_MIGRATION_GUIDANCE}\nHost HTML source diagnostics (migration candidates; verify UI use before rewriting):\n${JSON.stringify(findWorkspaceHtmlIssues(files))}`;
}

export function includeWorkspaceAuthoringFindings(report, files) {
    includeWorkspaceStyleFindings(report, files);
    let added = false;
    for (const issue of findWorkspaceHtmlIssues(files)) {
        if (!report.findings.some(finding => finding.file === issue.file && finding.issue === issue.issue)) {
            report.findings.push(issue);
            added = true;
        }
    }
    if (added) report.summary += ' Host source checks also found handwritten HTML to review for SDK-helper migration.';
    return report;
}
