/**
 * Tests for validation functions
 */

const {
  validatePackageDependency,
  validateUpdateBatch,
  validateBreakingChange,
  validateTechnicalDebt,
  validateRollbackCheckpoint,
  validateTestResults,
  validateAuditResults
} = require('../../src/utils/packageUpdater/validators');

describe('Validators', () => {
  describe('validatePackageDependency', () => {
    test('validates correct package dependency', () => {
      const validPkg = {
        name: 'react',
        currentVersion: '17.0.2',
        latestVersion: '18.3.1',
        type: 'dependency',
        versionConstraint: '^17.0.2',
        isDeprecated: false,
        hasReplacement: true
      };
      
      expect(() => validatePackageDependency(validPkg)).not.toThrow();
    });
    
    test('throws on invalid semver versions', () => {
      const invalidPkg = {
        name: 'react',
        currentVersion: 'invalid',
        latestVersion: '18.3.1',
        type: 'dependency'
      };
      
      expect(() => validatePackageDependency(invalidPkg)).toThrow('Current version must be valid semver');
    });
    
    test('throws on invalid package name', () => {
      const invalidPkg = {
        name: 'Invalid Package!',
        currentVersion: '1.0.0',
        latestVersion: '2.0.0',
        type: 'dependency'
      };
      
      expect(() => validatePackageDependency(invalidPkg)).toThrow('Invalid npm package name');
    });
    
    test('requires deprecation reason for deprecated packages without replacement', () => {
      const invalidPkg = {
        name: 'old-package',
        currentVersion: '1.0.0',
        latestVersion: '1.0.0',
        type: 'dependency',
        isDeprecated: true,
        hasReplacement: false
        // Missing deprecationReason
      };
      
      expect(() => validatePackageDependency(invalidPkg)).toThrow('Deprecation reason required');
    });
  });
  
  describe('validateUpdateBatch', () => {
    test('validates correct update batch', () => {
      const validBatch = {
        type: 'devDependencies',
        packages: [{ name: 'jest', currentVersion: '29.0.0', latestVersion: '30.0.0' }],
        rollbackCheckpoint: 'a'.repeat(40),
        status: 'PENDING'
      };
      
      expect(() => validateUpdateBatch(validBatch)).not.toThrow();
    });
    
    test('throws on invalid batch type', () => {
      const invalidBatch = {
        type: 'invalidType',
        packages: [{}]
      };
      
      expect(() => validateUpdateBatch(invalidBatch)).toThrow('Invalid batch type');
    });
    
    test('throws on empty packages array', () => {
      const invalidBatch = {
        type: 'dependencies',
        packages: []
      };
      
      expect(() => validateUpdateBatch(invalidBatch)).toThrow('Batch must contain at least one package');
    });
    
    test('throws on invalid Git commit hash', () => {
      const invalidBatch = {
        type: 'dependencies',
        packages: [{}],
        rollbackCheckpoint: 'invalid-hash'
      };
      
      expect(() => validateUpdateBatch(invalidBatch)).toThrow('Invalid Git commit hash');
    });
  });
  
  describe('validateBreakingChange', () => {
    test('validates major version bump', () => {
      const validChange = {
        packageName: 'react',
        currentVersion: '17.0.2',
        latestVersion: '18.3.1'
      };
      
      expect(() => validateBreakingChange(validChange)).not.toThrow();
    });
    
    test('throws on non-major version bump', () => {
      const invalidChange = {
        packageName: 'react',
        currentVersion: '17.0.2',
        latestVersion: '17.1.0'
      };
      
      expect(() => validateBreakingChange(invalidChange)).toThrow('Latest version must be a major version bump');
    });
  });
  
  describe('validateTechnicalDebt', () => {
    test('validates correct technical debt record', () => {
      const validDebt = {
        packageName: 'request',
        deprecationReason: 'Package is deprecated',
        monitoringPlan: 'Check monthly for security issues'
      };
      
      expect(() => validateTechnicalDebt(validDebt)).not.toThrow();
    });
    
    test('throws on missing deprecation reason', () => {
      const invalidDebt = {
        packageName: 'request',
        deprecationReason: '',
        monitoringPlan: 'Check monthly'
      };
      
      expect(() => validateTechnicalDebt(invalidDebt)).toThrow('Deprecation reason required');
    });
    
    test('throws on missing monitoring plan', () => {
      const invalidDebt = {
        packageName: 'request',
        deprecationReason: 'Deprecated',
        monitoringPlan: ''
      };
      
      expect(() => validateTechnicalDebt(invalidDebt)).toThrow('Monitoring plan required');
    });
  });
  
  describe('validateRollbackCheckpoint', () => {
    test('validates correct checkpoint', () => {
      const validCheckpoint = {
        commitHash: 'a'.repeat(40),
        packageJsonHash: 'b'.repeat(64),
        lockFileHash: 'c'.repeat(64)
      };
      
      expect(() => validateRollbackCheckpoint(validCheckpoint)).not.toThrow();
    });
    
    test('throws on invalid commit hash', () => {
      const invalidCheckpoint = {
        commitHash: 'invalid'
      };
      
      expect(() => validateRollbackCheckpoint(invalidCheckpoint)).toThrow('Invalid Git commit hash');
    });
  });
  
  describe('validateTestResults', () => {
    test('validates correct test results', () => {
      const validResults = {
        success: true,
        totalTests: 100,
        passedTests: 100,
        failedTests: 0,
        skippedTests: 0,
        duration: 5000
      };
      
      expect(() => validateTestResults(validResults)).not.toThrow();
    });
    
    test('throws when test counts don\'t sum correctly', () => {
      const invalidResults = {
        success: false,
        totalTests: 100,
        passedTests: 50,
        failedTests: 10,
        skippedTests: 10, // Should be 40 to sum to 100
        duration: 5000
      };
      
      expect(() => validateTestResults(invalidResults)).toThrow('Test counts must sum to total');
    });
    
    test('throws when success flag doesn\'t match failures', () => {
      const invalidResults = {
        success: true, // Should be false with failed tests
        totalTests: 100,
        passedTests: 99,
        failedTests: 1,
        skippedTests: 0,
        duration: 5000
      };
      
      expect(() => validateTestResults(invalidResults)).toThrow('Success flag must match zero failures');
    });
  });
  
  describe('validateAuditResults', () => {
    test('validates correct audit results', () => {
      const validResults = {
        success: true,
        vulnerabilities: {
          info: 0,
          low: 2,
          moderate: 1,
          high: 0,
          critical: 0
        }
      };
      
      expect(() => validateAuditResults(validResults)).not.toThrow();
    });
    
    test('throws when success flag doesn\'t match vulnerabilities', () => {
      const invalidResults = {
        success: true, // Should be false with high vulnerabilities
        vulnerabilities: {
          info: 0,
          low: 0,
          moderate: 0,
          high: 2,
          critical: 0
        }
      };
      
      expect(() => validateAuditResults(invalidResults)).toThrow('Success requires zero high/critical vulnerabilities');
    });
  });
});

