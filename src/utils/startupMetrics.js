/**
 * Startup Metrics Module
 * 
 * Tracks application launch performance from process start to interactive UI.
 * Logs metrics to both console (developer feedback) and file (historical analysis).
 * 
 * Based on specs/001-app-loading-improvement/data-model.md
 */

import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { v4 as uuidv4 } from 'uuid';

// State
let startTime = null;
let lastEventTime = null;
let sessionId = null;
let logFilePath = null;
let appVersion = null;
let electronVersion = null;
let logBuffer = []; // Buffer for logs before file system is ready
let isReady = false; // Track if app is ready

/**
 * Initialize metrics tracking
 * Must be called as early as possible in main process
 * 
 * @returns {string} Session UUID for this startup
 */
function initMetrics() {
  // Capture start time with high-resolution timer
  startTime = process.hrtime.bigint();
  lastEventTime = startTime;
  
  // Generate unique session ID
  sessionId = uuidv4();
  
  // Get versions immediately (these work before app.ready)
  electronVersion = process.versions.electron;
  
  // Log the first event (will be buffered)
  logMetric('process-start', { note: 'Metrics initialized' });
  
  // Set up file logging when app is ready
  if (app.isReady()) {
    setupLogging();
  } else {
    app.whenReady().then(setupLogging);
  }
  
  return sessionId;
}

/**
 * Set up logging infrastructure after app is ready
 * @private
 */
function setupLogging() {
  try {
    // Now we can safely get app paths
    appVersion = app.getVersion();
    
    const userDataPath = app.getPath('userData');
    const logsDir = path.join(userDataPath, 'logs');
    logFilePath = path.join(logsDir, 'startup.log');
    
    // Ensure logs directory exists
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    
    isReady = true;
    
    // Flush buffered logs to file
    if (logBuffer.length > 0) {
      for (const entry of logBuffer) {
        writeLogEntry(entry);
      }
      logBuffer = [];
    }
  } catch (error) {
    console.error('[STARTUP] Failed to setup logging:', error.message);
  }
}

/**
 * Log a startup metric event
 * 
 * @param {string} event - Event name (e.g., 'app-ready', 'window-created')
 * @param {object} metadata - Optional event-specific metadata
 */
function logMetric(event, metadata = {}) {
  if (!startTime) {
    console.warn('[STARTUP] Metrics not initialized. Call initMetrics() first.');
    return;
  }
  
  const now = process.hrtime.bigint();
  const elapsed = getElapsedTime();
  const delta = getDeltaTime(now);
  
  // Update last event time
  lastEventTime = now;
  
  // Capture resource usage
  const resources = captureResourceUsage();
  
  // Build log entry
  const entry = {
    event,
    timestamp: now.toString(),
    elapsed: `${elapsed}ms`,
    delta: `${delta}ms`,
    platform: process.platform,
    arch: process.arch,
    startupType: elapsed < 5000 ? 'warm' : 'cold', // Heuristic: <5s likely warm start
    session: sessionId,
    version: appVersion,
    electronVersion,
    // Resource usage
    memory: resources.memory,
    cpu: resources.cpu,
    ...metadata
  };
  
  // Add slow flag if exceeds threshold
  if (isSlowStartup()) {
    entry.slow = true;
  }
  
  // Add resource warnings
  if (resources.memory.rss > 300 * 1024 * 1024) { // >300 MB
    entry.memoryWarning = true;
  }
  
  // Console output (synchronous, immediate feedback)
  const slowFlag = entry.slow ? ' ⚠️ SLOW' : '';
  const memFlag = entry.memoryWarning ? ' 🔥 HIGH MEMORY' : '';
  console.log(`[STARTUP${slowFlag}${memFlag}] ${event}: ${elapsed}ms (Δ${delta}ms) [MEM: ${formatMemory(resources.memory.rss)}, CPU: ${resources.cpu.toFixed(1)}%]`, metadata);
  
  // File output (asynchronous, non-blocking)
  writeLogEntry(entry);
}

/**
 * Capture current resource usage (memory and CPU)
 * 
 * @returns {object} Resource usage data
 * @private
 */
function captureResourceUsage() {
  const memUsage = process.memoryUsage();
  const cpuUsage = process.cpuUsage();
  
  return {
    memory: {
      rss: memUsage.rss,               // Resident Set Size (total memory)
      heapTotal: memUsage.heapTotal,   // V8 heap allocated
      heapUsed: memUsage.heapUsed,     // V8 heap used
      external: memUsage.external,      // C++ objects
      arrayBuffers: memUsage.arrayBuffers,
    },
    cpu: calculateCPUPercent(cpuUsage), // CPU percentage
  };
}

/**
 * Calculate CPU usage percentage
 * 
 * @param {object} cpuUsage - process.cpuUsage() result
 * @returns {number} CPU percentage (0-100+)
 * @private
 */
let lastCpuUsage = null;
let lastCpuTime = null;

