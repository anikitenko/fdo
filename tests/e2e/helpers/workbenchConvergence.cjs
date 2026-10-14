const {summarizeTestFailures} = require('./testFailureSummary.cjs');
const {workbenchTestRepairPaths} = require('./workbenchRepairScope.cjs');

function workbenchPassed({compiled, runtimeContract, rubric, testRun, problems = []}) {
  return compiled.success && runtimeContract.passed && rubric.passed
    && testRun.success && !testRun.skipped && rubric.checks.nodeTests && !problems.length;
}

function buildWorkbenchConvergencePrompt(state) {
  const {compiled, runtimeContract, rubric, testRun, problems = []} = state;
  if (workbenchPassed(state)) return '';
  const failed = Object.entries(rubric.checks).filter(([, passed]) => !passed).map(([name]) => name);
  const repairPaths = workbenchTestRepairPaths(state);
  if (compiled.success && runtimeContract.passed && testRun.success && !testRun.skipped && !problems.length
    && !rubric.violations?.length && failed.length && failed.every(name => ['polishedWorkbench', 'responsiveLayout'].includes(name))
    && state.styleRepairPrompt) return state.styleRepairPrompt;
  return [
    repairPaths.length && `WORKSPACE_REPAIR_PATHS: ${JSON.stringify(repairPaths)}`,
    `Repair the current Web Tools Workbench workspace. Return only complete changed file sections for the owning plugin-local ${repairPaths.length ? 'implementation modules' : 'implementation and test modules'}. Preserve module boundaries, all screens, interactions and passing tests. Do not edit /package.json or add dependencies.`,
    repairPaths.length && 'Repair only the listed implementation files. The failing tests and their assertions are immutable. Other workspace files remain available as dependencies; do not regenerate them or request a new file inventory.',
    !compiled.success && `BUILD FAILURE: ${compiled.error || 'Unknown compiler failure'}`,
    !compiled.success && 'Fix the reported imports in their owning files. CSS dependencies must be acyclic: shared base styles must not import feature styles that already depend on the base. Keep feature composition in /styles.css and preserve all required styles.',
    !runtimeContract.passed && `SDK CONTRACT: ${runtimeContract.violations.join(' ')} Use FDO_SDK implements FDOInterface, preserve metadata and lifecycle methods, and instantiate the plugin.`,
    failed.length && `ACCEPTANCE FAILURES: ${failed.join(', ')}.`,
    rubric.violations?.length && `SOURCE VIOLATIONS: ${rubric.violations.join(' ')}`,
    (rubric.missingRoles?.length || rubric.missingActionRoles?.length) && `Missing rendered controls: ${[...new Set([...(rubric.missingRoles || []), ...(rubric.missingActionRoles || [])])].join(', ')}. Render these roles on actual controls and wire their click handlers through defineRenderOnLoadActions.`,
    !rubric.checks.visibleStates && 'Render library and personal space initially with data-state="closed" and the formatter with data-state="idle" or "empty"; actions must produce visible success/error states. Preserve the complete screen composition.',
    !rubric.checks.styleMapRendered && 'Use one SDK DOM instance for createClassFromStyle(css.shell/dashboard/card/library/workspace/result/dock) and dom.renderHTML(composedHtml). Apply each class to its corresponding element, not all classes to the same wrapper. Return the finalized HTML from the plugin render() lifecycle.',
    rubric.visualFailures?.length && `CSS REQUIREMENTS: ${rubric.visualFailures.map(item => item.requirement).join(' ')}`,
    (!testRun.success || testRun.skipped || !rubric.checks.nodeTests) && `TEST FAILURES:\n${summarizeTestFailures(testRun.output || testRun.error || 'Tests skipped or required node:test coverage missing', 12000, state.files)}`,
    (!testRun.success || testRun.skipped || !rubric.checks.nodeTests) && (repairPaths.length
      ? 'Follow each failure to its cause: fix source defects in implementation modules while preserving every test and assertion. Do not skip tests, remove cases or weaken expectations. Retain compatibility with existing consumers of each repaired export.'
      : 'Follow each failure to its cause: fix source defects in implementation modules; fix test invocation/fixtures only when they conflict with the actual exported API. An array of category metadata must be searched by key, not indexed by a category string. Test the composed render entry for shell/overlay assertions; leaf renderers only own their own controls. Preserve assertions and coverage; do not skip tests, remove cases or weaken expectations to hide implementation failures. Use node:test and node:assert/strict with at least two executable tests.'),
    problems.length && `EDITOR DIAGNOSTICS: ${JSON.stringify(problems)}`,
    'After this repair the full workspace is rebuilt and all tests and acceptance checks run again. A previously passing build or test does not exempt changed source from revalidation.',
  ].filter(Boolean).join('\n');
}

async function convergeWorkbench({inspect, repair, attempts, onRound = async () => {}}) {
  let state = await inspect();
  await onRound({attempt: 0, ...state});
  for (let attempt = 1; attempt <= attempts && !workbenchPassed(state); attempt += 1) {
    const prompt = buildWorkbenchConvergencePrompt(state);
    await repair(prompt);
    state = await inspect();
    await onRound({attempt, prompt, ...state});
  }
  return state;
}

module.exports = {workbenchPassed, buildWorkbenchConvergencePrompt, convergeWorkbench};
