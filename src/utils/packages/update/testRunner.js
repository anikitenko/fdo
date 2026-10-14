/**
 * Jest test runner integration
 * 
 * @module packageUpdater/testRunner
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

/**
 * Run Jest test suite
 * 
 * @param {Object} options - Test options
 * @param {string} [options.cwd=process.cwd()] - Working directory
 * @param {boolean} [options.silent=true] - Suppress console output
 * @param {string[]} [options.testMatch] - Test file patterns
 * @param {number} [options.timeout=300000] - Test timeout in ms (5 minutes)
 * @returns {Promise<Object>} Test results
 */
async function runTests(options = {}) {
  const {
    cwd = process.cwd(),
    silent = true,
    testMatch = ['**/*.test.js'],
    timeout = 300000 // 5 minutes
  } = options;
  
  // Build Jest command
  const jestArgs = [];
  
  if (silent) {
    jestArgs.push('--silent');
  }
  
  jestArgs.push('--json');
  jestArgs.push('--no-coverage');
  
  const command = `npm test -- ${jestArgs.join(' ')}`;
  
  const startTime = Date.now();
  
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout,
      maxBuffer: 10 * 1024 * 1024
    });
    
    const duration = Date.now() - startTime;
    
    // Parse Jest JSON output
    const results = parseTestResults(stdout);
    
    return {
      ...results,
      duration,
      stderr: stderr || ''
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    
    // Jest exits with non-zero if tests fail
    // Try to parse the output anyway
    if (error.stdout) {
      try {
        const results = parseTestResults(error.stdout);
        return {
          ...results,
          duration,
          stderr: error.stderr || ''
        };
      } catch (parseError) {
        // Fall through to error return
      }
    }
    
    // If we can't parse output, return failure
    return {
      success: false,
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
      skippedTests: 0,
      duration,
      failures: [],
      stderr: error.stderr || error.message,
      error: error.message
    };
  }
}

/**
 * Parse Jest JSON output
 * 
 * @param {string} jestOutput - Jest JSON output
 * @returns {Object} Parsed test results
 */
function parseTestResults(jestOutput) {
  try {
    const data = JSON.parse(jestOutput);
    
    // Extract results from Jest output
    const numTotalTests = data.numTotalTests || 0;
    const numPassedTests = data.numPassedTests || 0;
    const numFailedTests = data.numFailedTests || 0;
    const numPendingTests = data.numPendingTests || 0;
    
    // Extract failure details
    const failures = [];
    if (data.testResults) {
      for (const testFile of data.testResults) {
        if (testFile.status === 'failed') {
          for (const testCase of testFile.assertionResults || []) {
            if (testCase.status === 'failed') {
              failures.push({
                testFile: testFile.name,
                testName: testCase.fullName || testCase.title,
                message: testCase.failureMessages?.join('\n') || 'Unknown failure'
              });
            }
          }
        }
      }
    }
    
    return {
      success: numFailedTests === 0,
      totalTests: numTotalTests,
      passedTests: numPassedTests,
      failedTests: numFailedTests,
      skippedTests: numPendingTests,
      failures
    };
  } catch (error) {
    throw new Error(`Failed to parse Jest output: ${error.message}`);
  }
}

/**
 * Check if Jest is available
 * 
 * @param {string} [cwd=process.cwd()] - Working directory
 * @returns {Promise<boolean>} True if Jest is available
 */
async function isJestAvailable(cwd = process.cwd()) {
  try {
    await execAsync('npm test -- --version', { cwd });
    return true;
  } catch (error) {
    return false;
  }
}

module.exports = {
  runTests,
  parseTestResults,
  isJestAvailable
};

