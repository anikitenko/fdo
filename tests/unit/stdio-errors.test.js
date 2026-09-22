const {EventEmitter} = require("node:events");
const {spawn} = require("node:child_process");
const {installStdioErrorHandlers} = require("../../src/utils/stdioErrors.cjs");

test("handles only broken output pipes and installs once per stream", () => {
    const stream = new EventEmitter();
    installStdioErrorHandlers([stream]);
    installStdioErrorHandlers([stream]);
    expect(stream.listenerCount("error")).toBe(1);
    expect(() => stream.emit("error", Object.assign(new Error("closed"), {code: "EPIPE"}))).not.toThrow();
    const unexpected = Object.assign(new Error("disk failed"), {code: "EIO"});
    expect(() => stream.emit("error", unexpected)).toThrow(unexpected);
});

test.each(["stdout", "stderr"])("a real closed %s pipe does not crash continued console logging", async stream => {
    const guardPath = require.resolve("../../src/utils/stdioErrors.cjs");
    const child = spawn(process.execPath, ["-e", `
        require(${JSON.stringify(guardPath)}).installStdioErrorHandlers();
        process.send('ready');
        process.on('message', () => {
            for (let i = 0; i < 20; i++) {
                process[${JSON.stringify(stream)}].write('diagnostic output\\n');
                console[${JSON.stringify(stream === "stderr" ? "error" : "log")}]('console output');
            }
            setTimeout(() => { process.send('survived'); process.disconnect(); }, 50);
        });
    `], {stdio: ["ignore", "pipe", "pipe", "ipc"]});
    const messages = [];
    const outcome = new Promise((resolve, reject) => {
        child.on("error", reject);
        child.on("message", message => {
            messages.push(message);
            if (message === "ready") {
                child[stream].destroy();
                child.send("write");
            }
        });
        child.on("exit", (code, signal) => resolve({code, signal}));
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
    try {
        expect(await outcome).toEqual({code: 0, signal: null});
        expect(messages).toContain("survived");
    } finally { clearTimeout(timer); child.kill(); }
});
