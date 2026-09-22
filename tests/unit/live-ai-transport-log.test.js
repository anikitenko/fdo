const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {sanitizeTransportLine, summarizeProtocolLine, runLivePlaywright} = require("../../scripts/lib/run-live-playwright.cjs");

test("keeps the websocket close code and reason", () => {
    expect(sanitizeTransportLine("pw:browser <ws disconnected> ws://127.0.0.1:1234/devtools/browser/id code=1006 reason=reset"))
        .toContain("code=1006 reason=reset");
});
test("omits protocol contents while preserving a Playwright callback exception", () => {
    const line = 'pw:browser <closing ws> Closing websocket due to failed onmessage callback. eventData={"prompt":"private e= payload","key":"test-secret"} e=Unknown context';
    const safe = sanitizeTransportLine(line, ["test-secret"]);
    expect(safe).toContain("e=Unknown context");
    expect(safe).not.toContain("private");
    expect(summarizeProtocolLine('pw:protocol SEND ► {"id":7,"method":"Runtime.evaluate"} +12ms')).toContain('"method":"Runtime.evaluate"');
    expect(safe).not.toContain("test-secret");
});
test("ignores provider output and redacts configured secrets in transport errors", () => {
    expect(sanitizeTransportLine("pw:browser [pid=1][out] Generated private code")).toBeNull();
    expect(sanitizeTransportLine("pw:browser <ws error> secret-value", ["secret-value"])).not.toContain("secret-value");
});
test("retains native Chromium socket errors but excludes renderer console output", () => {
    const prefix = "pw:browser [pid=123][err] ";
    expect(sanitizeTransportLine(`${prefix}[123:0919:ERROR:net/server/http_connection.cc:83] Too large read buffer`))
        .toContain("Too large read buffer");
    expect(sanitizeTransportLine(`${prefix}[123:0919:ERROR:CONSOLE:1] private response`)).toBeNull();
    expect(sanitizeTransportLine(`${prefix}provider failure: private prompt`)).toBeNull();
});
test("protocol diagnostics contain only structural metadata", () => {
    const safe = summarizeProtocolLine('pw:protocol SEND ► {"id":7,"method":"Runtime.evaluate","params":{"expression":"private prompt"}}');
    expect(safe).toContain('"method":"Runtime.evaluate"');
    expect(safe).toContain('"id":7');
    expect(safe).not.toContain("private");
    expect(summarizeProtocolLine('pw:protocol ◀ RECV {"id":7,"error":{"code":-32000,"message":"private response"}}'))
        .not.toContain("private");
    expect(summarizeProtocolLine('pw:protocol ◀ RECV {"result":"private <<<<<( LOG TRUNCATED )>>>>>')).toContain('"truncated":true');
});
test("records split transport lines without changing a failing child exit status", async () => {
    const artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), "fdo-transport-log-"));
    try {
        const code = `
          process.stderr.write('pw:browser <ws dis');
          setTimeout(() => {
            process.stderr.write('connected> code=1006 reason=test-secret\\n');
            process.stderr.write('pw:browser [pid=1][out] private-provider-response\\n');
            process.exitCode = process.env.DEBUG === 'pw:browser,pw:protocol' ? 7 : 8;
          }, 10);
        `;
        const result = await runLivePlaywright(["-e", code], {artifactDir, env: {...process.env, FDO_TEST_AI_API_KEY: "test-secret"}});
        expect(result.status).toBe(7);
        const log = fs.readFileSync(path.join(artifactDir, "playwright-transport.log"), "utf8");
        expect(log).toContain("code=1006 reason=[REDACTED]");
        expect(log).not.toContain("private-provider-response");
    } finally { fs.rmSync(artifactDir, {recursive: true, force: true}); }
});
test("default protocol tracing never forwards raw protocol payloads", async () => {
    const artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), "fdo-protocol-log-"));
    const stderr = jest.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
        const code = `
          process.stderr.write('pw:protocol SEND ► {"id":1,"method":"Runtime.evaluate","params":{"expression":"private-prompt"}}\\n');
          process.stderr.write('pw:protocol malformed private-response\\n');
          process.exitCode = process.env.DEBUG === 'pw:browser,pw:protocol' && process.env.ELECTRON_ENABLE_LOGGING === '1' ? 0 : 1;
        `;
        const result = await runLivePlaywright(["-e", code], {artifactDir, env: {...process.env, FDO_E2E_LIVE_AI_PROTOCOL_DIAGNOSTICS: undefined}});
        expect(result.status).toBe(0);
        const log = fs.readFileSync(path.join(artifactDir, "playwright-transport.log"), "utf8");
        expect(log).toContain("Runtime.evaluate");
        expect(log).not.toContain("private-");
        expect(stderr).not.toHaveBeenCalled();
    } finally { stderr.mockRestore(); fs.rmSync(artifactDir, {recursive: true, force: true}); }
});

test('protocol bursts cannot evict the connection lifecycle', async () => {
    const artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fdo-protocol-ring-'));
    try {
        const code = `
          process.stderr.write('pw:browser <ws connected> local-browser\\n');
          for (let id = 0; id < 300; id++) process.stderr.write('pw:protocol SEND ► ' + JSON.stringify({id, method: 'Runtime.evaluate', params: {expression: 'private-code'}}) + '\\n');
          process.stderr.write('pw:browser <ws disconnected> code=1006\\n');
        `;
        await runLivePlaywright(['-e', code], {artifactDir, env: {...process.env, FDO_E2E_LIVE_AI_PROTOCOL_DIAGNOSTICS: undefined}});
        const log = fs.readFileSync(path.join(artifactDir, 'playwright-transport.log'), 'utf8');
        expect(log).toContain('<ws connected>');
        expect(log).toContain('code=1006');
        expect(log.trim().split('\n')).toHaveLength(152);
        expect(log).not.toContain('private-code');
    } finally { fs.rmSync(artifactDir, {recursive: true, force: true}); }
});

test('explicitly disabling protocol diagnostics preserves lifecycle capture', async () => {
    const artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fdo-protocol-disabled-'));
    try {
        const code = `
          process.stderr.write('pw:browser <ws connected> local-browser\\n');
          process.stderr.write('pw:protocol SEND ► {"id":1,"method":"Runtime.evaluate","params":{"expression":"private"}}\\n');
          process.exitCode = process.env.DEBUG === 'pw:browser' ? 0 : 9;
        `;
        const result = await runLivePlaywright(['-e', code], {artifactDir, env: {...process.env, FDO_E2E_LIVE_AI_PROTOCOL_DIAGNOSTICS: '0'}});
        expect(result.status).toBe(0);
        const log = fs.readFileSync(path.join(artifactDir, 'playwright-transport.log'), 'utf8');
        expect(log).toContain('<ws connected>');
        expect(log).not.toContain('Runtime.evaluate');
        expect(log).not.toContain('private');
    } finally { fs.rmSync(artifactDir, {recursive: true, force: true}); }
});
