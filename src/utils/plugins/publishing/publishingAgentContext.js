import ignore from 'ignore';
import {checkPublishingFiles} from './publishingCheck';
import {PUBLISHING_EXCLUSIONS} from './publishingSourcePolicy';

export function buildPublishingAgentContext(workspaceFiles = []) {
    if (!Array.isArray(workspaceFiles) || !workspaceFiles.length) return '';
    const excluded = ignore().add(PUBLISHING_EXCLUSIONS);
    const patterns = workspaceFiles.find(file => file.path === '/.fdoignore' || file.path === '.fdoignore')?.content;
    if (typeof patterns === 'string') excluded.add(patterns);
    const files = Object.fromEntries(workspaceFiles.filter(file => typeof file.path === 'string' && typeof file.content === 'string')
        .map(file => [file.path.replace(/^\//, ''), file.content])
        .filter(([name]) => name && !name.startsWith('../') && !excluded.ignores(name)));
    // This never receives profile/certificate data and never executes generated code.
    const report = checkPublishingFiles(files);
    return `LOCAL REGISTRY SOURCE PREFLIGHT (supplied workspace only; advisory for generic requests)
${report.valid ? 'Source policy passed.' : report.errors.slice(0, 12).map(error => `- ${error}`).join('\n')}
${report.notes.join('\n')}
No build, signature, account check, server scan or upload was performed. Re-run fdo validate <path> --publishing after edits.`;
}
