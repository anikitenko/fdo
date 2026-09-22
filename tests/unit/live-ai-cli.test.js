const {parseLiveAiCli} = require('../../scripts/lib/live-ai-cli.cjs');
const {readLiveAiConfig} = require('../../scripts/lib/live-ai-config.cjs');

const baseEnv = {FDO_TEST_AI_PROVIDER: 'ollama', FDO_TEST_AI_MODEL: 'local'};

test.each([undefined, '12', '20', 'auto'])('standard command selects automatic budgeting with inherited limit %s', limit => {
    const env = {...baseEnv, FDO_TEST_AI_MAX_REQUESTS: limit};
    const cli = parseLiveAiCli(['--grep', 'Web Tools Workbench'], env);
    expect(cli.args).toEqual(['--grep', 'Web Tools Workbench']);
    expect(cli.grep).toBe('Web Tools Workbench');
    expect(cli.env.FDO_TEST_AI_MAX_REQUESTS).toBe('auto');
    expect(readLiveAiConfig(cli.env)).toMatchObject({requestBudgetMode: 'adaptive', limit: 50});
    expect(env.FDO_TEST_AI_MAX_REQUESTS).toBe(limit);
    expect(cli.ignoredInheritedLimit).toBe(Boolean(limit && limit !== 'auto'));
});

test('explicit CLI cap reaches provider configuration without being passed to Playwright', () => {
    const cli = parseLiveAiCli(['--max-requests', '7', '--grep', 'Web Tools Workbench', '--list'], baseEnv);
    expect(cli.args).toEqual(['--grep', 'Web Tools Workbench', '--list']);
    expect(readLiveAiConfig(cli.env)).toMatchObject({requestBudgetMode: 'fixed', limit: 7});
    expect(cli.env.FDO_TEST_AI_MAX_REQUESTS).toBe('7');
});

test('an environment ceiling bounds the explicit CLI cap and reaches the child run', () => {
    const env = {...baseEnv, FDO_TEST_AI_REQUEST_CEILING: '80'};
    const cli = parseLiveAiCli(['--max-requests', '65'], env);
    expect(cli.env).toMatchObject({FDO_TEST_AI_MAX_REQUESTS: '65', FDO_TEST_AI_REQUEST_CEILING: '80'});
    expect(readLiveAiConfig(cli.env)).toMatchObject({requestBudgetMode: 'fixed', limit: 65});
    // 65 is only valid because the ceiling was raised; the default would reject it.
    expect(() => parseLiveAiCli(['--max-requests', '65'], baseEnv)).toThrow('integer from 1 to 50');
    expect(() => parseLiveAiCli(['--max-requests', '81'], env)).toThrow('integer from 1 to 80');
    expect(() => parseLiveAiCli(['--bogus'], env)).toThrow('--max-requests <auto|1–80>');
});

test.each([
    ['--max-requests', '51'], ['--max-requests', '0'], ['--max-requests', '2.5'],
    ['--max-requests'], ['--max-requests', '5', '--max-requests', '6'],
    ['--timeout', '9999999'], ['--retries', '5'], ['--grep'],
])('rejects invalid options %j before any provider work', (...args) => {
    expect(() => parseLiveAiCli(args, baseEnv)).toThrow();
});
