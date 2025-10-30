import React, { useState, useEffect } from 'react';
import { ProgressBar, Intent, Callout } from '@blueprintjs/core';
import * as styles from './SnapshotProgress.module.css';

/**
 * SnapshotProgress Component
 * Displays progress feedback during snapshot create/restore operations
 * Subscribes to 'snapshotProgress' and 'operationRollback' notifications
 */
const SnapshotProgress = ({ notifications }) => {
    const [progress, setProgress] = useState(null);
    const [rollback, setRollback] = useState(null);
    const [error, setError] = useState(null);
    const [warning, setWarning] = useState(null);

    useEffect(() => {
        if (!notifications) return;

        // Subscribe to snapshot progress notifications
        const progressUnsubscribe = notifications.subscribe('snapshotProgress', (data) => {
            setProgress(data);
            
            // Clear progress after completion
            if (data.complete) {
                setTimeout(() => {
                    setProgress(null);
                }, 2000); // Keep success message visible for 2s
            }
          });

        // Subscribe to rollback notifications
        const rollbackUnsubscribe = notifications.subscribe('operationRollback', (data) => {
            setRollback(data);
            setProgress(null); // Clear progress on rollback
            
            // Clear rollback message after 5s
            setTimeout(() => {
                setRollback(null);
            }, 5000);
        });

        // Subscribe to error notifications
        const errorUnsubscribe = notifications.subscribe('snapshotError', (data) => {
            setError(data);
            setProgress(null); // Clear progress on error
            
            // Clear error after 5s
            setTimeout(() => {
                setError(null);
            }, 5000);
        });

        // Subscribe to snapshot warnings (for multi-window scenarios)
        const snapshotWarningUnsubscribe = notifications.subscribe('snapshotWarning', (data) => {
            setWarning(data);
            
            // Clear warning after 5s
            setTimeout(() => {
                setWarning(null);
            }, 5000);
        });

        // Subscribe to storage warnings
        const storageUnsubscribe = notifications.subscribe('storageWarning', (data) => {
            if (data.severity === 'critical') {
                // Critical storage (>=95%) - show as blocking error
                setError({
                    operation: 'storage',
                    message: `Storage critically full: ${data.percent}% used (${data.usage}MB / ${data.quota}MB). Delete old snapshots to free up space.`,
                    critical: true
                });
            } else if (data.severity === 'warning') {
                // Warning storage (80-94%) - show as toast
                setWarning({
                    message: `Storage usage high: ${data.percent}% used (${data.usage}MB / ${data.quota}MB)`,
                    severity: 'warning'
                });
                
                // Auto-clear after 8s
                setTimeout(() => {
                    setWarning(null);
                }, 8000);
            }
        });

        return () => {
            progressUnsubscribe?.();
            rollbackUnsubscribe?.();
            errorUnsubscribe?.();
            snapshotWarningUnsubscribe?.();
            storageUnsubscribe?.();
        };
    }, [notifications]);

    // Don't render if nothing to show
    if (!progress && !rollback && !error && !warning) {
        return null;
    }

    return (
        <div className={styles.snapshotProgressContainer}>
            {/* Progress Bar */}
            {progress && !progress.complete && (
                <div className={styles.snapshotProgress}>
                    <div className={styles.snapshotProgressHeader}>
                        <span className={styles.snapshotProgressOperation}>
                            {progress.operation === 'create' ? 'Creating Snapshot' : 'Restoring Snapshot'}
                        </span>
                        <span className={styles.snapshotProgressStage}>{progress.stage}</span>
                    </div>
                    <ProgressBar
                        value={progress.progress / 100}
                        intent={Intent.PRIMARY}
                        stripes={false}
                        animate={true}
                    />
                    {progress.filesProcessed && (
                        <div className={styles.snapshotProgressDetails}>
                            {progress.filesProcessed} / {progress.totalFiles} files
                        </div>
                    )}
                    {progress.fileCount && !progress.filesProcessed && (
                        <div className={styles.snapshotProgressDetails}>
                            {progress.fileCount} files
                        </div>
                    )}
                </div>
            )}

            {/* Success Message */}
            {progress && progress.complete && (
                <Callout 
                    intent={Intent.SUCCESS} 
                    className={styles.snapshotMessage}
                >
                    <strong>
                        {progress.operation === 'create' ? 'Snapshot Created' : 'Snapshot Restored'}
                    </strong>
                    {progress.version && (
                        <div className={styles.snapshotMessageDetails}>
                            Version: {progress.version.substring(0, 8)}
                            {progress.fileCount && ` • ${progress.fileCount} files`}
                            {progress.duration && ` • ${
                                progress.duration < 1000 
                                    ? `${progress.duration}ms` 
                                    : `${(progress.duration / 1000).toFixed(1)}s`
                            }`}
                        </div>
                    )}
                </Callout>
            )}

            {/* Rollback Warning */}
            {rollback && (
                <Callout 
                    intent={Intent.WARNING} 
                    className={styles.snapshotMessage}
                >
                    <strong>Operation Rolled Back</strong>
                    <div className={styles.snapshotMessageDetails}>
                        {rollback.message || 'Operation failed and was rolled back to previous state'}
                    </div>
                </Callout>
            )}

            {/* Warning Message */}
            {warning && (
                <Callout 
                    intent={Intent.WARNING} 
                    className={styles.snapshotMessage}
                >
                    <strong>Warning</strong>
                    <div className={styles.snapshotMessageDetails}>
                        {warning.message}
                    </div>
                </Callout>
            )}

            {/* Error Message */}
            {error && (
                <Callout 
                    intent={Intent.DANGER} 
                    className={styles.snapshotMessage}
                >
                    <strong>
                        {error.operation === 'storage' ? 'Storage Critical' : 'Snapshot Error'}
                    </strong>
                    <div className={styles.snapshotMessageDetails}>
                        {error.message || 'An error occurred during the snapshot operation'}
                    </div>
                </Callout>
            )}
        </div>
    );
};

export default SnapshotProgress;

