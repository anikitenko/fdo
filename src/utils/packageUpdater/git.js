/**
 * Git checkpoint and rollback utilities
 * 
 * @module packageUpdater/git
 */

const simpleGit = require('simple-git');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { GitNotAvailableError, RollbackFailureError } = require('./errors');

/**
 * Create a rollback checkpoint by committing current package files
 * 
 * @param {string} message - Commit message for the checkpoint
 * @param {string} [projectRoot=process.cwd()] - Project root directory
 * @returns {Promise<Object>} Checkpoint object with commitHash, createdAt, message, hashes
 * @throws {GitNotAvailableError} If Git is not available
 */
async function createRollbackCheckpoint(message, projectRoot = process.cwd()) {
  const git = simpleGit(projectRoot);
  
  try {
    // Verify Git is available
    await git.version();
  } catch (error) {
    throw new GitNotAvailableError('Git is not installed or not accessible');
  }
  
  try {
    // Check if we're in a Git repository
    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
      throw new GitNotAvailableError('Not a Git repository. Run `git init` first.');
    }
    
    // Add package files to staging
    await git.add(['package.json', 'package-lock.json']);
    
    // Create commit
    await git.commit(message);
    
    // Get commit hash
    const commitHash = await getCommitHash(projectRoot);
    
    // Hash package files
    const packageJsonPath = path.join(projectRoot, 'package.json');
    const lockFilePath = path.join(projectRoot, 'package-lock.json');
    
    const packageJsonHash = await hashFile(packageJsonPath);
    const lockFileHash = await hashFile(lockFilePath);
    
    return {
      commitHash,
      createdAt: new Date().toISOString(),
      message,
      packageJsonHash,
      lockFileHash
    };
  } catch (error) {
    if (error instanceof GitNotAvailableError) {
      throw error;
    }
    throw new Error(`Failed to create checkpoint: ${error.message}`);
  }
}

/**
 * Rollback to a previous checkpoint by resetting to a commit
 * 
 * @param {Object} checkpoint - Checkpoint object with commitHash
 * @param {string} [projectRoot=process.cwd()] - Project root directory
 * @returns {Promise<void>}
 * @throws {RollbackFailureError} If rollback fails
 */
async function rollbackToCheckpoint(checkpoint, projectRoot = process.cwd()) {
  const git = simpleGit(projectRoot);
  
  try {
    // Verify Git is available
    await git.version();
    
    // Reset to checkpoint
    await git.reset(['--hard', checkpoint.commitHash]);
    
    // Restore node_modules from lock file
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    
    await execAsync('npm ci', { cwd: projectRoot });
  } catch (error) {
    throw new RollbackFailureError(
      checkpoint.commitHash,
      error,
      `Rollback failed: ${error.message}`
    );
  }
}

/**
 * Get the current HEAD commit hash
 * 
 * @param {string} [projectRoot=process.cwd()] - Project root directory
 * @returns {Promise<string>} Commit hash (40-character hex string)
 */
async function getCommitHash(projectRoot = process.cwd()) {
  const git = simpleGit(projectRoot);
  
  try {
    const result = await git.revparse(['HEAD']);
    return result.trim();
  } catch (error) {
    throw new Error(`Failed to get commit hash: ${error.message}`);
  }
}

/**
 * Hash a file using SHA256
 * 
 * @param {string} filePath - Path to file to hash
 * @returns {Promise<string>} SHA256 hash (64-character hex string)
 */
async function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    
    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/**
 * Check if Git is available and repository is initialized
 * 
 * @param {string} [projectRoot=process.cwd()] - Project root directory
 * @returns {Promise<boolean>} True if Git is available and repo initialized
 */
async function isGitAvailable(projectRoot = process.cwd()) {
  const git = simpleGit(projectRoot);
  
  try {
    await git.version();
    return await git.checkIsRepo();
  } catch (error) {
    return false;
  }
}

module.exports = {
  createRollbackCheckpoint,
  rollbackToCheckpoint,
  getCommitHash,
  hashFile,
  isGitAvailable
};

