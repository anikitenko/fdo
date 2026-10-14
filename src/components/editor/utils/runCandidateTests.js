import virtualFS from './VirtualFS';

export async function runCandidateTests(data, run) {
    virtualFS.build.setInProgress?.();
    virtualFS.build.addMessage?.('Running candidate workspace tests. Generated files are not applied yet.', false, 'test');
    try {
        const result = await run(data);
        if (result?.output) virtualFS.build.addMessage?.(result.output, !result.success, 'test');
        virtualFS.build.addMessage?.(result?.success && !result.skipped ? 'Candidate tests passed.' : 'Candidate tests did not pass. The coding agent will report or repair the failures.', !result?.success || !!result?.skipped, 'test');
        return result;
    } catch (error) {
        virtualFS.build.addMessage?.(`Candidate tests failed: ${error.message}`, true, 'test');
        throw error;
    } finally { virtualFS.build.stopProgress?.(); }
}
