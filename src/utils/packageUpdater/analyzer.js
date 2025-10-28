/**
 * Package analysis utilities
 * 
 * @module packageUpdater/analyzer
 */

const fs = require('fs');
const path = require('path');

/**
 * Parse package.json and return structured data
 * 
 * @param {string} [projectRoot=process.cwd()] - Project root directory
 * @returns {Object} Parsed package.json with dependencies info
 * @throws {Error} If package.json not found or invalid
 */
function parsePackageJson(projectRoot = process.cwd()) {
  const packageJsonPath = path.join(projectRoot, 'package.json');
  
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error('package.json not found');
  }
  
  try {
    const content = fs.readFileSync(packageJsonPath, 'utf-8');
    const packageJson = JSON.parse(content);
    
    return {
      name: packageJson.name,
      version: packageJson.version,
      dependencies: packageJson.dependencies || {},
      devDependencies: packageJson.devDependencies || {},
      peerDependencies: packageJson.peerDependencies || {},
      engines: packageJson.engines || {},
      raw: packageJson
    };
  } catch (error) {
    throw new Error(`Failed to parse package.json: ${error.message}`);
  }
}

/**
 * Get installed version of a package
 * 
 * @param {string} packageName - Name of package
 * @param {string} [projectRoot=process.cwd()] - Project root directory
 * @returns {string|null} Version string or null if not installed
 */
function getInstalledVersion(packageName, projectRoot = process.cwd()) {
  try {
    const packageJsonPath = path.join(
      projectRoot,
      'node_modules',
      packageName,
      'package.json'
    );
    
    if (!fs.existsSync(packageJsonPath)) {
      return null;
    }
    
    const content = fs.readFileSync(packageJsonPath, 'utf-8');
    const packageJson = JSON.parse(content);
    
    return packageJson.version || null;
  } catch (error) {
    return null;
  }
}

/**
 * Check if package is a direct dependency (not transitive)
 * 
 * @param {string} packageName - Name of package
 * @param {string} [projectRoot=process.cwd()] - Project root directory
 * @returns {boolean} True if direct dependency
 */
function isDirectDependency(packageName, projectRoot = process.cwd()) {
  try {
    const packageData = parsePackageJson(projectRoot);
    
    return (
      packageName in packageData.dependencies ||
      packageName in packageData.devDependencies
    );
  } catch (error) {
    return false;
  }
}

/**
 * Get version constraint for a package from package.json
 * 
 * @param {string} packageName - Name of package
 * @param {string} [projectRoot=process.cwd()] - Project root directory
 * @returns {Object} Constraint info with type and constraint string
 */
function getVersionConstraint(packageName, projectRoot = process.cwd()) {
  try {
    const packageData = parsePackageJson(projectRoot);
    
    let constraint = null;
    let type = null;
    
    if (packageName in packageData.dependencies) {
      constraint = packageData.dependencies[packageName];
      type = 'dependency';
    } else if (packageName in packageData.devDependencies) {
      constraint = packageData.devDependencies[packageName];
      type = 'devDependency';
    } else if (packageName in packageData.peerDependencies) {
      constraint = packageData.peerDependencies[packageName];
      type = 'peerDependency';
    }
    
    return {
      type,
      constraint,
      original: constraint
    };
  } catch (error) {
    return {
      type: null,
      constraint: null,
      original: null
    };
  }
}

/**
 * Get all direct dependencies with their constraints
 * 
 * @param {string} [projectRoot=process.cwd()] - Project root directory
 * @returns {Object} Object with dependencies and devDependencies arrays
 */
function getAllDependencies(projectRoot = process.cwd()) {
  const packageData = parsePackageJson(projectRoot);
  
  const dependencies = Object.entries(packageData.dependencies).map(([name, constraint]) => ({
    name,
    constraint,
    type: 'dependency'
  }));
  
  const devDependencies = Object.entries(packageData.devDependencies).map(([name, constraint]) => ({
    name,
    constraint,
    type: 'devDependency'
  }));
  
  return {
    dependencies,
    devDependencies,
    all: [...dependencies, ...devDependencies]
  };
}

/**
 * Update package.json with new version constraint
 * 
 * @param {string} packageName - Name of package
 * @param {string} newConstraint - New version constraint
 * @param {string} [projectRoot=process.cwd()] - Project root directory
 * @returns {boolean} True if updated successfully
 */
function updatePackageConstraint(packageName, newConstraint, projectRoot = process.cwd()) {
  try {
    const packageJsonPath = path.join(projectRoot, 'package.json');
    const content = fs.readFileSync(packageJsonPath, 'utf-8');
    const packageJson = JSON.parse(content);
    
    let updated = false;
    
    if (packageName in packageJson.dependencies) {
      packageJson.dependencies[packageName] = newConstraint;
      updated = true;
    }
    
    if (packageName in packageJson.devDependencies) {
      packageJson.devDependencies[packageName] = newConstraint;
      updated = true;
    }
    
    if (updated) {
      fs.writeFileSync(
        packageJsonPath,
        JSON.stringify(packageJson, null, 2) + '\n',
        'utf-8'
      );
    }
    
    return updated;
  } catch (error) {
    return false;
  }
}

module.exports = {
  parsePackageJson,
  getInstalledVersion,
  isDirectDependency,
  getVersionConstraint,
  getAllDependencies,
  updatePackageConstraint
};

