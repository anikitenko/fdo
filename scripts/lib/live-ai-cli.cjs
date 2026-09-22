const {liveAiBudgetPolicy, liveAiRequestCeiling} = require('../../src/utils/liveAiTestPolicy.cjs');

function parseLiveAiCli(argv, env = process.env) {
    const args = [];
    const ceiling = liveAiRequestCeiling(env);
    let requestLimit = 'auto';
    let explicitLimit = false;
    let grep = '';
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--list') {
            args.push(arg);
        } else if (arg === '--grep' && argv[i + 1]) {
            grep = argv[++i];
            args.push(arg, grep);
        } else if (arg === '--max-requests' && argv[i + 1] && !explicitLimit) {
            requestLimit = argv[++i];
            explicitLimit = true;
        } else {
            throw new Error(`Supported options: --list, --grep <pattern>, --max-requests <auto|1–${ceiling}>.`);
        }
    }
    // The standard npm command always starts in automatic mode. Fixed caps
    // require a command-line choice so old shell exports cannot pin the run.
    // The environment's ceiling still bounds an explicit cap.
    const policy = liveAiBudgetPolicy({
        FDO_TEST_AI_REQUEST_CEILING: env.FDO_TEST_AI_REQUEST_CEILING,
        FDO_TEST_AI_MAX_REQUESTS: requestLimit,
    });
    return {args, grep, env: {...env, FDO_TEST_AI_MAX_REQUESTS: policy.envValue},
        ignoredInheritedLimit: !explicitLimit && Boolean(env.FDO_TEST_AI_MAX_REQUESTS)
            && env.FDO_TEST_AI_MAX_REQUESTS !== 'auto'};
}

module.exports = {parseLiveAiCli};
