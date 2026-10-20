/** @jest-environment node */
import {runFdoCli} from '../../src/utils/system/fdoCli';

function fixture(overrides = {}) {
    const stdout = {write: jest.fn()}, stderr = {write: jest.fn()}, output = {log: jest.fn(), error: jest.fn()};
    const dependencies = {version: '1.0.0', compile: jest.fn(async () => ({destination: '/plugin/dist/index.cjs'})), sign: jest.fn(), deploy: jest.fn(), listCertificates: jest.fn(() => []), stdout, stderr, output, stdin: {isTTY: false}, ...overrides};
    return {dependencies, stdout, stderr, output};
}
test.each([['--help'], ['compile', '--help'], ['open', '--help'], ['sign'], ['sdk'], ['--version'], []])('help/version %j exits without GUI', async (...args) => {
    // test.each spreads rows as arguments; each row is one complete argv.
    const f = fixture();
    expect(await runFdoCli(args, f.dependencies)).toEqual({exitCode: 0, openGui: false});
    expect(f.dependencies.compile).not.toHaveBeenCalled();
    expect(f.stdout.write).toHaveBeenCalled();
});
test('successful compile is awaited and reports its output', async () => {
    const f = fixture();
    expect(await runFdoCli(['compile', '.'], f.dependencies)).toEqual({exitCode: 0, openGui: false});
    expect(f.dependencies.compile).toHaveBeenCalledTimes(1);
    expect(f.output.log).toHaveBeenCalledWith('Compiled plugin: /plugin/dist/index.cjs');
});
test('compiler and deployment errors are nonzero and never print success', async () => {
    for (const command of ['compile', 'deploy']) {
        const f = fixture({[command]: jest.fn(async () => {throw new Error('disk unavailable');})});
        expect((await runFdoCli([command, '.'], f.dependencies)).exitCode).toBe(1);
        expect(f.output.error).toHaveBeenCalledWith('Error: disk unavailable');
        expect(f.output.log).not.toHaveBeenCalled();
    }
});
test.each([['compiel'], ['--unknown'], ['compile'], ['compile', '.', '--unknown'], ['open', 'extra']])('invalid arguments %j never open UI or run a command', async (...args) => {
    const f = fixture();
    const result = await runFdoCli(args, f.dependencies);
    expect(result.exitCode).not.toBe(0); expect(result.openGui).toBe(false);
    expect(f.dependencies.compile).not.toHaveBeenCalled();
});
test('open is the sole GUI command', async () => {
    expect(await runFdoCli(['open'], fixture().dependencies)).toEqual({exitCode: 0, openGui: true});
});
test('SDK migration retains validation exit codes and refuses unattended writes', async () => {
    const f = fixture({migrate: jest.fn(async () => {throw Object.assign(new Error('missing target'), {code: 'SDK_MIGRATE_INVALID_TARGET'});})});
    expect((await runFdoCli(['sdk', 'migrate', '--target', '.'], f.dependencies)).exitCode).toBe(2);
    f.dependencies.migrate.mockClear();
    expect((await runFdoCli(['sdk', 'migrate', '--target', '.', '--write'], f.dependencies)).exitCode).toBe(2);
    expect(f.dependencies.migrate).not.toHaveBeenCalled();
    const wrapped = fixture({stdin: {isTTY: true}, stdout: {write: jest.fn(), isTTY: false}});
    expect((await runFdoCli(['sdk', 'migrate', '--target', '.', '--write'], wrapped.dependencies)).exitCode).toBe(2);
});
test('missing migration target from the real SDK helper exits 2', async () => {
    const f = fixture();
    expect((await runFdoCli(['sdk', 'migrate', '--target', '/__missing_fdo_sdk_migrate_target__'], f.dependencies)).exitCode).toBe(2);
});
test('SDK migration validation status survives wrapped and property-stripped errors', async () => {
    const original = Object.assign(new Error('Target path does not exist: C:\\\\missing'), {code: 'SDK_MIGRATE_INVALID_TARGET', exitCode: 2});
    const wrapped = Object.assign(new Error(original.message), {code: 'commander.error', exitCode: 1, nestedError: original});
    expect((await runFdoCli(['sdk', 'migrate', '--target', '.'], fixture({migrate: async () => {throw wrapped;}}).dependencies)).exitCode).toBe(2);
    expect((await runFdoCli(['sdk', 'migrate', '--target', '.'], fixture({migrate: async () => {throw new Error('Target path does not exist: C:\\\\missing');}}).dependencies)).exitCode).toBe(2);
});

