import {validationWorkspaceKey} from './aiValidationRecovery';

export function retainWorkspaceReview({report, files, workspace, revision, prompt, tests}) {
    return {report: JSON.parse(JSON.stringify(report)), baseline: validationWorkspaceKey(files),
        workspace, revision, prompt, tests};
}

export function assertWorkspaceReviewCurrent(retained, {files, workspace, revision}) {
    if (retained.workspace !== workspace || retained.revision !== revision || retained.baseline !== validationWorkspaceKey(files)) {
        throw new Error('The workspace changed since this review. Run Review workspace again before repairing or continuing; the saved findings were not applied.');
    }
}

export function reviewRepairDisposition(report, {freshRequest = false, migrateGuide = false} = {}) {
    if (report.status === 'blocked') return 'blocked';
    if (!report.findings.length && !migrateGuide) return 'empty';
    if (!freshRequest && report.budget && (report.budget.tokens < 4000 || !(report.budget.milliseconds > 0))) return 'budget';
    return 'repair';
}

export function deferredReviewRepairMessage(report, reason) {
    if (reason === 'budget') return `The review reached its investigation budget. ${report.findings.length} confirmed finding(s) are saved. Choose Repair confirmed findings to start a focused repair, or Continue review to gather more evidence.`;
    if (reason === 'blocked') return 'The review could not establish a safe repair. The evidence is saved; continue the review after addressing its limitations.';
    return 'No confirmed issues were identified for automatic repair. Continue review if checks remain incomplete.';
}
