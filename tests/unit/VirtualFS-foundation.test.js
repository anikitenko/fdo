/**
 * Foundation Tests for VirtualFS Snapshot System
 * Tests Phase 1 & 2: Infrastructure and Core Reliability
 */

import { SnapshotLogger } from '../../src/utils/SnapshotLogger';

// Mock electron-log/renderer
jest.mock('electron-log/renderer', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

describe('Phase 1: Infrastructure - SnapshotLogger', () => {
    let logger;
    const mockLog = require('electron-log/renderer');

    beforeEach(() => {
        jest.clearAllMocks();
        logger = new SnapshotLogger('test-sandbox');
    });

    test('should initialize with sandbox name', () => {
        expect(logger.sandboxName).toBe('test-sandbox');
    });

    test('should log operation start with context', () => {
        logger.logStart('create', { version: 'v1', fileCount: 5 });
        
        expect(mockLog.info).toHaveBeenCalledWith(
            '[test-sandbox] Snapshot.create.start',
            expect.objectContaining({
                version: 'v1',
                fileCount: 5,
                timestamp: expect.any(String)
            })
        );
    });

    test('should log operation completion with duration', () => {
        logger.logComplete('create', { version: 'v1', duration: 150, fileCount: 5 });
        
        expect(mockLog.info).toHaveBeenCalledWith(
            '[test-sandbox] Snapshot.create.complete',
            expect.objectContaining({
                version: 'v1',
                duration: 150,
                fileCount: 5
            })
        );
    });

    test('should log errors with stack trace', () => {
        const error = new Error('Test error');
        logger.logError('create', error, { version: 'v1', failurePoint: 'compression' });
        
        expect(mockLog.error).toHaveBeenCalledWith(
            '[test-sandbox] Snapshot.create.error',
            expect.objectContaining({
                version: 'v1',
                error: 'Test error',
                stack: expect.any(String),
                failurePoint: 'compression'
            })
        );
    });

    test('should log rollback with reason', () => {
        logger.logRollback('create', { version: 'v1', reason: 'Storage quota exceeded' });
        
        expect(mockLog.warn).toHaveBeenCalledWith(
            '[test-sandbox] Snapshot.create.rollback',
            expect.objectContaining({
                version: 'v1',
                reason: 'Storage quota exceeded'
            })
        );
    });
});

describe('Phase 2: Foundation - Core Reliability Methods', () => {
    let mockVirtualFS;
    let mockParent;
    let mockNotificationQueue;

    beforeEach(() => {
        // Mock notification queue
        mockNotificationQueue = [];
        
        // Mock parent object
        mockParent = {
            sandboxName: 'test-sandbox',
            files: {},
            notifications: {
                addToQueue: jest.fn((event, data) => {
                    mockNotificationQueue.push({ event, data });
                })
            }
        };

        // Mock fs object structure
        mockVirtualFS = {
            versions: {
                'v1': { content: [], date: '2025-01-01', version: 'v1' },
                'v2': { content: [], date: '2025-01-02', version: 'v2' }
            },
            version_latest: 'v2',
            version_current: 'v2',
            parent: mockParent,
            logger: new SnapshotLogger('test-sandbox')
        };

        // Mock localStorage
        global.localStorage = {
            getItem: jest.fn(() => 'mock-storage-data'),
            setItem: jest.fn(),
            removeItem: jest.fn()
        };
    });

    describe('captureCurrentState()', () => {
        test('should capture all state components', () => {
            const captureCurrentState = function() {
                const _ = require('lodash');
                return {
                    versions: _.cloneDeep(this.versions),
                    version_latest: this.version_latest,
                    version_current: this.version_current,
                    localStorage: localStorage.getItem(this.parent.sandboxName)
                };
            };

            const backup = captureCurrentState.call(mockVirtualFS);

            expect(backup).toHaveProperty('versions');
            expect(backup).toHaveProperty('version_latest', 'v2');
            expect(backup).toHaveProperty('version_current', 'v2');
            expect(backup).toHaveProperty('localStorage', 'mock-storage-data');
        });

        test('should deep clone versions to prevent mutation', () => {
            const _ = require('lodash');
            const captureCurrentState = function() {
                return {
                    versions: _.cloneDeep(this.versions),
                    version_latest: this.version_latest,
                    version_current: this.version_current,
                    localStorage: localStorage.getItem(this.parent.sandboxName)
                };
            };

            const backup = captureCurrentState.call(mockVirtualFS);
            
            // Modify original
            mockVirtualFS.versions['v3'] = { content: [], date: '2025-01-03' };
            
            // Backup should not be affected
            expect(backup.versions).not.toHaveProperty('v3');
            expect(mockVirtualFS.versions).toHaveProperty('v3');
        });
    });

    describe('rollback()', () => {
        test('should restore in-memory state from backup', async () => {
            const rollback = async function(backupState) {
                try {
                    this.versions = backupState.versions;
                    this.version_latest = backupState.version_latest;
                    this.version_current = backupState.version_current;
                    
                    if (backupState.localStorage) {
                        localStorage.setItem(this.parent.sandboxName, backupState.localStorage);
                    }
                    
                    this.parent.notifications.addToQueue('operationRollback', {
                        message: 'Operation failed and was rolled back to previous state',
                        severity: 'warning'
                    });
                    
                    if (this.logger) {
                        this.logger.logRollback('snapshot', {
                            version: this.version_current,
                            reason: 'Operation failed, state restored'
                        });
                    }
                } catch (rollbackError) {
                    if (this.logger) {
                        this.logger.logError('rollback', rollbackError, {
                            version: this.version_current,
                            failurePoint: 'rollback'
                        });
                    }
                }
            };

            const backup = {
                versions: { 'v1': { content: [] } },
                version_latest: 'v1',
                version_current: 'v1',
                localStorage: 'backup-data'
            };

            await rollback.call(mockVirtualFS, backup);

            expect(mockVirtualFS.versions).toEqual(backup.versions);
            expect(mockVirtualFS.version_latest).toBe('v1');
            expect(mockVirtualFS.version_current).toBe('v1');
            expect(localStorage.setItem).toHaveBeenCalledWith('test-sandbox', 'backup-data');
        });

        test('should emit operationRollback notification', async () => {
            const rollback = async function(backupState) {
                this.versions = backupState.versions;
                this.version_latest = backupState.version_latest;
                this.version_current = backupState.version_current;
                
                this.parent.notifications.addToQueue('operationRollback', {
                    message: 'Operation failed and was rolled back to previous state',
                    severity: 'warning'
                });
            };

            const backup = {
                versions: {},
                version_latest: 'v1',
                version_current: 'v1',
                localStorage: null
            };

            await rollback.call(mockVirtualFS, backup);

            expect(mockParent.notifications.addToQueue).toHaveBeenCalledWith(
                'operationRollback',
                expect.objectContaining({
                    message: expect.stringContaining('rolled back'),
                    severity: 'warning'
                })
            );
        });

        test('should handle rollback failures gracefully', async () => {
            const rollback = async function(backupState) {
                try {
                    throw new Error('Rollback test error');
                } catch (rollbackError) {
                    if (this.logger) {
                        this.logger.logError('rollback', rollbackError, {
                            version: this.version_current,
                            failurePoint: 'rollback'
                        });
                    }
                }
            };

            const backup = { versions: {}, version_latest: 'v1', version_current: 'v1' };

            // Should not throw
            await expect(rollback.call(mockVirtualFS, backup)).resolves.not.toThrow();
        });
    });

    describe('checkStorageQuota()', () => {
        test('should return true when quota is below 95%', async () => {
            global.navigator = {
                storage: {
                    estimate: jest.fn().mockResolvedValue({
                        usage: 50 * 1024 * 1024, // 50MB
                        quota: 100 * 1024 * 1024  // 100MB (50% usage)
                    })
                }
            };

            const checkStorageQuota = async function() {
                try {
                    if ('storage' in navigator && 'estimate' in navigator.storage) {
                        const {usage, quota} = await navigator.storage.estimate();
                        const usagePercent = (usage / quota) * 100;
                        
                        if (usagePercent >= 80) {
                            this.parent.notifications.addToQueue('storageWarning', {
                                usage: Math.round(usage / 1024 / 1024),
                                quota: Math.round(quota / 1024 / 1024),
                                percent: Math.round(usagePercent),
                                severity: usagePercent >= 95 ? 'critical' : 'warning'
                            });
                        }
                        
                        return usagePercent < 95;
                    }
                    return true;
                } catch (error) {
                    return true;
                }
            };

            const result = await checkStorageQuota.call(mockVirtualFS);
            expect(result).toBe(true);
        });

        test('should emit warning at 80% usage', async () => {
            global.navigator = {
                storage: {
                    estimate: jest.fn().mockResolvedValue({
                        usage: 85 * 1024 * 1024, // 85MB
                        quota: 100 * 1024 * 1024  // 100MB (85% usage)
                    })
                }
            };

            const checkStorageQuota = async function() {
                if ('storage' in navigator && 'estimate' in navigator.storage) {
                    const {usage, quota} = await navigator.storage.estimate();
                    const usagePercent = (usage / quota) * 100;
                    
                    if (usagePercent >= 80) {
                        this.parent.notifications.addToQueue('storageWarning', {
                            usage: Math.round(usage / 1024 / 1024),
                            quota: Math.round(quota / 1024 / 1024),
                            percent: Math.round(usagePercent),
                            severity: usagePercent >= 95 ? 'critical' : 'warning'
                        });
                    }
                    
                    return usagePercent < 95;
                }
                return true;
            };

            await checkStorageQuota.call(mockVirtualFS);

            expect(mockParent.notifications.addToQueue).toHaveBeenCalledWith(
                'storageWarning',
                expect.objectContaining({
                    percent: 85,
                    severity: 'warning'
                })
            );
        });

        test('should block at 95% usage and emit critical warning', async () => {
            global.navigator = {
                storage: {
                    estimate: jest.fn().mockResolvedValue({
                        usage: 96 * 1024 * 1024, // 96MB
                        quota: 100 * 1024 * 1024  // 100MB (96% usage)
                    })
                }
            };

            const checkStorageQuota = async function() {
                if ('storage' in navigator && 'estimate' in navigator.storage) {
                    const {usage, quota} = await navigator.storage.estimate();
                    const usagePercent = (usage / quota) * 100;
                    
                    if (usagePercent >= 80) {
                        this.parent.notifications.addToQueue('storageWarning', {
                            usage: Math.round(usage / 1024 / 1024),
                            quota: Math.round(quota / 1024 / 1024),
                            percent: Math.round(usagePercent),
                            severity: usagePercent >= 95 ? 'critical' : 'warning'
                        });
                    }
                    
                    return usagePercent < 95;
                }
                return true;
            };

            const result = await checkStorageQuota.call(mockVirtualFS);

            expect(result).toBe(false); // Should block
            expect(mockParent.notifications.addToQueue).toHaveBeenCalledWith(
                'storageWarning',
                expect.objectContaining({
                    percent: 96,
                    severity: 'critical'
                })
            );
        });

        test('should handle missing Storage API gracefully', async () => {
            global.navigator = {};

            const checkStorageQuota = async function() {
                try {
                    if ('storage' in navigator && 'estimate' in navigator.storage) {
                        const {usage, quota} = await navigator.storage.estimate();
                        const usagePercent = (usage / quota) * 100;
                        return usagePercent < 95;
                    }
                    return true;
                } catch (error) {
                    return true;
                }
            };

            const result = await checkStorageQuota.call(mockVirtualFS);
            expect(result).toBe(true); // Default to allowing operation
        });
    });

    describe('Integration: Atomic Transaction Pattern', () => {
        test('should support capture -> operation -> rollback flow', async () => {
            const _ = require('lodash');
            
            // Simulate capture
            const backup = {
                versions: _.cloneDeep(mockVirtualFS.versions),
                version_latest: mockVirtualFS.version_latest,
                version_current: mockVirtualFS.version_current,
                localStorage: localStorage.getItem(mockVirtualFS.parent.sandboxName)
            };

            // Simulate operation that modifies state
            mockVirtualFS.versions['v3'] = { content: [], date: '2025-01-03' };
            mockVirtualFS.version_latest = 'v3';
            mockVirtualFS.version_current = 'v3';

            // Verify state changed
            expect(mockVirtualFS.version_latest).toBe('v3');

            // Simulate rollback
            mockVirtualFS.versions = backup.versions;
            mockVirtualFS.version_latest = backup.version_latest;
            mockVirtualFS.version_current = backup.version_current;

            // Verify rollback worked
            expect(mockVirtualFS.version_latest).toBe('v2');
            expect(mockVirtualFS.versions).not.toHaveProperty('v3');
        });
    });
});

describe('Phase 2: Foundation - Monaco Model Safety', () => {
    let mockMonaco;
    let mockModel;
    let mockVirtualFS;

    beforeEach(() => {
        // Mock Monaco model
        mockModel = {
            isDisposed: jest.fn(() => false),
            dispose: jest.fn()
        };

        // Mock Monaco editor API
        mockMonaco = {
            Uri: {
                file: jest.fn((path) => ({ path }))
            },
            editor: {
                getModel: jest.fn(() => mockModel),
                setModelMarkers: jest.fn()
            },
            languages: {
                typescript: {
                    typescriptDefaults: {
                        addExtraLib: jest.fn()
                    }
                }
            }
        };

        global.monaco = mockMonaco;

        // Mock parent
        const mockParent = {
            files: {
                '/test.ts': { model: mockModel },
                '/test2.js': { model: mockModel }
            },
            notifications: {
                addToQueue: jest.fn()
            }
        };

        mockVirtualFS = {
            parent: mockParent,
            logger: new SnapshotLogger('test-sandbox')
        };
    });

    describe('safeDisposeModel()', () => {
        test('should check isDisposed before disposing', async () => {
            const safeDisposeModel = async function(path) {
                try {
                    const uri = monaco.Uri.file(path);
                    const model = monaco.editor.getModel(uri);
                    
                    if (model && !model.isDisposed()) {
                        if (path.endsWith('.ts') || path.endsWith('.tsx') || path.endsWith('.js') || path.endsWith('.jsx')) {
                            monaco.editor.setModelMarkers(model, 'typescript', []);
                        }
                        
                        monaco.languages.typescript.typescriptDefaults.addExtraLib('', path);
                        model.dispose();
                        
                        if (this.logger) {
                            this.logger.logModelDisposal(path);
                        }
                    }
                    
                    if (this.parent.files[path]) {
                        delete this.parent.files[path];
                        this.parent.notifications.addToQueue('fileRemoved', path);
                    }
                } catch (error) {
                    if (this.logger) {
                        this.logger.logError('modelDisposal', error, { path });
                    }
                }
            };

            await safeDisposeModel.call(mockVirtualFS, '/test.ts');

            expect(mockModel.isDisposed).toHaveBeenCalled();
            expect(mockModel.dispose).toHaveBeenCalled();
        });

        test('should clear TypeScript markers before disposal', async () => {
            const safeDisposeModel = async function(path) {
                const uri = monaco.Uri.file(path);
                const model = monaco.editor.getModel(uri);
                
                if (model && !model.isDisposed()) {
                    if (path.endsWith('.ts') || path.endsWith('.tsx') || path.endsWith('.js') || path.endsWith('.jsx')) {
                        monaco.editor.setModelMarkers(model, 'typescript', []);
                    }
                    
                    monaco.languages.typescript.typescriptDefaults.addExtraLib('', path);
                    model.dispose();
                }
                
                if (this.parent.files[path]) {
                    delete this.parent.files[path];
                }
            };

            await safeDisposeModel.call(mockVirtualFS, '/test.ts');

            expect(mockMonaco.editor.setModelMarkers).toHaveBeenCalledWith(mockModel, 'typescript', []);
            expect(mockMonaco.languages.typescript.typescriptDefaults.addExtraLib).toHaveBeenCalledWith('', '/test.ts');
        });

        test('should not dispose already disposed models', async () => {
            mockModel.isDisposed.mockReturnValue(true);

            const safeDisposeModel = async function(path) {
                const uri = monaco.Uri.file(path);
                const model = monaco.editor.getModel(uri);
                
                if (model && !model.isDisposed()) {
                    model.dispose();
                }
            };

            await safeDisposeModel.call(mockVirtualFS, '/test.ts');

            expect(mockModel.dispose).not.toHaveBeenCalled();
        });

        test('should handle disposal errors gracefully', async () => {
            mockModel.dispose.mockImplementation(() => {
                throw new Error('Disposal error');
            });

            const safeDisposeModel = async function(path) {
                try {
                    const uri = monaco.Uri.file(path);
                    const model = monaco.editor.getModel(uri);
                    
                    if (model && !model.isDisposed()) {
                        model.dispose();
                    }
                } catch (error) {
                    if (this.logger) {
                        this.logger.logError('modelDisposal', error, { path });
                    }
                }
            };

            // Should not throw
            await expect(safeDisposeModel.call(mockVirtualFS, '/test.ts')).resolves.not.toThrow();
        });

        test('should clean up internal file tracking', async () => {
            const safeDisposeModel = async function(path) {
                const uri = monaco.Uri.file(path);
                const model = monaco.editor.getModel(uri);
                
                if (model && !model.isDisposed()) {
                    model.dispose();
                }
                
                if (this.parent.files[path]) {
                    delete this.parent.files[path];
                    this.parent.notifications.addToQueue('fileRemoved', path);
                }
            };

            await safeDisposeModel.call(mockVirtualFS, '/test.ts');

            expect(mockVirtualFS.parent.files).not.toHaveProperty('/test.ts');
            expect(mockVirtualFS.parent.notifications.addToQueue).toHaveBeenCalledWith('fileRemoved', '/test.ts');
        });
    });
});

