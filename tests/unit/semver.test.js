/**
 * Tests for semver comparison helpers
 */

const {
  hasMajorUpdate,
  isCompatibleUpdate,
  preserveConstraint,
  getUpdateType,
  satisfiesConstraint,
  compareVersions
} = require('../../src/utils/packageUpdater/semver');

describe('Semver Helpers', () => {
  describe('hasMajorUpdate', () => {
    test('detects major version bump', () => {
      expect(hasMajorUpdate('1.0.0', '2.0.0')).toBe(true);
      expect(hasMajorUpdate('1.5.3', '2.0.0')).toBe(true);
      expect(hasMajorUpdate('1.9.9', '3.0.0')).toBe(true);
    });
    
    test('returns false for minor/patch updates', () => {
      expect(hasMajorUpdate('1.0.0', '1.1.0')).toBe(false);
      expect(hasMajorUpdate('1.0.0', '1.0.1')).toBe(false);
      expect(hasMajorUpdate('2.3.4', '2.5.0')).toBe(false);
    });
    
    test('handles invalid versions', () => {
      expect(hasMajorUpdate('invalid', '2.0.0')).toBe(false);
      expect(hasMajorUpdate('1.0.0', 'invalid')).toBe(false);
    });
  });
  
  describe('isCompatibleUpdate', () => {
    test('allows minor updates when target is minor', () => {
      expect(isCompatibleUpdate('1.0.0', '1.1.0', 'minor')).toBe(true);
      expect(isCompatibleUpdate('1.0.0', '1.0.1', 'minor')).toBe(true);
    });
    
    test('rejects major updates when target is minor', () => {
      expect(isCompatibleUpdate('1.0.0', '2.0.0', 'minor')).toBe(false);
    });
    
    test('allows only patch updates when target is patch', () => {
      expect(isCompatibleUpdate('1.0.0', '1.0.1', 'patch')).toBe(true);
      expect(isCompatibleUpdate('1.0.0', '1.1.0', 'patch')).toBe(false);
      expect(isCompatibleUpdate('1.0.0', '2.0.0', 'patch')).toBe(false);
    });
    
    test('allows all updates when target is major', () => {
      expect(isCompatibleUpdate('1.0.0', '2.0.0', 'major')).toBe(true);
      expect(isCompatibleUpdate('1.0.0', '1.1.0', 'major')).toBe(true);
      expect(isCompatibleUpdate('1.0.0', '1.0.1', 'major')).toBe(true);
    });
  });
  
  describe('preserveConstraint', () => {
    test('preserves caret constraint', () => {
      expect(preserveConstraint('^1.0.0', '2.0.0')).toBe('^2.0.0');
      expect(preserveConstraint('^1.5.3', '1.6.0')).toBe('^1.6.0');
    });
    
    test('preserves tilde constraint', () => {
      expect(preserveConstraint('~1.0.0', '1.1.0')).toBe('~1.1.0');
      expect(preserveConstraint('~2.3.4', '2.3.5')).toBe('~2.3.5');
    });
    
    test('returns exact version when no constraint', () => {
      expect(preserveConstraint('1.0.0', '2.0.0')).toBe('2.0.0');
      expect(preserveConstraint('2.3.4', '2.3.5')).toBe('2.3.5');
    });
    
    test('preserves comparison operators', () => {
      expect(preserveConstraint('>=1.0.0', '2.0.0')).toBe('>=2.0.0');
      expect(preserveConstraint('>1.0.0', '2.0.0')).toBe('>2.0.0');
    });
  });
  
  describe('getUpdateType', () => {
    test('identifies major updates', () => {
      expect(getUpdateType('1.0.0', '2.0.0')).toBe('major');
      expect(getUpdateType('1.5.3', '3.0.0')).toBe('major');
    });
    
    test('identifies minor updates', () => {
      expect(getUpdateType('1.0.0', '1.1.0')).toBe('minor');
      expect(getUpdateType('2.3.0', '2.5.0')).toBe('minor');
    });
    
    test('identifies patch updates', () => {
      expect(getUpdateType('1.0.0', '1.0.1')).toBe('patch');
      expect(getUpdateType('2.3.4', '2.3.5')).toBe('patch');
    });
    
    test('returns none for same version', () => {
      expect(getUpdateType('1.0.0', '1.0.0')).toBe('none');
    });
  });
  
  describe('satisfiesConstraint', () => {
    test('validates version against caret constraint', () => {
      expect(satisfiesConstraint('1.5.0', '^1.0.0')).toBe(true);
      expect(satisfiesConstraint('2.0.0', '^1.0.0')).toBe(false);
    });
    
    test('validates version against tilde constraint', () => {
      expect(satisfiesConstraint('1.0.5', '~1.0.0')).toBe(true);
      expect(satisfiesConstraint('1.1.0', '~1.0.0')).toBe(false);
    });
    
    test('validates version against exact constraint', () => {
      expect(satisfiesConstraint('1.0.0', '1.0.0')).toBe(true);
      expect(satisfiesConstraint('1.0.1', '1.0.0')).toBe(false);
    });
  });
  
  describe('compareVersions', () => {
    test('compares versions correctly', () => {
      expect(compareVersions('1.0.0', '2.0.0')).toBe(-1);
      expect(compareVersions('2.0.0', '1.0.0')).toBe(1);
      expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    });
    
    test('handles invalid versions', () => {
      expect(compareVersions('invalid', '1.0.0')).toBe(0);
      expect(compareVersions('1.0.0', 'invalid')).toBe(0);
    });
  });
});

