/**
 * Custom error types for package update operations
 * 
 * @module packageUpdater/errors
 */

/**
 * Error thrown when Git is not available or repository not initialized
 */
class GitNotAvailableError extends Error {
  constructor(message = 'Git is not available or repository not initialized') {
    super(message);
    this.name = 'GitNotAvailableError';
    this.recovery = 'Install Git and run `git init` in the project directory';
    
    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, GitNotAvailableError);
    }
  }
}

/**
 * Error thrown when test suite fails and autoRollback=false
 */
class TestFailureError extends Error {
  constructor(numFailedTests = 0, message) {
    const errorMessage = message || `Test suite failed: ${numFailedTests} tests failed`;
    super(errorMessage);
    this.name = 'TestFailureError';
    this.numFailedTests = numFailedTests;
    this.recovery = 'Fix failing tests or enable autoRollback option';
    
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, TestFailureError);
    }
  }
}

/**
 * Error thrown when critical vulnerabilities detected and autoRollback=false
 */
class AuditFailureError extends Error {
  constructor(high = 0, critical = 0, message) {
    const errorMessage = message || `Security audit failed: ${high} high, ${critical} critical vulnerabilities`;
    super(errorMessage);
    this.name = 'AuditFailureError';
    this.high = high;
    this.critical = critical;
    this.recovery = 'Review npm audit output and update vulnerable packages manually';
    
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AuditFailureError);
    }
  }
}

/**
 * Error thrown when rollback process fails
 */
class RollbackFailureError extends Error {
  constructor(commitHash, originalError, message) {
    const errorMessage = message || `Failed to rollback to checkpoint ${commitHash}: ${originalError?.message || 'Unknown error'}`;
    super(errorMessage);
    this.name = 'RollbackFailureError';
    this.commitHash = commitHash;
    this.originalError = originalError;
    this.recovery = 'Manual Git reset may be required: git reset --hard <checkpoint-hash>; npm ci';
    
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, RollbackFailureError);
    }
  }
}

module.exports = {
  GitNotAvailableError,
  TestFailureError,
  AuditFailureError,
  RollbackFailureError
};