test.each([['--json', 'compile', '.'], ['compile', '.', '--json']])('JSON results are parseable with global options in either position: %j', async (...args) => {
    const f = fixture();
    expect((await runFdoCli(args, f.dependencies)).exitCode).toBe(0);
    expect(JSON.parse(f.stdout.write.mock.calls.map(([text]) => text).join(''))).toEqual({ok: true, command: 'compile', data: {destination: '/plugin/dist/index.cjs'}});
    expect(f.output.log).not.toHaveBeenCalled();
});
test('JSON errors preserve exit status and human diagnostics go to stderr', async () => {
    const f = fixture({compile: async () => {throw new Error('build failed');}});
    expect((await runFdoCli(['compile', '.', '--json'], f.dependencies)).exitCode).toBe(1);
    expect(JSON.parse(f.stdout.write.mock.calls[0][0])).toMatchObject({ok: false, error: {message: 'build failed'}});
    expect(f.output.error).toHaveBeenCalledWith('Error: build failed');
});
test('doctor reports actionable findings and nonzero status in JSON', async () => {
    const data = {healthy: false, checks: [{id: 'signing', status: 'warning', message: 'Missing root', fix: 'Sign a plugin'}]};
    const f = fixture({doctor: jest.fn(async () => data)});
    expect((await runFdoCli(['doctor', '--json'], f.dependencies)).exitCode).toBe(1);
    expect(JSON.parse(f.stdout.write.mock.calls[0][0])).toEqual({ok: false, command: 'doctor', data});
});
test('plugin inspection accepts IDs and lists empty installations', async () => {
    const f = fixture({inspectPlugins: jest.fn(async () => [])});
    expect((await runFdoCli(['plugins', 'list'], f.dependencies)).exitCode).toBe(0);
    expect(f.output.log).toHaveBeenCalledWith('No plugins installed.');
    f.dependencies.inspectPlugins.mockRejectedValue(new Error('Plugin not found: missing'));
    expect((await runFdoCli(['plugins', 'info', 'missing', '--json'], f.dependencies)).exitCode).toBe(1);
    expect(f.dependencies.inspectPlugins).toHaveBeenLastCalledWith('missing');
});
test('certificate JSON never exports certificate or private key material', async () => {
    const f = fixture({listCertificates: () => [{id: 'root-id', label: 'root', hasPrivateKey: true, key: 'secret', cert: 'PEM'}]});
    await runFdoCli(['sign', 'list', '--json'], f.dependencies);
    expect(JSON.parse(f.stdout.write.mock.calls[0][0]).data).toEqual([{id: 'root-id', label: 'root', hasPrivateKey: true}]);
});
test('JSON argument errors remain parseable and preserve Commander diagnostics', async () => {
    const f = fixture();
    expect((await runFdoCli(['plugins', 'info', '--json'], f.dependencies)).exitCode).toBe(1);
    expect(JSON.parse(f.stdout.write.mock.calls.map(([text]) => text).join(''))).toMatchObject({ok: false, error: {code: 'commander.missingArgument'}});
    expect(f.stderr.write).toHaveBeenCalled();
});
test('validate and deployment preview support JSON without invoking mutating commands', async () => {
    const data = {name: 'fixture', metadata: {version: '1.0.0'}, warnings: []};
    const f = fixture({validate: jest.fn(async () => data), planDeployment: jest.fn(async () => ({dryRun: true, plugin: data}))});
    expect((await runFdoCli(['validate', '.', '--json'], f.dependencies)).exitCode).toBe(0);
    expect(JSON.parse(f.stdout.write.mock.calls[0][0])).toMatchObject({command: 'validate', data});
    f.stdout.write.mockClear();
    expect((await runFdoCli(['deploy', '.', '--dry-run', '--label', 'custom', '--json'], f.dependencies)).exitCode).toBe(0);
    expect(f.dependencies.planDeployment).toHaveBeenCalledWith(expect.any(String), 'custom');
    expect(JSON.parse(f.stdout.write.mock.calls[0][0])).toMatchObject({command: 'deploy', data: {dryRun: true}});
    expect(f.dependencies.deploy).not.toHaveBeenCalled(); expect(f.dependencies.compile).not.toHaveBeenCalled(); expect(f.dependencies.sign).not.toHaveBeenCalled();
});
test('dev awaits the watch session, forwards signing label and rejects JSON before starting', async () => {
    const f = fixture({dev: jest.fn(async () => ({builds: 1, failures: 0}))});
    expect(await runFdoCli(['dev', '.', '--label', 'custom'], f.dependencies)).toEqual({exitCode: 0, openGui: false});
    expect(f.dependencies.dev).toHaveBeenCalledWith(expect.any(String), 'custom');
    f.dependencies.dev.mockClear();
    expect((await runFdoCli(['dev', '.', '--json'], f.dependencies)).exitCode).toBe(1);
    expect(f.dependencies.dev).not.toHaveBeenCalled();
});
test('completion writes scripts directly and rejects unsupported shells or JSON', async () => {
    const f = fixture();
    expect((await runFdoCli(['completion', 'bash'], f.dependencies)).exitCode).toBe(0);
    expect(f.stdout.write).toHaveBeenCalledWith(expect.stringContaining('complete -o filenames -F _fdo fdo'));
    expect((await runFdoCli(['completion', 'unknown'], f.dependencies)).exitCode).toBe(1);
    expect((await runFdoCli(['completion', 'bash', '--json'], f.dependencies)).exitCode).toBe(1);
});
test('a misplaced profile option fails before executing a mutating command', async () => {
    const f = fixture();
    expect((await runFdoCli(['compile', '.', '--profile', 'qa'], f.dependencies)).exitCode).toBe(1);
    expect(f.dependencies.compile).not.toHaveBeenCalled();
});
test('signature verification has strict statuses and structured results', async () => {
    const f = fixture({inspectPlugins: jest.fn(async () => [{id: 'fixture', version: '1.0.0', signature: {status: 'valid'}}])});
    expect((await runFdoCli(['plugins', 'verify', 'fixture', '--json'], f.dependencies)).exitCode).toBe(0);
    expect(f.dependencies.inspectPlugins).toHaveBeenLastCalledWith('fixture');
    expect(JSON.parse(f.stdout.write.mock.calls[0][0])).toMatchObject({ok: true, command: 'plugins verify', data: {valid: true, checked: 1}});
    f.stdout.write.mockClear();
    f.dependencies.inspectPlugins.mockResolvedValue([{id: 'fixture', signature: {status: 'invalid', error: 'tampered'}}]);
    expect((await runFdoCli(['plugins', 'verify', '--json'], f.dependencies)).exitCode).toBe(1);
    expect(JSON.parse(f.stdout.write.mock.calls[0][0])).toMatchObject({ok: false, data: {valid: false, checked: 1}});
    f.dependencies.inspectPlugins.mockResolvedValue([]);
    expect((await runFdoCli(['plugins', 'verify'], f.dependencies)).exitCode).toBe(1);
    expect(f.output.log).toHaveBeenCalledWith('No installed plugins to verify.');
});
test('workspace test outcomes, empty suites and invalid timeouts return useful statuses', async () => {
    const f = fixture({test: jest.fn(async () => ({success: true, skipped: false, output: '2 passed'}))});
    expect((await runFdoCli(['test', '.', '--timeout', '5', '--json'], f.dependencies)).exitCode).toBe(0);
    expect(f.dependencies.test).toHaveBeenCalledWith(expect.any(String), 5000);
    expect(JSON.parse(f.stdout.write.mock.calls[0][0])).toMatchObject({ok: true, command: 'test'});
    for (const result of [{success: false}, {success: true, skipped: true}]) {
        f.dependencies.test.mockResolvedValue(result);
        expect((await runFdoCli(['test', '.'], f.dependencies)).exitCode).toBe(1);
    }
    f.dependencies.test.mockClear();
    expect((await runFdoCli(['test', '.', '--timeout', '0'], f.dependencies)).exitCode).toBe(1);expect(f.dependencies.test).not.toHaveBeenCalled();
});
test('profile listing and log commands expose JSON and refuse JSON streaming', async () => {
    const f = fixture({listProfiles: async () => [{name: 'default', directory: '/profile', pluginCount: 0, current: true}], logs: jest.fn(async () => ({pluginId: 'one', logs: []})), followLogs: jest.fn()});
    expect((await runFdoCli(['profiles', 'list', '--json'], f.dependencies)).exitCode).toBe(0);
    expect(JSON.parse(f.stdout.write.mock.calls[0][0]).data[0].current).toBe(true);
    expect((await runFdoCli(['plugins', 'logs', 'one', '--lines', '2'], f.dependencies)).exitCode).toBe(0);
    expect(f.dependencies.logs).toHaveBeenCalledWith('one', 2);
    expect((await runFdoCli(['plugins', 'logs', 'one', '--follow', '--json'], f.dependencies)).exitCode).toBe(1);expect(f.dependencies.followLogs).not.toHaveBeenCalled();
    expect((await runFdoCli(['plugins', 'logs', 'one', '--lines', '-1'], f.dependencies)).exitCode).toBe(1);
});
