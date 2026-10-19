// waitForFunction polls synchronous browser predicates. IPC predicates must be
// awaited before testing their value, otherwise a pending Promise ends the wait.
async function waitForAsyncCondition(page, predicate, argument, {timeout = 15000} = {}) {
  // Discovery helpers are also loaded by Jest without a browser runtime.
  const {expect} = require('@playwright/test');
  await expect.poll(async () => !!(await page.evaluate(predicate, argument)), {
    timeout,
    intervals: [100, 250, 500],
    message: 'Waiting for asynchronous browser condition',
  }).toBe(true);
}
module.exports = {waitForAsyncCondition};
