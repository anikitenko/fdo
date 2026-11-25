// Use the same executable and compatibility checks as the desktop application.
module.exports = async function localCodexProbe() {
    const compiled = require('esbuild').buildSync({entryPoints: [require.resolve('../src/utils/ai/codex/codexCli.js')],
        bundle: true, write: false, platform: 'node', format: 'cjs'});
    const probe = {exports:{}};
    new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(require, probe, probe.exports);
    return probe.exports.resolveCodexCliInvocation({configuredPath:process.env.FDO_TEST_CODEX_PATH});
};
