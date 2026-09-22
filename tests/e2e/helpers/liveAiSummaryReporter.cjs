const fs = require("node:fs");
const path = require("node:path");

// Only outcome metadata is included. Prompts, responses and credentials stay
// out of the aggregate report; detailed evidence remains in each run folder.
class LiveAiSummaryReporter {
    constructor({outputFile}) { this.outputFile = outputFile; this.tests = []; }
    onBegin(_config, suite) { this.plannedTests = suite.allTests().length; }
    onTestEnd(test, result) {
        this.tests.push({title: test.title, status: result.status, expectedStatus: test.expectedStatus, durationMs: result.duration});
    }
    onEnd(result) {
        fs.mkdirSync(path.dirname(this.outputFile), {recursive: true});
        fs.writeFileSync(this.outputFile, JSON.stringify({status: result.status, durationMs: result.duration,
            plannedTests: this.plannedTests, tests: this.tests}, null, 2));
    }
}
module.exports = LiveAiSummaryReporter;
