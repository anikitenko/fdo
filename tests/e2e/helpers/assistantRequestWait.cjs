// Poll inside the renderer instead of sending a locator assertion over CDP
// every 500ms throughout a potentially 30-minute generation. A partial answer
// must not win a race against the running indicator and finish the wait early.
async function waitForAssistantUiToSettle(page, timeout, {remainingMs, afterResponseCount, approvePluginGuide = false} = {}) {
  const started = Date.now();
  const state = await page.waitForFunction(baseline => {
    const running = [...document.querySelectorAll('button')]
      .some(button => button.textContent.trim() === 'Stop');
    if (running) return 'running';
    if ((baseline === undefined || (window.__liveAiResponses || []).length > baseline)
      && document.querySelector('[data-testid="ai-coding-response"], [data-testid="ai-coding-error"]')) return 'settled';
    return false;
  }, afterResponseCount, {polling: 250, timeout: Math.min(30000, timeout)}).catch(cause => {
    if (cause.name !== 'TimeoutError') throw cause;
    throw Object.assign(new Error(`Assistant startup timeout: no running request or new response within ${Math.min(30000, timeout)}ms.`, {cause}),
      {code: 'ASSISTANT_START_TIMEOUT'});
  });
  let initial;
  try { initial = await state.jsonValue(); } finally { await state.dispose(); }
  if (initial === 'settled') return;
  let guideRetries = 0;
  while (true) {
    const remaining = remainingMs ? await remainingMs() : timeout - (Date.now() - started);
    if (remaining <= 0) throw new Error('Assistant request did not settle before the deadline.');
    try {
      const settled = await page.waitForFunction(({baseline, approvePluginGuide, guideRetries}) => {
        if (approvePluginGuide) {
          const recovery = document.querySelector('[data-testid="guide-proposal-recovery"]');
          if (recovery) {
            // Wait for the clicked dialog to close before considering another
            // recovery. Only one explicit retry is allowed per assistant wait.
            if (recovery.dataset.testRetrySent) return false;
            const retry = [...document.querySelectorAll('button')]
              .find(button => button.textContent.trim() === 'Retry failed step');
            if (guideRetries < 1 && retry && !retry.disabled) {
              recovery.dataset.testRetrySent = 'true';
              retry.click();
              return 'guide-retry';
            }
            throw new Error('Plugin guide proposal exhausted automatic section repairs and requires editing or an explicit retry. The live test cannot approve an invalid proposal.');
          }
          const button = document.querySelector('[data-testid="approve-plugin-guide"]');
          if (button && !button.disabled && !button.dataset.testApprovalSent) {
            button.dataset.testApprovalSent = 'true';
            button.click();
          }
        }
        return ![...document.querySelectorAll('button')]
        .some(button => button.textContent.trim() === 'Stop')
        && (baseline === undefined || (window.__liveAiResponses || []).length > baseline); }, {baseline: afterResponseCount, approvePluginGuide, guideRetries},
      {polling: 250, timeout: remainingMs ? Math.min(5000, remaining) : remaining});
      let outcome;
      try { outcome = await settled.jsonValue(); } finally { await settled.dispose(); }
      if (outcome === 'guide-retry') {
        guideRetries++;
        continue;
      }
      return;
    } catch (error) {
      // Short polling windows refresh both deadlines from host-validated
      // progress. Transport errors and page closure are never retried here.
      if (!remainingMs || error.name !== 'TimeoutError') throw error;
    }
  }
}

function createLiveAiTimeoutMonitor({testInfo, readBudget, initialTimeout, startedAt, now = Date.now}) {
  return async () => {
    const budget = await readBudget();
    const extension = Math.max(0, budget?.timeoutExtensionMs || 0);
    const duration = initialTimeout + extension;
    if (duration > testInfo.timeout) {
      testInfo.setTimeout(duration);
      console.log(`Live AI timeout extended to ${duration}ms (${budget.validatedFiles} validated files).`);
    }
    return startedAt + testInfo.timeout - now();
  };
}

module.exports = {waitForAssistantUiToSettle, createLiveAiTimeoutMonitor};
