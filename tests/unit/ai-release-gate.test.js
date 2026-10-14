const {evaluateAiReleaseGate} = require('../../scripts/lib/ai-release-gate.cjs');
const {createReliabilityPlan, summarizeReliabilityRun} = require('../../scripts/lib/live-ai-reliability.cjs');
const now = Date.parse('2026-09-28T12:00:00Z');
const options = {fingerprint: 'current', now};
function evidence() {
    return {sourceFingerprint: 'current', completedAt: new Date(now - 1000).toISOString(), complete: true,
        passed: true, plannedRuns: 6, runs: ['openai', 'ollama'].flatMap(provider => [1, 2, 3].map(seed => ({
            id: `${provider}-${seed}`, provider, model: 'pinned-model', seed: `seed-${seed}`, passed: true,
            exitCode: 0, signal: null, skippedTests: 0, plannedTests: 1, executedTests: 1,
            scenarios: ['Web Tools Workbench realistic user request: builds and exercises'],
        })))};
}
test('accepts complete current evidence across providers and seeds', () => {
    expect(evaluateAiReleaseGate(evidence(), options)).toMatchObject({ready: true, reasons: []});
});
test.each(['empty', 'partial', 'stale', 'changed source', 'failed', 'skipped', 'duplicate', 'one seed', 'wrong scenario'])(
    'refuses %s evidence', defect => {
        const report = evidence();
        if (defect === 'empty') report.runs = [];
        if (defect === 'partial') report.complete = false;
        if (defect === 'stale') report.completedAt = '2026-01-01';
        if (defect === 'changed source') report.sourceFingerprint = 'old';
        if (defect === 'failed') report.runs[0].passed = false;
        if (defect === 'skipped') report.runs[0].skippedTests = 1;
        if (defect === 'duplicate') report.runs[1].id = report.runs[0].id;
        if (defect === 'one seed') report.runs.forEach(run => {run.seed = 'same';});
        if (defect === 'wrong scenario') report.runs[0].scenarios = ['opens settings'];
        expect(evaluateAiReleaseGate(report, options).ready).toBe(false);
    });
test('matrix seed survives planning and outcome aggregation', () => {
    const [run] = createReliabilityPlan([{provider: 'ollama', model: 'local', seed: 'release-3'}], {repeat: 1, env: {}});
    const result = summarizeReliabilityRun(run, {exitCode: 0, artifactDir: '/tmp/fdo', report: {
        status: 'passed', plannedTests: 1, tests: [{title: 'Web Tools Workbench', status: 'passed', expectedStatus: 'passed'}],
    }});
    expect(result).toMatchObject({seed: 'release-3', passed: true, scenarios: ['Web Tools Workbench']});
});

test('prescribed contract regressions cannot substitute for realistic-user release evidence', () => {
    const report = evidence();
    report.runs.forEach(run => {run.scenarios = ['Web Tools Workbench contract regression'];});
    expect(evaluateAiReleaseGate(report, options).ready).toBe(false);
});
