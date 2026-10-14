/**
 * Semver comparison and manipulation helpers
 * 
 * @module packageUpdater/semver
 */

const semver = require('semver');

/**
 * Check if update is a major version bump (breaking change)
 * 
 * @param {string} current - Current version
 * @param {string} latest - Latest version
 * @returns {boolean} True if major version bump
 */
function hasMajorUpdate(current, latest) {
  if (!semver.valid(current) || !semver.valid(latest)) {
    return false;
  }
  
  const currentMajor = semver.major(current);
  const latestMajor = semver.major(latest);
  
  return latestMajor > currentMajor;
}

/**
 * Check if update is compatible based on target level
 * 
 * @param {string} current - Current version
 * @param {string} latest - Latest version
 * @param {string} target - Target update level: 'major', 'minor', or 'patch'
 * @returns {boolean} True if compatible with target
 */
function isCompatibleUpdate(current, latest, target = 'minor') {
  if (!semver.valid(current) || !semver.valid(latest)) {
    return false;
  }
  
  const currentMajor = semver.major(current);
  const currentMinor = semver.minor(current);
  const latestMajor = semver.major(latest);
  const latestMinor = semver.minor(latest);
  
  switch (target) {
    case 'major':
      // Allow any update
      return true;
      
    case 'minor':
      // Allow minor and patch updates (same major version)
      return latestMajor === currentMajor;
      
    case 'patch':
      // Allow only patch updates (same major and minor version)
      return latestMajor === currentMajor && latestMinor === currentMinor;
      
    default:
      return false;
  }
}

/**
 * Preserve original version constraint format (^, ~, exact)
 * 
 * @param {string} original - Original constraint (e.g., "^1.2.3", "~2.0.0", "3.1.0")
 * @param {string} newVersion - New version to apply constraint to
 * @returns {string} New constraint with same format
 */
function preserveConstraint(original, newVersion) {
  if (!original || !newVersion) {
    return newVersion;
  }
  
  // Detect constraint type
  if (original.startsWith('^')) {
    return `^${newVersion}`;
  } else if (original.startsWith('~')) {
    return `~${newVersion}`;
  } else if (original.startsWith('>=')) {
    return `>=${newVersion}`;
  } else if (original.startsWith('>')) {
    return `>${newVersion}`;
  } else if (original.startsWith('<=')) {
    return `<=${newVersion}`;
  } else if (original.startsWith('<')) {
    return `<${newVersion}`;
  } else if (original.startsWith('=')) {
    return `=${newVersion}`;
  } else if (original.includes(' - ')) {
    // Range like "1.0.0 - 2.0.0"
    // Keep as exact version since range is complex
    return newVersion;
  } else if (original.includes('||')) {
    // Multiple ranges like "^1.0.0 || ^2.0.0"
    // Keep as exact version since range is complex
    return newVersion;
  } else if (original.includes('*') || original.includes('x') || original.includes('X')) {
    // Wildcard versions like "1.x" or "1.2.*"
    // Keep as exact version since wildcard is ambiguous
    return newVersion;
  }
  
  // No constraint prefix, return exact version
  return newVersion;
}

/**
 * Get update type between two versions
 * 
 * @param {string} from - Current version
 * @param {string} to - Target version
 * @returns {string} Update type: 'major', 'minor', 'patch', or 'none'
 */
function getUpdateType(from, to) {
  if (!semver.valid(from) || !semver.valid(to)) {
    return 'none';
  }
  
  const diff = semver.diff(from, to);
  
  if (!diff) {
    return 'none';
  }
  
  if (diff === 'major' || diff === 'premajor') {
    return 'major';
  } else if (diff === 'minor' || diff === 'preminor') {
    return 'minor';
  } else if (diff === 'patch' || diff === 'prepatch') {
    return 'patch';
  }
  
  return 'none';
}

/**
 * Check if version satisfies constraint
 * 
 * @param {string} version - Version to check
 * @param {string} constraint - Semver constraint
 * @returns {boolean} True if version satisfies constraint
 */
function satisfiesConstraint(version, constraint) {
  if (!semver.valid(version)) {
    return false;
  }
  
  try {
    return semver.satisfies(version, constraint);
  } catch (error) {
    return false;
  }
}

/**
 * Get highest version that satisfies constraint
 * 
 * @param {string[]} versions - Array of versions
 * @param {string} constraint - Semver constraint
 * @returns {string|null} Highest satisfying version or null
 */
function maxSatisfying(versions, constraint) {
  try {
    return semver.maxSatisfying(versions, constraint);
  } catch (error) {
    return null;
  }
}

/**
 * Clean and validate semver version
 * 
 * @param {string} version - Version string to clean
 * @returns {string|null} Cleaned version or null if invalid
 */
function cleanVersion(version) {
  try {
    return semver.clean(version);
  } catch (error) {
    return null;
  }
}

/**
 * Compare two versions
 * 
 * @param {string} v1 - First version
 * @param {string} v2 - Second version
 * @returns {number} -1 if v1 < v2, 0 if v1 === v2, 1 if v1 > v2
 */
function compareVersions(v1, v2) {
  if (!semver.valid(v1) || !semver.valid(v2)) {
    return 0;
  }
  
  return semver.compare(v1, v2);
}

module.exports = {
  hasMajorUpdate,
  isCompatibleUpdate,
  preserveConstraint,
  getUpdateType,
  satisfiesConstraint,
  maxSatisfying,
  cleanVersion,
  compareVersions
};

