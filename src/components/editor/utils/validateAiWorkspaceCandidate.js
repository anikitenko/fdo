import {validatePluginAcceptanceCriteria, readPluginAcceptanceCriteria} from '../../../utils/plugins/authoring/pluginAcceptanceCriteria';
import {validateGeneratedCssCycles} from '../../../utils/plugins/validation/generatedCssCycles';
import {isGeneratedTestFile, generatedWorkspaceTestDiagnostics} from '../../../utils/plugins/validation/generatedWorkspaceTestDiagnostics';
import {validateGeneratedWorkspaceImports} from '../../../utils/plugins/validation/generatedWorkspaceImports';
import {validateGeneratedWorkspaceCalls} from '../../../utils/plugins/validation/generatedWorkspaceCalls';
import {validateGeneratedWorkspaceOptions} from '../../../utils/plugins/validation/generatedWorkspaceOptions';
import {validateAiCompatibilityChanges} from '../../../utils/sdk/pluginAuthoringContract';
import {validateGeneratedInteractions} from '../../../utils/plugins/validation/generatedInteractions';

const fingerprint = files => JSON.stringify(files.map(({path, content}) => [path, content]).sort(([a], [b]) => a.localeCompare(b)));

// Compile a detached candidate, including retained dependencies. Never mutate
// editor models while awaiting a build, and never apply over concurrent edits.
export async function validateAiWorkspaceCandidate({files, workspaceFiles, readWorkspace, build, typecheck, runTests, staticOnly = false, onTestStart, onTestFailure, assertActive, onVerification = () => {}}) {
    const report = {
        changedPaths: files.map(file => file.path),
        checks: [
            {id: 'contracts', label: 'Workspace imports, calls and CSS dependencies', status: 'pending'},
            {id: 'build', label: 'Candidate build and installed SDK checks', status: 'pending'},
            {id: 'tests', label: 'Candidate tests', status: 'pending'},
            {id: 'types', label: 'TypeScript check before application', status: 'pending'},
            {id: 'acceptance', label: 'Approved acceptance tests', status: 'pending'},
            {id: 'security', label: 'Dedicated security audit', status: 'not-run', detail: 'Runtime restrictions do not constitute a completed security audit.'},
        ],
    };
    const emit = () => { try { onVerification(JSON.parse(JSON.stringify(report))); } catch { /* Observation cannot authorize or block application. */ } };
    const update = (id, status, detail = '') => {
        Object.assign(report.checks.find(check => check.id === id), {status, detail: String(detail).slice(0, 12000)});
        emit();
    };
    emit();
    // Validation failures intentionally share this boundary with operation failures.
    try {
        update('contracts', 'running');
        const before = fingerprint(workspaceFiles);
        const assertCurrent = () => {
            assertActive();
            if (fingerprint(readWorkspace()) !== before) {
                throw new Error('Workspace changed during AI validation. No generated files were applied; retry using the current workspace.');
            }
        };
        assertCurrent();
        const paths = new Set();
        for (const file of files) {
            if (paths.has(file.path)) {
                const error = `Duplicate generated workspace path: ${file.path}. Return each changed file once.`;
                update('contracts', 'failed', error);
                return [error];
            }
            paths.add(file.path);
        }
        const merged = new Map(workspaceFiles.map(file => [file.path, file]));
        files.forEach(file => merged.set(file.path, file));
        const candidate = [...merged.values()];
        const errors = validateGeneratedWorkspaceImports(candidate);
        errors.push(...validateAiCompatibilityChanges(workspaceFiles.find(file => file.path === '/package.json')?.content,
            candidate.find(file => file.path === '/package.json')?.content));
        errors.push(...validateGeneratedCssCycles(candidate));
        errors.push(...validateGeneratedWorkspaceCalls(candidate));
        errors.push(...validateGeneratedWorkspaceOptions(candidate));
        errors.push(...validateGeneratedInteractions(candidate,{baseline:workspaceFiles}));
        update('contracts', errors.length ? 'failed' : 'passed', errors.join('\n'));
        update('acceptance', 'running');
        const acceptanceErrors = validatePluginAcceptanceCriteria(candidate);
        errors.push(...acceptanceErrors);
        const criteria = acceptanceErrors.length ? [] : readPluginAcceptanceCriteria(candidate.find(file => file.path === '/SKILL.md')?.content);
        if (acceptanceErrors.length) update('acceptance', 'failed', acceptanceErrors.join('\n'));
        else update('acceptance', criteria.length ? 'pending' : 'not-run', criteria.length ? 'Required test cases found; awaiting suite execution.' : 'No approved acceptance criteria in this workspace.');
        // Preserve concrete owner diagnostics when the typechecker is absent.
        // When available, still collect compiler owners in the same repair pass.
        if (errors.length && typeof typecheck !== 'function') return [...new Set(errors)];
        update('types', 'running');
        if (typeof typecheck !== 'function') {
            //noinspection ExceptionCaughtLocallyJS
            throw new Error('Plugin TypeScript checker is unavailable. No generated files were applied.');
        }
        const types = await typecheck({latestContent: Object.fromEntries(candidate.map(file => [file.path, file.content]))});
        assertCurrent();
        if (types?.success !== true) {
            const diagnostics = types?.diagnostics?.length ? types.diagnostics.map(item =>
                `${item.path || 'TypeScript environment'}:${item.line}:${item.column}: TS${item.code}: ${item.message}`)
                : [`TypeScript check failed: ${types?.error || 'No successful result returned.'}`];
            update('types', 'failed', diagnostics.join('\n'));
            errors.push(...diagnostics);
        } else update('types', 'passed', types.compilerVersion ? `TypeScript ${types.compilerVersion}` : '');
        // Collect independent static diagnostics before choosing repair owners.
        // An import/acceptance failure must not hide compiler errors until the
        // single workspace repair allowance has already been consumed.
        if (errors.length || staticOnly) return [...new Set(errors)];
        update('build', 'running');
        if (typeof build !== 'function') {
            //noinspection ExceptionCaughtLocallyJS
            throw new Error('Plugin compiler is unavailable. No generated files were applied.');
        }
        const result = await build({latestContent: Object.fromEntries(candidate.map(file => [file.path, file.content]))});
        assertCurrent();
        if (result?.success !== true) {
            const error = `Candidate workspace build failed: ${String(result?.error || 'Compiler returned no successful result.').slice(0, 6000)}`;
            update('build', 'failed', error);
            // Preserve explicit compiler owners for scoped automatic repair.
            // A path mentioned in prose is not permission to edit that file.
            const owners = [...new Set([...String(result?.error || '').matchAll(/^(?:virtual(?:-fs)?:)?(\/[^:\n]+):\d+(?::\d+)?[:\s]/gm)].map(match => match[1]))];
            if (owners.length && owners.every(path => candidate.some(file => file.path === path))) {
                return owners.map(path => `${path}: ${error}`);
            }
            return [error];
        }
        update('build', 'passed');
        if (candidate.some(file => isGeneratedTestFile(file.path))) {
            update('tests', 'running');
            if (typeof runTests !== 'function') {
                //noinspection ExceptionCaughtLocallyJS
                throw new Error('Plugin test runner is unavailable. No generated files were applied.');
            }
            onTestStart?.();
            const testResult = await runTests({latestContent: Object.fromEntries(candidate.map(file => [file.path, file.content]))});
            assertCurrent();
            if (testResult?.success !== true || testResult?.skipped) {
                onTestFailure?.(testResult.results || []);
                const diagnostics = generatedWorkspaceTestDiagnostics(testResult, candidate);
                update('tests', 'failed', diagnostics.join('\n'));
                return diagnostics;
            }
            update('tests', 'passed');
            const unmet = criteria.filter(item => !(testResult.results || []).some(result => result.file === item.testFile
                && result.name === item.testName && result.passed === true && !result.skipped && !result.todo));
            if (unmet.length) {
                const diagnostics = unmet.map(item => `${item.testFile}: Acceptance ${item.id} has no passing execution evidence for ${JSON.stringify(item.testName)}.`);
                update('acceptance', 'failed', diagnostics.join('\n'));
                onTestFailure?.(testResult.results || []);
                return diagnostics;
            }
            if (criteria.length) update('acceptance', 'passed', criteria.map(item => `${item.id}: ${item.testFile} — ${item.testName}`).join('\n'));
        } else update('tests', 'not-run', 'No test files in the candidate workspace.');
        return [];
    } catch (error) {
        const running = report.checks.find(check => check.status === 'running');
        if (running) update(running.id, 'failed', error.message);
        throw error;
    } finally {
        report.checks.filter(check => check.status === 'pending').forEach(check => {
            check.status = 'blocked'; check.detail = 'An earlier verification step did not complete successfully.';
        });
        emit();
    }
}
