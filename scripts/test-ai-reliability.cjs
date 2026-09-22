const {preflightLiveAi} = require("./lib/live-ai-config.cjs");
const fs = require("node:fs");
const path = require("node:path");
const {spawnSync} = require("node:child_process");
const {createReliabilityPlan, summarizeReliabilityRun, summarizeReliability} = require("./lib/live-ai-reliability.cjs");
const {runLivePlaywright} = require("./lib/run-live-playwright.cjs");

async function main() {
    const options = {repeat: 3, grep: "Web Tools Workbench"};
    const args = process.argv.slice(2);
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (arg === "--dry-run") { options.dryRun = true; continue; }
        if (!["--matrix", "--repeat", "--grep"].includes(arg) || !args[index + 1] || args[index + 1].startsWith("--")) {
            throw new Error("Supported arguments: --matrix <json-file>, --repeat <1..10>, --grep <scenario>, --dry-run.");
        }
        options[arg.slice(2)] = arg === "--repeat" ? Number(args[++index]) : args[++index];
    }
    const entries = options.matrix ? JSON.parse(fs.readFileSync(options.matrix, "utf8")) : [{
        provider: process.env.FDO_TEST_AI_PROVIDER || "openai", modelEnv: "FDO_TEST_AI_MODEL", apiKeyEnv: "FDO_TEST_AI_API_KEY",
    }];
    const plan = createReliabilityPlan(entries, {repeat: options.repeat});
    console.log(JSON.stringify({grep: options.grep, runs: plan, maximumProviderRequests: plan.reduce((sum, run) => sum + run.requestLimit, 0)}, null, 2));
    if (options.dryRun) return 0;
    for (const run of plan) {
        if (run.provider !== "ollama" && !process.env[run.apiKeyEnv]?.trim()) throw new Error(`Missing test credential environment variable ${run.apiKeyEnv}. No personal credential fallback.`);
    }
    for (const run of plan) await preflightLiveAi({...run, apiKey: run.apiKeyEnv ? process.env[run.apiKeyEnv] : ""}, options.grep);
    const root = path.resolve("artifacts/live-ai/reliability", `${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}`);
    fs.mkdirSync(root, {recursive: true});
    fs.writeFileSync(path.join(root, "plan.json"), JSON.stringify({grep: options.grep, runs: plan}, null, 2));
    const build = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"], {stdio: "inherit", env: process.env});
    if (build.error || build.status !== 0) throw new Error("Build failed; no live requests were dispatched.");
    const runs = [];
    for (const run of plan) {
        const artifactDir = path.join(root, run.id);
        const outputFile = path.join(artifactDir, "outcome.json");
        console.log(`Reliability run: ${run.id} (${run.model})`);
        const child = await runLivePlaywright([require.resolve("@playwright/test/cli"), "test",
            "--config=playwright.live-ai.config.js", "--grep", options.grep], {
            artifactDir, env: {...process.env,
                FDO_E2E_LIVE_AI: "1", FDO_E2E_KEEP_USER_DATA: "0",
                FDO_TEST_AI_PROVIDER: run.provider, FDO_TEST_AI_MODEL: run.model,
                FDO_TEST_AI_API_KEY: run.provider === "ollama" ? "" : process.env[run.apiKeyEnv],
                FDO_TEST_AI_ACCOUNT_ID: run.accountId,
                FDO_TEST_AI_FIRST_RESPONSE_TIMEOUT_MS: String(run.firstResponseTimeoutMs),
                FDO_TEST_AI_THINKING_MODE: run.defaultThinkingMode,
                FDO_TEST_AI_BASE_URL: run.baseUrl, FDO_TEST_AI_CONTEXT_LENGTH: run.contextLength ? String(run.contextLength) : undefined, FDO_TEST_AI_MAX_REQUESTS: run.requestBudgetMode === "adaptive" ? "auto" : String(run.requestLimit),
                FDO_E2E_LIVE_AI_ARTIFACT_DIR: artifactDir,
                FDO_E2E_LIVE_AI_OUTPUT_DIR: path.join(artifactDir, "test-results"),
                FDO_E2E_LIVE_AI_SUMMARY_FILE: outputFile,
            },
        });
        let report = null;
        try { report = JSON.parse(fs.readFileSync(outputFile, "utf8")); } catch (_) {}
        runs.push(summarizeReliabilityRun(run, {exitCode: child.status, signal: child.signal, report, artifactDir}));
        const summaryPath = path.join(root, "summary.json");
        fs.writeFileSync(summaryPath, JSON.stringify({...summarizeReliability(runs),
            passed: runs.length === plan.length && runs.every(result => result.passed),
            complete: runs.length === plan.length, plannedRuns: plan.length}, null, 2));
        console.log(`Reliability summary: ${summaryPath}`);
        if (child.signal || child.error) break;
    }
    return runs.length === plan.length && runs.every(run => run.passed) ? 0 : 1;
}

main().then(code => { process.exitCode = code; }).catch(error => { console.error(error.message); process.exitCode = 1; });
