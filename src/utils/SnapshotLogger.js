import log from 'electron-log/renderer';

/**
 * Structured logger for VirtualFS snapshot operations
 * Provides consistent logging format for debugging and monitoring
 */
export class SnapshotLogger {
    constructor(sandboxName) {
        this.sandboxName = sandboxName;
    }

    /**
     * Log the start of a snapshot operation
     * @param {string} operation - Operation name (create, restore, delete, etc.)
     * @param {Object} context - Operation context (version, fileCount, etc.)
     */
    logStart(operation, context = {}) {
        log.info(`[${this.sandboxName}] Snapshot.${operation}.start`, {
            version: context.version || 'new',
            fileCount: context.fileCount || 0,
            usage: context.usage || null,
            quota: context.quota || null,
            percent: context.percent || null,
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Log the successful completion of a snapshot operation
     * @param {string} operation - Operation name
     * @param {Object} context - Operation context including duration
     */
    logComplete(operation, context = {}) {
        log.info(`[${this.sandboxName}] Snapshot.${operation}.complete`, {
            version: context.version || 'unknown',
            duration: context.duration || 0,
            fileCount: context.fileCount || 0,
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Log an error during a snapshot operation
     * @param {string} operation - Operation name
     * @param {Error} error - The error object
     * @param {Object} context - Additional context (version, failurePoint, etc.)
     */
    logError(operation, error, context = {}) {
        log.error(`[${this.sandboxName}] Snapshot.${operation}.error`, {
            version: context.version || 'unknown',
            error: error.message,
            stack: error.stack,
            failurePoint: context.failurePoint || 'unknown',
            fileCount: context.fileCount || 0,
            path: context.path || null,
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Log a rollback operation
     * @param {string} operation - Operation name that triggered rollback
     * @param {Object} context - Rollback context (version, reason)
     */
    logRollback(operation, context = {}) {
        log.warn(`[${this.sandboxName}] Snapshot.${operation}.rollback`, {
            version: context.version || 'unknown',
            reason: context.reason || 'Operation failed',
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Log Monaco model disposal (debug level)
     * @param {string} path - File path of the disposed model
     */
    logModelDisposal(path) {
        log.debug(`[${this.sandboxName}] Model.dispose`, {
            path,
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Log external change detection (multi-window sync)
     * @param {Object} context - Change context
     */
    logExternalChange(context = {}) {
        log.info(`[${this.sandboxName}] Snapshot.externalChange`, {
            externalLatest: context.externalLatest || null,
            externalCurrent: context.externalCurrent || null,
            localLatest: context.localLatest || null,
            localCurrent: context.localCurrent || null,
            timestamp: new Date().toISOString()
        });
    }
}