function calculateCPUPercent(cpuUsage) {
  const now = Date.now();
  
  if (!lastCpuUsage || !lastCpuTime) {
    lastCpuUsage = cpuUsage;
    lastCpuTime = now;
    return 0; // First measurement, return 0
  }
  
  const elapsed = now - lastCpuTime; // milliseconds
  if (elapsed === 0) return 0;
  
  const userDelta = cpuUsage.user - lastCpuUsage.user; // microseconds
  const systemDelta = cpuUsage.system - lastCpuUsage.system; // microseconds
  const totalDelta = userDelta + systemDelta;
  
  // Convert to percentage: (microseconds of CPU time / microseconds elapsed) * 100
  const percent = (totalDelta / (elapsed * 1000)) * 100;
  
  lastCpuUsage = cpuUsage;
  lastCpuTime = now;
  
  return Math.min(percent, 999); // Cap at 999% for multi-core systems
}

/**
 * Format memory size for display
 * 
 * @param {number} bytes - Memory size in bytes
 * @returns {string} Formatted string (e.g., "45.2 MB")
 * @private
 */
function formatMemory(bytes) {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

/**
 * Get elapsed time since process start in milliseconds
 * 
 * @returns {number} Milliseconds since initMetrics() was called
 */
function getElapsedTime() {
  if (!startTime) return 0;
  
  const now = process.hrtime.bigint();
  const elapsedNs = now - startTime;
  const elapsedMs = Number(elapsedNs) / 1_000_000; // Convert nanoseconds to milliseconds
  
  return Math.round(elapsedMs);
}

/**
 * Get time since last event in milliseconds
 * 
 * @param {bigint} now - Current time from process.hrtime.bigint()
 * @returns {number} Milliseconds since last logMetric() call
 */
function getDeltaTime(now) {
  if (!lastEventTime) return 0;
  
  const deltaNs = now - lastEventTime;
  const deltaMs = Number(deltaNs) / 1_000_000;
  
  return Math.round(deltaMs);
}

/**
 * Check if startup is considered slow (>4.5 seconds)
 * 
 * @returns {boolean} True if elapsed time exceeds 4500ms threshold
 */
function isSlowStartup() {
  const elapsed = getElapsedTime();
  return elapsed > 4500;
}

/**
 * Log a startup error
 * 
 * @param {string} phase - Which startup phase failed (e.g., 'window-creation', 'file-loading')
 * @param {Error} error - The error object
 * @param {object} context - Additional context about the error
 */
function logStartupError(phase, error, context = {}) {
  console.error(`[STARTUP ERROR] ${phase}:`, error.message, context);
  
  const entry = {
    event: `error:${phase}`,
    timestamp: process.hrtime.bigint().toString(),
    elapsed: `${getElapsedTime()}ms`,
    error: {
      message: error.message,
      stack: error.stack,
      name: error.name,
    },
    platform: process.platform,
    arch: process.arch,
    session: sessionId,
    version: appVersion,
    electronVersion,
    ...context
  };
  
  writeLogEntry(entry);
}

/**
 * Show slow startup warning if threshold exceeded
 * 
 * @param {string} phase - Which phase triggered the warning
 * @returns {boolean} True if warning was shown
 */
function checkSlowStartupWarning(phase) {
  if (isSlowStartup()) {
    const elapsed = getElapsedTime();
    console.warn(`[STARTUP WARNING] Slow startup detected at ${phase}: ${elapsed}ms`);
    console.warn('[STARTUP WARNING] Target: <3000ms cold, <2000ms warm');
    console.warn('[STARTUP WARNING] Check startup logs for bottlenecks');
    
    logMetric('slow-startup-warning', {
      phase,
      threshold: 4500,
      actual: elapsed,
      performance: 'degraded',
    });
    
    return true;
  }
  return false;
}

/**
 * Write log entry to file asynchronously
 * 
 * @param {object} entry - Log entry object
 */
function writeLogEntry(entry) {
  // Buffer logs until file system is ready
  if (!isReady || !logFilePath) {
    logBuffer.push(entry);
    return;
  }
  
  // Convert to NDJSON format (newline-delimited JSON)
  const line = JSON.stringify(entry) + '\n';
  
  // Async append (non-blocking)
  fs.appendFile(logFilePath, line, 'utf-8', (err) => {
    if (err) {
      console.error('[STARTUP] Failed to write log:', err.message);
    }
  });
}

/**
 * Get the log file path
 * 
 * @returns {string|null} Path to startup.log file
 */
function getLogFilePath() {
  return logFilePath;
}

/**
 * Get the current session ID
 * 
 * @returns {string|null} UUID for this startup session
 */
function getSessionId() {
  return sessionId;
}

// Export API
export {
  initMetrics,
  logMetric,
  getElapsedTime,
  isSlowStartup,
  logStartupError,
  checkSlowStartupWarning,
  getLogFilePath,
  getSessionId
};

