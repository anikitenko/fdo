// Deterministic session double used only by the instrumented SDK coverage suite.
// The separate ssh-terminal.spec.js verifies the real SSH transport and emulator.
function terminalCoverageSupport() {
  return `;(() => {
    const sdk = require('@anikitenko/fdo-sdk');
    sdk.PluginRegistry.registerHandler('__e2e.configureTerminal', () => {
      sdk.SSHClient.prototype.openTerminal = async (_options, signal) => {
        let finish;
        const result = new Promise(resolve => {finish = () => resolve({reason:'exited',exitCode:0,signal:null,remoteProcessStopped:true});});
        signal.addEventListener('abort', finish, {once:true});
        return {result, output: (async function* () {
          yield {sequence:0,data:new TextEncoder().encode('Coverage terminal ready\\r\\n')};
          await result;
        })(), write:async()=>{}, resize:async()=>{}, endInput:async()=>{finish();}, close:async()=>{finish();}};
      };
      return {ok:true};
    });
  })();`;
}
async function runTerminalCoverage(window, pluginId, invoke, expect) {
  const records = [];
  const call = async (name, payload, ok = true) => {
    const response = await invoke(window, pluginId, 'terminal.' + name, payload);
    expect(response.ok, JSON.stringify(response)).toBe(ok);
    records.push({handler:'terminal.' + name, ok:response.ok});
    return response.result?.data;
  };
  await call('poll', {id:'missing'}, false);
  await call('open', {profileId:0, mode:'off'}, false);
  await call('open', null, false);
  const opened = await call('open', {profileId:'fixture', mode:'untrusted'});
  await call('open', {profileId:'fixture', mode:'off'}, false);
  await expect.poll(() => call('poll', {id:opened.id})).toMatchObject({ready:true});
  await call('input', {id:opened.id, text:'echo fixture\r'});
  await call('input', {id:opened.id, text:42}, false);
  await call('resize', {id:opened.id, rows:30, columns:90});
  await call('poll', {id:opened.id, ack:0});
  await call('eof', {id:opened.id});
  await call('cancel', {id:opened.id});
  await call('close', {id:opened.id});
  const frame = window.frameLocator(`iframe[data-plugin-id="${pluginId}"]`);
  await frame.locator('#terminal-profile').fill('fixture');
  await frame.locator('#terminal-open').click();
  await expect(frame.locator('#terminal-status')).toContainText('Interactive shell.');
  await expect(frame.locator('#terminal-screen')).toContainText('Coverage terminal ready');
  await frame.locator('.xterm-helper-textarea').fill('echo UI');
  await frame.locator('#terminal-close').click();
  return records;
}
module.exports = {terminalCoverageSupport, runTerminalCoverage};
