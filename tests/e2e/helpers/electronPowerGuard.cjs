// Display sleep coincided with loss of Chromium's debugging connection while
// Electron's main-process inspector stayed alive. GUI runs own a temporary
// native power assertion; ordinary app sessions never acquire this guard.
async function acquireElectronPowerGuard(app) {
  const id = await app.evaluate(({powerSaveBlocker}) => powerSaveBlocker.start('prevent-display-sleep'));
  let released = false;
  return {
    id,
    async release() {
      if (released) return;
      released = true;
      let timer;
      try {
        await Promise.race([
          app.evaluate(({powerSaveBlocker}, id) => powerSaveBlocker.stop(id), id),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Power guard release timed out')), 2000); }),
        ]);
      } catch {
        // Process exit also releases the OS assertion. A broken automation
        // connection must not prevent the caller's bounded process cleanup.
      } finally { clearTimeout(timer); }
    },
  };
}

module.exports = {acquireElectronPowerGuard};
