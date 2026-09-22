// Poll inside the renderer instead of sending a locator assertion over CDP
// every 500ms throughout a potentially 30-minute generation. A partial answer
// must not win a race against the running indicator and finish the wait early.
async function waitForAssistantUiToSettle(page, timeout) {
  const started = Date.now();
  const state = await page.waitForFunction(() => {
    const running = [...document.querySelectorAll('button')]
      .some(button => button.textContent.trim() === 'Stop');
    if (running) return 'running';
    if (document.querySelector('[data-testid="ai-coding-response"], [data-testid="ai-coding-error"]')) return 'settled';
    return false;
  }, undefined, {polling: 250, timeout: Math.min(30000, timeout)});
  let initial;
  try { initial = await state.jsonValue(); } finally { await state.dispose(); }
  if (initial === 'settled') return;
  const remaining = timeout - (Date.now() - started);
  if (remaining <= 0) throw new Error('Assistant request did not settle before the deadline.');
  const settled = await page.waitForFunction(() => ![...document.querySelectorAll('button')]
    .some(button => button.textContent.trim() === 'Stop'), undefined, {polling: 250, timeout: remaining});
  await settled.dispose();
}

module.exports = {waitForAssistantUiToSettle};
