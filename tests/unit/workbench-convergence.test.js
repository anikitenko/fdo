const recorded = require('../fixtures/ai/workbench-acceptance-repair.json');
const {evaluateWebToolsWorkbenchScenario} = require('../e2e/helpers/pluginScenarioRubric.cjs');
const {mappedMarkupRoles} = require('../e2e/helpers/mappedMarkupRoles.cjs');
const {convergeWorkbench, workbenchPassed, buildWorkbenchConvergencePrompt} = require('../e2e/helpers/workbenchConvergence.cjs');

const failedState = () => ({...recorded, rubric: evaluateWebToolsWorkbenchScenario(recorded.files)});
const goodState = () => ({...failedState(), compiled: {success: true}, testRun: {success: true, skipped: false},
  rubric: {...failedState().rubric, passed: true, checks: {nodeTests: true}}, problems: []});

test('recorded metadata templates render category roles without hiding real failures', () => {
  const state = failedState();
  expect(state.rubric.missingRoles).toEqual([]);
  expect(state.rubric.missingActionRoles).toEqual([]);
  expect(state.rubric.checks.styleMapRendered).toBe(false);
  expect(workbenchPassed(state)).toBe(false);
  const prompt = buildWorkbenchConvergencePrompt(state);
  expect(prompt).toContain('Circular CSS import');
  expect(prompt).toContain('TEST FAILURES:');
  expect(prompt).toContain('dom.renderHTML(composedHtml)');
  expect(prompt).toContain('fix source defects in implementation modules');
  expect(prompt).not.toContain('Missing rendered controls: tool-card');
});

test.each(['unused metadata', 'wrong property', 'test-only metadata', 'comments'])('does not accept role strings from %s', kind => {
  const files = {
    '/types.ts': 'export const META = [{role: "tool-card-text"}] as const;',
    '/render.ts': 'import {META} from "./types"; export const render = () => META.map(m => `<button data-role="${m.role}"></button>`).join("");',
  };
  expect(mappedMarkupRoles(files).has('tool-card-text')).toBe(true);
  if (kind === 'unused metadata') files['/render.ts'] = 'export const render = () => "";';
  if (kind === 'wrong property') files['/render.ts'] = files['/render.ts'].replace('m.role', 'm.other');
  if (kind === 'test-only metadata') { files['/types.test.ts'] = files['/types.ts']; delete files['/types.ts']; }
  if (kind === 'comments') files['/types.ts'] = '// ' + files['/types.ts'];
  expect(mappedMarkupRoles(files).size).toBe(0);
});

test('rechecks compilation and tests after every repair, including late regressions', async () => {
  const regression = {...goodState(), compiled: recorded.compiled};
  const inspect = jest.fn().mockResolvedValueOnce(failedState()).mockResolvedValueOnce(regression).mockResolvedValueOnce(goodState());
  const repair = jest.fn();
  const onRound = jest.fn();
  expect(workbenchPassed(await convergeWorkbench({inspect, repair, attempts: 3, onRound}))).toBe(true);
  expect(inspect).toHaveBeenCalledTimes(3);
  expect(repair).toHaveBeenCalledTimes(2);
  expect(repair.mock.calls[1][0]).toContain('Circular CSS import');
  expect(onRound).toHaveBeenCalledTimes(3);
});

test('exhausted repair rounds retain all failures and never report a pass', async () => {
  const inspect = jest.fn(async () => failedState());
  const repair = jest.fn();
  const state = await convergeWorkbench({inspect, repair, attempts: 2});
  expect(inspect).toHaveBeenCalledTimes(3);
  expect(repair).toHaveBeenCalledTimes(2);
  expect(workbenchPassed(state)).toBe(false);
  expect(state.testRun.success).toBe(false);
});

test('a fully passing workspace makes no repair requests', async () => {
  const repair = jest.fn();
  await convergeWorkbench({inspect: async () => goodState(), repair, attempts: 3});
  expect(repair).not.toHaveBeenCalled();
});

test('preserves narrow CSS repair when every other gate passes', () => {
  const state = goodState();
  state.rubric = {...state.rubric, passed: false, checks: {nodeTests: true, polishedWorkbench: false}};
  state.styleRepairPrompt = 'Repair only /styles/layout.css.';
  expect(buildWorkbenchConvergencePrompt(state)).toBe(state.styleRepairPrompt);
});

test('mapped roles support imported aliases and ignore unresolved spread properties', () => {
  expect([...mappedMarkupRoles({
    '/types.ts': 'const base = {}; export const META = [{...base, role: "tool-card-text"}] as const;',
    '/render.ts': 'import {META as cards} from "./types"; export const render = () => cards.map(m => `<button data-role="${m.role}"></button>`).join("");',
  })]).toEqual(['tool-card-text']);
});
