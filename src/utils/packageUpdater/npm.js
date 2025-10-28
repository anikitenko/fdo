/**
 * npm CLI command wrappers
 * 
 * @module packageUpdater/npm
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

/**
 * Run npm install
 * 
 * @param {Object} options - Installation options
 * @param {string} [options.cwd=process.cwd()] - Working directory
 * @param {boolean} [options.preferOffline=true] - Use offline cache when possible
 * @returns {Promise<Object>} Result with stdout, stderr
 */
async function runInstall(options = {}) {
  const { cwd = process.cwd(), preferOffline = true } = options;
  
  const flags = [];
  if (preferOffline) {
    flags.push('--prefer-offline');
  }
  
  const command = `npm install ${flags.join(' ')}`;
  
  try {
    const result = await execAsync(command, { cwd, maxBuffer: 10 * 1024 * 1024 });
    return {
      success: true,
      stdout: result.stdout,
      stderr: result.stderr
    };
  } catch (error) {
    return {
      success: false,
      stdout: error.stdout || '',
      stderr: error.stderr || '',
      error: error.message
    };
  }
}

/**
 * Run npm ci (clean install from lock file)
 * 
 * @param {Object} options - Installation options
 * @param {string} [options.cwd=process.cwd()] - Working directory
 * @returns {Promise<Object>} Result with stdout, stderr
 */
async function runCi(options = {}) {
  const { cwd = process.cwd() } = options;
  
  try {
    const result = await execAsync('npm ci', { cwd, maxBuffer: 10 * 1024 * 1024 });
    return {
      success: true,
      stdout: result.stdout,
      stderr: result.stderr
    };
  } catch (error) {
    return {
      success: false,
      stdout: error.stdout || '',
      stderr: error.stderr || '',
      error: error.message
    };
  }
}

/**
 * Run npm audit and get security vulnerabilities
 * 
 * @param {Object} options - Audit options
 * @param {string} [options.cwd=process.cwd()] - Working directory
 * @returns {Promise<Object>} Audit results with vulnerability counts
 */
async function runAudit(options = {}) {
  const { cwd = process.cwd() } = options;
  
  try {
    const { stdout } = await execAsync('npm audit --json', { cwd });
    const auditData = JSON.parse(stdout);
    
    // Parse vulnerability counts by severity
    const vulnerabilities = {
      info: auditData.metadata?.vulnerabilities?.info || 0,
      low: auditData.metadata?.vulnerabilities?.low || 0,
      moderate: auditData.metadata?.vulnerabilities?.moderate || 0,
      high: auditData.metadata?.vulnerabilities?.high || 0,
      critical: auditData.metadata?.vulnerabilities?.critical || 0
    };
    
    // Extract vulnerability details
    const details = [];
    if (auditData.vulnerabilities) {
      for (const [name, vuln] of Object.entries(auditData.vulnerabilities)) {
        details.push({
          package: name,
          severity: vuln.severity,
          title: vuln.via?.[0]?.title || 'Unknown vulnerability',
          url: vuln.via?.[0]?.url,
          fixAvailable: !!vuln.fixAvailable
        });
      }
    }
    
    return {
      success: vulnerabilities.high === 0 && vulnerabilities.critical === 0,
      vulnerabilities,
      details
    };
  } catch (error) {
    // npm audit exits with non-zero if vulnerabilities found
    // Try to parse the output anyway
    if (error.stdout) {
      try {
        const auditData = JSON.parse(error.stdout);
        const vulnerabilities = {
          info: auditData.metadata?.vulnerabilities?.info || 0,
          low: auditData.metadata?.vulnerabilities?.low || 0,
          moderate: auditData.metadata?.vulnerabilities?.moderate || 0,
          high: auditData.metadata?.vulnerabilities?.high || 0,
          critical: auditData.metadata?.vulnerabilities?.critical || 0
        };
        
        return {
          success: vulnerabilities.high === 0 && vulnerabilities.critical === 0,
          vulnerabilities,
          details: []
        };
      } catch (parseError) {
        // Fall through to error return
      }
    }
    
    return {
      success: false,
      vulnerabilities: {
        info: 0,
        low: 0,
        moderate: 0,
        high: 0,
        critical: 0
      },
      details: [],
      error: error.message
    };
  }
}

/**
 * Get outdated packages
 * 
 * @param {Object} options - Options
 * @param {string} [options.cwd=process.cwd()] - Working directory
 * @returns {Promise<Array>} Array of outdated packages
 */
async function getOutdated(options = {}) {
  const { cwd = process.cwd() } = options;
  
  try {
    const { stdout } = await execAsync('npm outdated --json', { cwd });
    const outdatedData = JSON.parse(stdout);
    
    return Object.entries(outdatedData).map(([name, info]) => ({
      name,
      current: info.current,
      wanted: info.wanted,
      latest: info.latest,
      location: info.location,
      type: info.type || 'dependency'
    }));
  } catch (error) {
    // npm outdated exits with 1 if outdated packages found
    if (error.stdout) {
      try {
        const outdatedData = JSON.parse(error.stdout);
        return Object.entries(outdatedData).map(([name, info]) => ({
          name,
          current: info.current,
          wanted: info.wanted,
          latest: info.latest,
          location: info.location,
          type: info.type || 'dependency'
        }));
      } catch (parseError) {
        // No outdated packages
        return [];
      }
    }
    return [];
  }
}

/**
 * Get package information from npm registry
 * 
 * @param {string} packageName - Name of package
 * @param {Object} options - Options
 * @param {string} [options.cwd=process.cwd()] - Working directory
 * @returns {Promise<Object>} Package information
 */
async function getPackageInfo(packageName, options = {}) {
  const { cwd = process.cwd() } = options;
  
  try {
    const { stdout } = await execAsync(`npm view ${packageName} --json`, { cwd });
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`Failed to get package info for ${packageName}: ${error.message}`);
  }
}

/**
 * Check if npm is available
 * 
 * @returns {Promise<boolean>} True if npm is available
 */
async function isNpmAvailable() {
  try {
    await execAsync('npm --version');
    return true;
  } catch (error) {
    return false;
  }
}

module.exports = {
  runInstall,
  runCi,
  runAudit,
  getOutdated,
  getPackageInfo,
  isNpmAvailable
};

