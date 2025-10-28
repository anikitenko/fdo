/**
 * Tests for custom error types
 */

const {
  GitNotAvailableError,
  TestFailureError,
  AuditFailureError,
  RollbackFailureError
} = require('../../src/utils/packageUpdater/errors');

describe('Error Types', () => {
  describe('GitNotAvailableError', () => {
    test('creates error with default message', () => {
      const error = new GitNotAvailableError();
      
      expect(error.name).toBe('GitNotAvailableError');
      expect(error.message).toContain('Git is not available');
      expect(error.recovery).toContain('Install Git');
    });
    
    test('creates error with custom message', () => {
      const error = new GitNotAvailableError('Custom message');
      
      expect(error.message).toBe('Custom message');
      expect(error.recovery).toBeDefined();
    });
    
    test('is instance of Error', () => {
      const error = new GitNotAvailableError();
      expect(error).toBeInstanceOf(Error);
    });
  });
  
  describe('TestFailureError', () => {
    test('creates error with failure count', () => {
      const error = new TestFailureError(5);
      
      expect(error.name).toBe('TestFailureError');
      expect(error.message).toContain('5 tests failed');
      expect(error.numFailedTests).toBe(5);
      expect(error.recovery).toContain('Fix failing tests');
    });
    
    test('creates error with custom message', () => {
      const error = new TestFailureError(3, 'Custom test error');
      
      expect(error.message).toBe('Custom test error');
      expect(error.numFailedTests).toBe(3);
    });
  });
  
  describe('AuditFailureError', () => {
    test('creates error with vulnerability counts', () => {
      const error = new AuditFailureError(2, 1);
      
      expect(error.name).toBe('AuditFailureError');
      expect(error.message).toContain('2 high, 1 critical');
      expect(error.high).toBe(2);
      expect(error.critical).toBe(1);
      expect(error.recovery).toContain('npm audit');
    });
    
    test('creates error with custom message', () => {
      const error = new AuditFailureError(1, 0, 'Custom audit error');
      
      expect(error.message).toBe('Custom audit error');
      expect(error.high).toBe(1);
      expect(error.critical).toBe(0);
    });
  });
  
  describe('RollbackFailureError', () => {
    test('creates error with commit hash and original error', () => {
      const originalError = new Error('Git reset failed');
      const commitHash = 'a'.repeat(40);
      const error = new RollbackFailureError(commitHash, originalError);
      
      expect(error.name).toBe('RollbackFailureError');
      expect(error.message).toContain(commitHash);
      expect(error.message).toContain('Git reset failed');
      expect(error.commitHash).toBe(commitHash);
      expect(error.originalError).toBe(originalError);
      expect(error.recovery).toContain('Manual Git reset');
    });
    
    test('handles missing original error', () => {
      const commitHash = 'b'.repeat(40);
      const error = new RollbackFailureError(commitHash, null);
      
      expect(error.message).toContain(commitHash);
      expect(error.commitHash).toBe(commitHash);
    });
  });
});

