/**
 * Validation functions for package update entities
 * 
 * @module packageUpdater/validators
 */

const semver = require('semver');

/**
 * Validates a PackageDependency entity
 * @param {Object} pkg - Package dependency to validate
 * @throws {Error} If validation fails
 */
function validatePackageDependency(pkg) {
  if (!pkg || typeof pkg !== 'object') {
    throw new Error('Package dependency must be an object');
  }
  
  if (!semver.valid(pkg.currentVersion)) {
    throw new Error(`Current version must be valid semver: ${pkg.currentVersion}`);
  }
  
  if (!semver.valid(pkg.latestVersion)) {
    throw new Error(`Latest version must be valid semver: ${pkg.latestVersion}`);
  }
  
  if (!pkg.name || !pkg.name.match(/^[@a-z0-9-~][a-z0-9-._~]*$/)) {
    throw new Error(`Invalid npm package name: ${pkg.name}`);
  }
  
  if (!['dependency', 'devDependency'].includes(pkg.type)) {
    throw new Error(`Invalid dependency type: ${pkg.type}`);
  }
  
  if (pkg.isDeprecated && !pkg.hasReplacement && !pkg.deprecationReason) {
    throw new Error('Deprecation reason required for packages without replacement');
  }
}

/**
 * Validates an UpdateBatch entity
 * @param {Object} batch - Update batch to validate
 * @throws {Error} If validation fails
 */
function validateUpdateBatch(batch) {
  if (!batch || typeof batch !== 'object') {
    throw new Error('Update batch must be an object');
  }
  
  if (!['devDependencies', 'dependencies'].includes(batch.type)) {
    throw new Error(`Invalid batch type: ${batch.type}`);
  }
  
  if (!Array.isArray(batch.packages) || batch.packages.length === 0) {
    throw new Error('Batch must contain at least one package');
  }
  
  if (batch.rollbackCheckpoint && !batch.rollbackCheckpoint.match(/^[0-9a-f]{40}$/)) {
    throw new Error(`Invalid Git commit hash: ${batch.rollbackCheckpoint}`);
  }
  
  if (batch.status === 'SUCCESS') {
    if (!batch.completedAt) {
      throw new Error('Completed timestamp required for successful batch');
    }
    if (!batch.testResults || !batch.testResults.success) {
      throw new Error('Test results required for success');
    }
    if (!batch.auditResults || !batch.auditResults.success) {
      throw new Error('Audit results required for success');
    }
  }
}

/**
 * Validates a BreakingChange entity
 * @param {Object} change - Breaking change to validate
 * @throws {Error} If validation fails
 */
function validateBreakingChange(change) {
  if (!change || typeof change !== 'object') {
    throw new Error('Breaking change must be an object');
  }
  
  if (!semver.valid(change.currentVersion)) {
    throw new Error(`Current version must be valid semver: ${change.currentVersion}`);
  }
  
  if (!semver.valid(change.latestVersion)) {
    throw new Error(`Latest version must be valid semver: ${change.latestVersion}`);
  }
  
  const currentMajor = semver.major(change.currentVersion);
  const latestMajor = semver.major(change.latestVersion);
  
  if (latestMajor <= currentMajor) {
    throw new Error('Latest version must be a major version bump');
  }
}

/**
 * Validates a TechnicalDebt entity
 * @param {Object} debt - Technical debt record to validate
 * @throws {Error} If validation fails
 */
function validateTechnicalDebt(debt) {
  if (!debt || typeof debt !== 'object') {
    throw new Error('Technical debt must be an object');
  }
  
  if (!debt.deprecationReason || debt.deprecationReason.length === 0) {
    throw new Error('Deprecation reason required');
  }
  
  if (!debt.monitoringPlan || debt.monitoringPlan.length === 0) {
    throw new Error('Monitoring plan required');
  }
}

/**
 * Validates a RollbackCheckpoint entity
 * @param {Object} checkpoint - Rollback checkpoint to validate
 * @throws {Error} If validation fails
 */
function validateRollbackCheckpoint(checkpoint) {
  if (!checkpoint || typeof checkpoint !== 'object') {
    throw new Error('Rollback checkpoint must be an object');
  }
  
  if (!checkpoint.commitHash || !checkpoint.commitHash.match(/^[0-9a-f]{40}$/)) {
    throw new Error(`Invalid Git commit hash: ${checkpoint.commitHash}`);
  }
  
  if (checkpoint.packageJsonHash && !checkpoint.packageJsonHash.match(/^[0-9a-f]{64}$/)) {
    throw new Error(`Invalid SHA256 hash for package.json: ${checkpoint.packageJsonHash}`);
  }
  
  if (checkpoint.lockFileHash && !checkpoint.lockFileHash.match(/^[0-9a-f]{64}$/)) {
    throw new Error(`Invalid SHA256 hash for lock file: ${checkpoint.lockFileHash}`);
  }
}

/**
 * Validates TestResults entity
 * @param {Object} results - Test results to validate
 * @throws {Error} If validation fails
 */
function validateTestResults(results) {
  if (!results || typeof results !== 'object') {
    throw new Error('Test results must be an object');
  }
  
  const { passedTests, failedTests, skippedTests, totalTests, success, duration } = results;
  
  if (typeof passedTests !== 'number' || passedTests < 0) {
    throw new Error('Passed tests must be a non-negative number');
  }
  
  if (typeof failedTests !== 'number' || failedTests < 0) {
    throw new Error('Failed tests must be a non-negative number');
  }
  
  if (typeof skippedTests !== 'number' || skippedTests < 0) {
    throw new Error('Skipped tests must be a non-negative number');
  }
  
  if (passedTests + failedTests + skippedTests !== totalTests) {
    throw new Error('Test counts must sum to total');
  }
  
  if (success !== (failedTests === 0)) {
    throw new Error('Success flag must match zero failures');
  }
  
  if (typeof duration !== 'number' || duration <= 0) {
    throw new Error('Duration must be a positive number');
  }
}

/**
 * Validates AuditResults entity
 * @param {Object} results - Audit results to validate
 * @throws {Error} If validation fails
 */
function validateAuditResults(results) {
  if (!results || typeof results !== 'object') {
    throw new Error('Audit results must be an object');
  }
  
  if (typeof results.success !== 'boolean') {
    throw new Error('Success flag must be a boolean');
  }
  
  if (!results.vulnerabilities || typeof results.vulnerabilities !== 'object') {
    throw new Error('Vulnerabilities object required');
  }
  
  const { high, critical } = results.vulnerabilities;
  
  if (typeof high !== 'number' || high < 0) {
    throw new Error('High vulnerabilities must be a non-negative number');
  }
  
  if (typeof critical !== 'number' || critical < 0) {
    throw new Error('Critical vulnerabilities must be a non-negative number');
  }
  
  if (results.success !== (high === 0 && critical === 0)) {
    throw new Error('Success requires zero high/critical vulnerabilities');
  }
}

module.exports = {
  validatePackageDependency,
  validateUpdateBatch,
  validateBreakingChange,
  validateTechnicalDebt,
  validateRollbackCheckpoint,
  validateTestResults,
  validateAuditResults
};

