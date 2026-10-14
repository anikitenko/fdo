/**
 * UpdateBatch state machine
 * 
 * Manages state transitions for package update batches
 * 
 * States: PENDING → UPDATING → TESTING → AUDITING → SUCCESS
 *                      ↓          ↓          ↓
 *                  ROLLING_BACK → FAILED
 * 
 * @module packageUpdater/stateMachine
 */

// State definitions
const STATES = {
  PENDING: 'PENDING',
  UPDATING: 'UPDATING',
  TESTING: 'TESTING',
  AUDITING: 'AUDITING',
  SUCCESS: 'SUCCESS',
  ROLLING_BACK: 'ROLLING_BACK',
  FAILED: 'FAILED'
};

// Event definitions
const EVENTS = {
  START_UPDATE: 'startUpdate',
  UPDATE_COMPLETE: 'updateComplete',
  UPDATE_FAILED: 'updateFailed',
  TESTS_PASS: 'testsPass',
  TESTS_FAIL: 'testsFail',
  AUDIT_PASS: 'auditPass',
  AUDIT_FAIL: 'auditFail',
  ROLLBACK_COMPLETE: 'rollbackComplete'
};

// Valid state transitions
const TRANSITIONS = {
  [STATES.PENDING]: {
    [EVENTS.START_UPDATE]: STATES.UPDATING
  },
  [STATES.UPDATING]: {
    [EVENTS.UPDATE_COMPLETE]: STATES.TESTING,
    [EVENTS.UPDATE_FAILED]: STATES.ROLLING_BACK
  },
  [STATES.TESTING]: {
    [EVENTS.TESTS_PASS]: STATES.AUDITING,
    [EVENTS.TESTS_FAIL]: STATES.ROLLING_BACK
  },
  [STATES.AUDITING]: {
    [EVENTS.AUDIT_PASS]: STATES.SUCCESS,
    [EVENTS.AUDIT_FAIL]: STATES.ROLLING_BACK
  },
  [STATES.ROLLING_BACK]: {
    [EVENTS.ROLLBACK_COMPLETE]: STATES.FAILED
  },
  [STATES.SUCCESS]: {},
  [STATES.FAILED]: {}
};

/**
 * Transition batch to new state based on event
 * 
 * @param {Object} batch - Update batch with current status
 * @param {string} event - Event triggering transition
 * @returns {string} New state
 * @throws {Error} If transition is invalid
 */
function transition(batch, event) {
  const currentState = batch.status;
  
  // Validate current state
  if (!STATES[currentState]) {
    throw new Error(`Invalid current state: ${currentState}`);
  }
  
  // Validate event (check if event is in EVENTS values)
  const validEvents = Object.values(EVENTS);
  if (!validEvents.includes(event)) {
    throw new Error(`Invalid event: ${event}`);
  }
  
  // Check if transition is valid
  const validTransitions = TRANSITIONS[currentState];
  if (!validTransitions || !validTransitions[event]) {
    throw new Error(
      `Invalid transition: Cannot transition from ${currentState} on event ${event}`
    );
  }
  
  const newState = validTransitions[event];
  
  // Update batch status
  batch.status = newState;
  
  // Set completedAt timestamp for terminal states
  if (newState === STATES.SUCCESS || newState === STATES.FAILED) {
    batch.completedAt = new Date().toISOString();
  }
  
  return newState;
}

/**
 * Validate if a transition is possible
 * 
 * @param {string} fromState - Current state
 * @param {string} event - Event to check
 * @returns {boolean} True if transition is valid
 */
function validateTransition(fromState, event) {
  if (!STATES[fromState]) {
    return false;
  }
  
  const validEvents = Object.values(EVENTS);
  if (!validEvents.includes(event)) {
    return false;
  }
  
  const validTransitions = TRANSITIONS[fromState];
  return !!(validTransitions && validTransitions[event]);
}

/**
 * Get all valid events for a given state
 * 
 * @param {string} state - State to check
 * @returns {string[]} Array of valid event names
 */
function getValidEvents(state) {
  if (!STATES[state]) {
    return [];
  }
  
  const validTransitions = TRANSITIONS[state];
  return Object.keys(validTransitions || {});
}

/**
 * Check if state is terminal (SUCCESS or FAILED)
 * 
 * @param {string} state - State to check
 * @returns {boolean} True if state is terminal
 */
function isTerminalState(state) {
  return state === STATES.SUCCESS || state === STATES.FAILED;
}

/**
 * Get state description for logging
 * 
 * @param {string} state - State to describe
 * @returns {string} Human-readable description
 */
function getStateDescription(state) {
  const descriptions = {
    [STATES.PENDING]: 'Batch created, waiting to start',
    [STATES.UPDATING]: 'Running npm install with updated package.json',
    [STATES.TESTING]: 'Running test suite to validate updates',
    [STATES.AUDITING]: 'Running security audit on updated packages',
    [STATES.SUCCESS]: 'All checks passed, changes committed',
    [STATES.ROLLING_BACK]: 'Restoring from checkpoint due to failure',
    [STATES.FAILED]: 'Rollback complete, batch failed'
  };
  
  return descriptions[state] || 'Unknown state';
}

module.exports = {
  STATES,
  EVENTS,
  TRANSITIONS,
  transition,
  validateTransition,
  getValidEvents,
  isTerminalState,
  getStateDescription
};

