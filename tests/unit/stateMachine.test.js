/**
 * Tests for UpdateBatch state machine
 */

const {
  STATES,
  EVENTS,
  transition,
  validateTransition,
  getValidEvents,
  isTerminalState,
  getStateDescription
} = require('../../src/utils/packageUpdater/stateMachine');

describe('State Machine', () => {
  describe('transition', () => {
    test('transitions from PENDING to UPDATING on startUpdate', () => {
      const batch = { status: STATES.PENDING };
      const newState = transition(batch, EVENTS.START_UPDATE);
      
      expect(newState).toBe(STATES.UPDATING);
      expect(batch.status).toBe(STATES.UPDATING);
    });
    
    test('transitions from UPDATING to TESTING on updateComplete', () => {
      const batch = { status: STATES.UPDATING };
      const newState = transition(batch, EVENTS.UPDATE_COMPLETE);
      
      expect(newState).toBe(STATES.TESTING);
      expect(batch.status).toBe(STATES.TESTING);
    });
    
    test('transitions from TESTING to AUDITING on testsPass', () => {
      const batch = { status: STATES.TESTING };
      const newState = transition(batch, EVENTS.TESTS_PASS);
      
      expect(newState).toBe(STATES.AUDITING);
      expect(batch.status).toBe(STATES.AUDITING);
    });
    
    test('transitions from AUDITING to SUCCESS on auditPass', () => {
      const batch = { status: STATES.AUDITING };
      const newState = transition(batch, EVENTS.AUDIT_PASS);
      
      expect(newState).toBe(STATES.SUCCESS);
      expect(batch.status).toBe(STATES.SUCCESS);
      expect(batch.completedAt).toBeDefined();
    });
    
    test('transitions to ROLLING_BACK on failures', () => {
      // From UPDATING
      let batch = { status: STATES.UPDATING };
      transition(batch, EVENTS.UPDATE_FAILED);
      expect(batch.status).toBe(STATES.ROLLING_BACK);
      
      // From TESTING
      batch = { status: STATES.TESTING };
      transition(batch, EVENTS.TESTS_FAIL);
      expect(batch.status).toBe(STATES.ROLLING_BACK);
      
      // From AUDITING
      batch = { status: STATES.AUDITING };
      transition(batch, EVENTS.AUDIT_FAIL);
      expect(batch.status).toBe(STATES.ROLLING_BACK);
    });
    
    test('transitions from ROLLING_BACK to FAILED on rollbackComplete', () => {
      const batch = { status: STATES.ROLLING_BACK };
      const newState = transition(batch, EVENTS.ROLLBACK_COMPLETE);
      
      expect(newState).toBe(STATES.FAILED);
      expect(batch.status).toBe(STATES.FAILED);
      expect(batch.completedAt).toBeDefined();
    });
    
    test('throws on invalid transition', () => {
      const batch = { status: STATES.PENDING };
      
      expect(() => transition(batch, EVENTS.TESTS_PASS)).toThrow('Invalid transition');
    });
    
    test('throws on invalid state', () => {
      const batch = { status: 'INVALID_STATE' };
      
      expect(() => transition(batch, EVENTS.START_UPDATE)).toThrow('Invalid current state');
    });
    
    test('throws on invalid event', () => {
      const batch = { status: STATES.PENDING };
      
      expect(() => transition(batch, 'INVALID_EVENT')).toThrow('Invalid event');
    });
  });
  
  describe('validateTransition', () => {
    test('validates valid transitions', () => {
      expect(validateTransition(STATES.PENDING, EVENTS.START_UPDATE)).toBe(true);
      expect(validateTransition(STATES.UPDATING, EVENTS.UPDATE_COMPLETE)).toBe(true);
      expect(validateTransition(STATES.TESTING, EVENTS.TESTS_PASS)).toBe(true);
      expect(validateTransition(STATES.AUDITING, EVENTS.AUDIT_PASS)).toBe(true);
    });
    
    test('rejects invalid transitions', () => {
      expect(validateTransition(STATES.PENDING, EVENTS.TESTS_PASS)).toBe(false);
      expect(validateTransition(STATES.SUCCESS, EVENTS.START_UPDATE)).toBe(false);
      expect(validateTransition(STATES.FAILED, EVENTS.AUDIT_PASS)).toBe(false);
    });
    
    test('handles invalid states/events', () => {
      expect(validateTransition('INVALID', EVENTS.START_UPDATE)).toBe(false);
      expect(validateTransition(STATES.PENDING, 'INVALID')).toBe(false);
    });
  });
  
  describe('getValidEvents', () => {
    test('returns valid events for PENDING state', () => {
      const events = getValidEvents(STATES.PENDING);
      expect(events).toContain(EVENTS.START_UPDATE);
      expect(events.length).toBe(1);
    });
    
    test('returns valid events for UPDATING state', () => {
      const events = getValidEvents(STATES.UPDATING);
      expect(events).toContain(EVENTS.UPDATE_COMPLETE);
      expect(events).toContain(EVENTS.UPDATE_FAILED);
      expect(events.length).toBe(2);
    });
    
    test('returns empty array for terminal states', () => {
      expect(getValidEvents(STATES.SUCCESS)).toEqual([]);
      expect(getValidEvents(STATES.FAILED)).toEqual([]);
    });
    
    test('returns empty array for invalid state', () => {
      expect(getValidEvents('INVALID')).toEqual([]);
    });
  });
  
  describe('isTerminalState', () => {
    test('identifies terminal states', () => {
      expect(isTerminalState(STATES.SUCCESS)).toBe(true);
      expect(isTerminalState(STATES.FAILED)).toBe(true);
    });
    
    test('identifies non-terminal states', () => {
      expect(isTerminalState(STATES.PENDING)).toBe(false);
      expect(isTerminalState(STATES.UPDATING)).toBe(false);
      expect(isTerminalState(STATES.TESTING)).toBe(false);
      expect(isTerminalState(STATES.AUDITING)).toBe(false);
      expect(isTerminalState(STATES.ROLLING_BACK)).toBe(false);
    });
  });
  
  describe('getStateDescription', () => {
    test('returns descriptions for all states', () => {
      expect(getStateDescription(STATES.PENDING)).toContain('waiting');
      expect(getStateDescription(STATES.UPDATING)).toContain('npm install');
      expect(getStateDescription(STATES.TESTING)).toContain('test suite');
      expect(getStateDescription(STATES.AUDITING)).toContain('security audit');
      expect(getStateDescription(STATES.SUCCESS)).toContain('passed');
      expect(getStateDescription(STATES.ROLLING_BACK)).toContain('Restoring');
      expect(getStateDescription(STATES.FAILED)).toContain('failed');
    });
    
    test('returns unknown for invalid state', () => {
      expect(getStateDescription('INVALID')).toContain('Unknown');
    });
  });
});

