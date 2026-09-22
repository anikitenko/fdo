const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {createReliabilityPlan, summarizeReliabilityRun, summarizeReliability} = require("../../scripts/lib/live-ai-reliability.cjs");
const Reporter = require("../e2e/helpers/liveAiSummaryReporter.cjs");
const entries = [{provider: "openai", model: "model-a", apiKeyEnv: "TEST_OPENAI_KEY"},
    {provider: "anthropic", modelEnv: "TEST_ANTHROPIC_MODEL", apiKeyEnv: "TEST_ANTHROPIC_KEY"}];
const env = {TEST_ANTHROPIC_MODEL: "model-b", TEST_OPENAI_KEY: "secret-never-print"};
const run = {id: "01-openai-run-1", provider: "openai", model: "model-a", requestLimit: 2};
const passedReport = {status: "passed", plannedTests: 1, durationMs: 100,
    tests: [{status: "passed", expectedStatus: "passed"}]};

test("matrix repetitions have unique artifact identities and contain no credentials", () => {
    const plan = createReliabilityPlan(entries, {env, repeat: 3, requestLimit: 2});
    expect(plan).toHaveLength(6);
    expect(new Set(plan.map(run => run.id)).size).toBe(6);
    expect(plan[3]).toMatchObject({provider: "anthropic", model: "model-b", requestLimit: 2});
    expect(JSON.stringify(plan)).not.toContain("secret-never-print");
});

test.each([0, 11, 1.5, NaN])("rejects unbounded or invalid repeat %s", repeat => {
    expect(() => createReliabilityPlan(entries, {env, repeat})).toThrow("Repeat");
});
test.each([0, 51, NaN])("rejects invalid request limit %s", requestLimit => {
    expect(() => createReliabilityPlan(entries, {env, requestLimit})).toThrow("Request limit");
});
test("rejects oversize matrices, unsupported providers and embedded secrets before execution", () => {
    expect(() => createReliabilityPlan(Array(11).fill(entries[0]))).toThrow("30 total runs");
    expect(() => createReliabilityPlan([{provider: "unknown", model: "x"}])).toThrow("supports");
    expect(() => createReliabilityPlan([{...entries[0], apiKey: "secret"}])).toThrow("environment variables");
    expect(() => createReliabilityPlan([entries[1]], {env: {}})).toThrow("Missing model");
});

test.each([
    null,
    {...passedReport, plannedTests: 0, tests: []},
    {...passedReport, plannedTests: 2},
    {...passedReport, status: "failed"},
    {...passedReport, tests: [{status: "skipped", expectedStatus: "skipped"}]},
    {...passedReport, tests: [{status: "failed", expectedStatus: "failed"}]},
])("missing, skipped, incomplete and expected-failure runs cannot count as reliable: %j", report => {
    expect(summarizeReliabilityRun(run, {exitCode: 0, report, artifactDir: "/tmp/run"}).passed).toBe(false);
});
test("a terminated process cannot pass using an existing result", () => {
    expect(summarizeReliabilityRun(run, {exitCode: null, signal: "SIGTERM", report: passedReport, artifactDir: "/tmp/run"}).passed).toBe(false);
});
test("aggregates pass rates and durations separately by provider and model", () => {
    const good = summarizeReliabilityRun(run, {exitCode: 0, report: passedReport, artifactDir: "/tmp/run"});
    const report = summarizeReliability([good, {...good, passed: false, durationMs: 200}, {...good, model: "model-b"}]);
    expect(report.passed).toBe(false);
    expect(report.groups).toEqual([
        {provider: "openai", model: "model-a", runs: 2, passed: 1, passRate: 0.5, medianDurationMs: 150, maxDurationMs: 200},
        {provider: "openai", model: "model-b", runs: 1, passed: 1, passRate: 1, medianDurationMs: 100, maxDurationMs: 100},
    ]);
    expect(summarizeReliability([]).passed).toBe(false);
});
test("reporter retains a closed-page failure without including response content", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "fdo-reliability-"));
    try {
        const outputFile = path.join(directory, "outcome.json");
        const reporter = new Reporter({outputFile});
        reporter.onBegin({}, {allTests: () => [1]});
        reporter.onTestEnd({title: "scenario", expectedStatus: "passed"}, {status: "failed", duration: 100, error: {message: "sensitive-response"}});
        reporter.onEnd({status: "failed", duration: 120});
        const serialized = fs.readFileSync(outputFile, "utf8");
        expect(JSON.parse(serialized)).toMatchObject({status: "failed", plannedTests: 1, tests: [{status: "failed"}]});
        expect(serialized).not.toContain("sensitive-response");
    } finally { fs.rmSync(directory, {recursive: true, force: true}); }
});
