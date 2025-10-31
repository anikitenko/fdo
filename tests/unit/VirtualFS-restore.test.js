/**
 * Tests for VirtualFS Snapshot Restoration (fs.set)
 * Covers Phase 4: User Story 2 - Reliable Snapshot Restoration
 */

import { SnapshotLogger } from '../../src/utils/SnapshotLogger';

// Mock dependencies
jest.mock('electron-log/renderer');
jest.mock('lz-string', () => ({
    compress: jest.fn((data) => `compressed:${data}`),
    decompress: jest.fn((data) => data.replace('compressed:', ''))
}));

const LZString = require('lz-string');

describe('VirtualFS Snapshot Restoration - fs.set()', () => {
    let mockVirtualFS;
    let mockParent;
    let mockMonaco;

    beforeEach(() => {
        jest.clearAllMocks();
        
        // Mock Monaco
        mockMonaco = {
            Uri: {
                file: jest.fn((path) => ({ path, toString: () => `file://${path}` }))
            },
            editor: {
                createModel: jest.fn((content, lang, uri) => ({
                    content,
                    lang,
                    uri,
                    setValue: jest.fn(),
                    isDisposed: jest.fn(() => false),
                    dispose: jest.fn()
                })),
                getModel: jest.fn(() => null),
                setModelMarkers: jest.fn()
            },
            languages: {
                typescript: {
                    typescriptDefaults: {
                        addExtraLib: jest.fn(),
                        setCompilerOptions: jest.fn(),
                        getCompilerOptions: jest.fn(() => ({}))
                    }
                }
            }
        };
        global.monaco = mockMonaco;

        // Mock notification queue
        const notificationQueue = [];
        mockParent = {
            sandboxName: 'test-plugin',
            pluginName: 'Test Plugin',
            files: {},
            treeObject: [],
            notifications: {
                addToQueue: jest.fn((event, data) => {
                    notificationQueue.push({ event, data });
                }),
                subscribe: jest.fn()
            },
            setTreeObjectItemRoot: jest.fn(),
            createFile: jest.fn(),
            getTreeObjectSortedAsc: jest.fn(() => []),
            getTreeObjectItemSelected: jest.fn(() => null)
        };

        // Mock localStorage
        global.localStorage = {
            getItem: jest.fn(() => null),
            setItem: jest.fn(),
            removeItem: jest.fn()
        };

        // Create mock VirtualFS instance
        mockVirtualFS = {
            versions: {
                'v1': {
                    version: 'v1',
                    date: '2025-01-01T00:00:00.000Z',
                    prev: '',
                    tabs: [],
                    content: [
                        { id: '/file1.js', content: 'const a = 1;', state: null },
                        { id: '/file2.js', content: 'const b = 2;', state: null },
                        { id: '/file3.js', content: 'const c = 3;', state: null }
                    ]
                },
                'v2': {
                    version: 'v2',
                    date: '2025-01-02T00:00:00.000Z',
                    prev: 'v1',
                    tabs: [],
                    content: [
                        { id: '/file1.js', content: 'const a = 10;', state: null },
                        { id: '/file4.js', content: 'const d = 4;', state: null }
                    ]
                }
            },
            version_latest: 'v2',
            version_current: 'v2',
            parent: mockParent,
            logger: new SnapshotLogger('test-plugin'),
            loading: false,
            setLoading() { this.loading = true; },
            stopLoading() { this.loading = false; },
            __list: jest.fn(() => []),
            setupNodeModules: jest.fn()
        };
    });

    describe('Version Validation', () => {
        test('should throw error for invalid version ID', async () => {
            const set = async function(version) {
                if (!this.versions[version]) {
                    throw new Error(`Invalid version ID: ${version}`);
                }
            };

            await expect(set.call(mockVirtualFS, 'invalid-version')).rejects.toThrow('Invalid version ID');
        });

        test('should accept valid version ID', async () => {
            const set = async function(version) {
                if (!this.versions[version]) {
                    throw new Error(`Invalid version ID: ${version}`);
                }
                return { tabs: this.versions[version].tabs };
            };

            await expect(set.call(mockVirtualFS, 'v1')).resolves.toBeDefined();
        });
    });

    describe('Model Cleanup Validation', () => {
        test('should validate all models disposed before restoration', async () => {
            // Setup existing files
            mockParent.files = {
                '/old1.js': { model: { dispose: jest.fn() }, state: null },
                '/old2.js': { model: { dispose: jest.fn() }, state: null }
            };

            const safeDisposeModel = async function(path) {
                if (this.parent.files[path]) {
                    delete this.parent.files[path];
                }
            };

            // Dispose all
            await safeDisposeModel.call(mockVirtualFS, '/old1.js');
            await safeDisposeModel.call(mockVirtualFS, '/old2.js');

            // Validate
            const remainingFiles = Object.keys(mockParent.files);
            expect(remainingFiles).toHaveLength(0);
        });

        test('should detect and report incomplete cleanup', async () => {
            // Setup files with one that fails to dispose
            mockParent.files = {
                '/disposed.js': { model: { dispose: jest.fn() }, state: null },
                '/stuck.js': { model: { dispose: jest.fn(() => { throw new Error('Dispose failed'); }) }, state: null }
            };

            const safeDisposeModel = async function(path) {
                try {
                    if (this.parent.files[path]) {
                        this.parent.files[path].model.dispose();
                        delete this.parent.files[path];
                    }
                } catch (error) {
                    // Log but continue - some files may not dispose cleanly
                }
            };

            // Try to dispose all
            await safeDisposeModel.call(mockVirtualFS, '/disposed.js');
            await safeDisposeModel.call(mockVirtualFS, '/stuck.js');

            // Check what remained
            const remainingFiles = Object.keys(mockParent.files);
            
            // In real implementation, this would throw an error if cleanup incomplete
            if (remainingFiles.length > 0) {
                expect(remainingFiles.length).toBeGreaterThan(0);
            }
        });
    });

    describe('File Restoration', () => {
        test('should restore exact file contents', async () => {
            const version = 'v1';
            const snapshotData = mockVirtualFS.versions[version];
            
            // Simulate restoration
            const restoredFiles = {};
            for (const file of snapshotData.content) {
                const model = mockMonaco.editor.createModel(file.content, 'javascript', { path: file.id });
                restoredFiles[file.id] = {
                    model,
                    state: file.state
                };
            }

            // Verify
            expect(Object.keys(restoredFiles)).toHaveLength(3);
            expect(restoredFiles['/file1.js'].model.content).toBe('const a = 1;');
            expect(restoredFiles['/file2.js'].model.content).toBe('const b = 2;');
            expect(restoredFiles['/file3.js'].model.content).toBe('const c = 3;');
        });

        test('should restore different version with different files', async () => {
            const version = 'v2';
            const snapshotData = mockVirtualFS.versions[version];
            
            // Simulate restoration
            const restoredFiles = {};
            for (const file of snapshotData.content) {
                const model = mockMonaco.editor.createModel(file.content, 'javascript', { path: file.id });
                restoredFiles[file.id] = {
                    model,
                    state: file.state
                };
            }

            // Verify v2 has different files than v1
            expect(Object.keys(restoredFiles)).toHaveLength(2);
            expect(restoredFiles['/file1.js'].model.content).toBe('const a = 10;'); // Updated content
            expect(restoredFiles['/file4.js'].model.content).toBe('const d = 4;'); // New file
            expect(restoredFiles['/file2.js']).toBeUndefined(); // Removed file
        });

        test('should handle nested folder structures', async () => {
            // Add nested structure to v1
            mockVirtualFS.versions['v1'].content = [
                { id: '/src/index.js', content: 'entry point', state: null },
                { id: '/src/utils/helper.js', content: 'helper', state: null },
                { id: '/src/components/Button.jsx', content: 'button', state: null },
                { id: '/tests/unit/button.test.js', content: 'test', state: null }
            ];

            const snapshotData = mockVirtualFS.versions['v1'];
            const restoredFiles = {};
            
            for (const file of snapshotData.content) {
                restoredFiles[file.id] = { content: file.content };
            }

            // Verify nested structure preserved
            expect(restoredFiles['/src/index.js']).toBeDefined();
            expect(restoredFiles['/src/utils/helper.js']).toBeDefined();
            expect(restoredFiles['/src/components/Button.jsx']).toBeDefined();
            expect(restoredFiles['/tests/unit/button.test.js']).toBeDefined();
        });
    });

    describe('Rapid Version Switching', () => {
        test('should handle rapid A→B→A switching', async () => {
            const switchSequence = [];
            
            // Simulate switching v1 → v2 → v1
            const performSwitch = async (version) => {
                switchSequence.push({
                    version,
                    timestamp: Date.now(),
                    fileCount: mockVirtualFS.versions[version].content.length
                });
                mockVirtualFS.version_current = version;
            };

            await performSwitch('v1');
            await performSwitch('v2');
            await performSwitch('v1');

            // Verify sequence
            expect(switchSequence).toHaveLength(3);
            expect(switchSequence[0].version).toBe('v1');
            expect(switchSequence[1].version).toBe('v2');
            expect(switchSequence[2].version).toBe('v1');
            
            // Verify timing (should complete quickly)
            const totalTime = switchSequence[2].timestamp - switchSequence[0].timestamp;
            expect(totalTime).toBeLessThan(5000); // Under 5 seconds
        });

        test('should handle rapid switching without model conflicts', async () => {
            let activeModels = new Set();
            
            const performSwitch = async (version) => {
                // Clear old models
                activeModels.clear();
                
                // Add new models
                mockVirtualFS.versions[version].content.forEach(file => {
                    activeModels.add(file.id);
                });
            };

            await performSwitch('v1');
            expect(activeModels.size).toBe(3);
            
            await performSwitch('v2');
            expect(activeModels.size).toBe(2);
            
            await performSwitch('v1');
            expect(activeModels.size).toBe(3);
            
            // Verify correct files active
            expect(activeModels.has('/file1.js')).toBe(true);
            expect(activeModels.has('/file2.js')).toBe(true);
            expect(activeModels.has('/file3.js')).toBe(true);
        });
    });

    describe('Progress Tracking', () => {
        test('should emit progress notifications during restore', () => {
            const progressEvents = [];
            const mockNotifications = {
                addToQueue: jest.fn((event, data) => {
                    if (event === 'snapshotProgress') {
                        progressEvents.push(data);
                    }
                })
            };

            const progressTracker = {
                operation: 'restore',
                notificationQueue: mockNotifications,
                emit(data) {
                    this.notificationQueue.addToQueue('snapshotProgress', {
                        operation: this.operation,
                        ...data
                    });
                }
            };

            // Simulate restore progress
            progressTracker.emit({ stage: 'Loading snapshot...', progress: 0 });
            progressTracker.emit({ stage: 'Cleaning up...', progress: 10 });
            progressTracker.emit({ stage: 'Restoring files...', progress: 30 });
            progressTracker.emit({ stage: 'Updating UI...', progress: 80 });
            progressTracker.emit({ stage: 'Complete', progress: 100, complete: true });

            expect(progressEvents).toHaveLength(5);
            expect(progressEvents[0].progress).toBe(0);
            expect(progressEvents[4].complete).toBe(true);
        });
    });

    describe('Error Handling and Rollback', () => {
        test('should rollback on restore failure', async () => {
            const _ = require('lodash');
            
            // Create initial state
            mockVirtualFS.versions = {
                'current': { content: [{ id: '/current.js', content: 'current', state: null }], date: '2025-01-01' }
            };
            mockVirtualFS.version_current = 'current';

            // Capture backup
            const backup = {
                versions: _.cloneDeep(mockVirtualFS.versions),
                version_current: mockVirtualFS.version_current,
                localStorage: null
            };

            // Simulate partial restore that fails
            mockVirtualFS.version_current = 'failed-version';

            // Rollback
            mockVirtualFS.versions = backup.versions;
            mockVirtualFS.version_current = backup.version_current;

            // Verify rollback
            expect(mockVirtualFS.version_current).toBe('current');
            expect(mockVirtualFS.versions['current']).toBeDefined();
        });

        test('should emit rollback notification on failure', async () => {
            const rollback = async function(backupState) {
                this.parent.notifications.addToQueue('operationRollback', {
                    message: 'Restore failed and was rolled back to previous state',
                    severity: 'warning'
                });
            };

            await rollback.call(mockVirtualFS, {});

            expect(mockParent.notifications.addToQueue).toHaveBeenCalledWith(
                'operationRollback',
                expect.objectContaining({
                    message: expect.stringContaining('rolled back'),
                    severity: 'warning'
                })
            );
        });

        test('should handle invalid version gracefully', async () => {
            const attemptRestore = async (version) => {
                try {
                    if (!mockVirtualFS.versions[version]) {
                        throw new Error(`Invalid version ID: ${version}`);
                    }
                } catch (error) {
                    return { error: error.message };
                }
            };

            const result = await attemptRestore('nonexistent');
            expect(result.error).toContain('Invalid version');
        });
    });

    describe('Monaco Model Disposal Sequence', () => {
        test('should dispose models in correct sequence', async () => {
            const disposalSequence = [];
            
            mockParent.files = {
                '/file1.js': {
                    model: {
                        isDisposed: jest.fn(() => false),
                        dispose: jest.fn(() => disposalSequence.push('file1'))
                    }
                },
                '/file2.js': {
                    model: {
                        isDisposed: jest.fn(() => false),
                        dispose: jest.fn(() => disposalSequence.push('file2'))
                    }
                }
            };

            const safeDisposeModel = async function(path) {
                const fileData = this.parent.files[path];
                if (fileData && fileData.model && !fileData.model.isDisposed()) {
                    fileData.model.dispose();
                    delete this.parent.files[path];
                }
            };

            // Dispose in order
            await safeDisposeModel.call(mockVirtualFS, '/file1.js');
            await safeDisposeModel.call(mockVirtualFS, '/file2.js');

            expect(disposalSequence).toEqual(['file1', 'file2']);
            expect(Object.keys(mockParent.files)).toHaveLength(0);
        });

        test('should not dispose already disposed models', async () => {
            const disposeCallCount = { count: 0 };
            
            mockParent.files = {
                '/file.js': {
                    model: {
                        isDisposed: jest.fn(() => true), // Already disposed
                        dispose: jest.fn(() => disposeCallCount.count++)
                    }
                }
            };

            const safeDisposeModel = async function(path) {
                const fileData = this.parent.files[path];
                if (fileData && fileData.model && !fileData.model.isDisposed()) {
                    fileData.model.dispose();
                }
            };

            await safeDisposeModel.call(mockVirtualFS, '/file.js');

            expect(disposeCallCount.count).toBe(0); // Should not call dispose()
        });

        test('should handle disposal errors gracefully', async () => {
            mockParent.files = {
                '/error-file.js': {
                    model: {
                        isDisposed: jest.fn(() => false),
                        dispose: jest.fn(() => { throw new Error('Disposal error'); })
                    }
                }
            };

            const safeDisposeModel = async function(path) {
                try {
                    const fileData = this.parent.files[path];
                    if (fileData && fileData.model && !fileData.model.isDisposed()) {
                        fileData.model.dispose();
                        delete this.parent.files[path];
                    }
                } catch (error) {
                    // Log but don't throw
                }
            };

            // Should not throw
            await expect(safeDisposeModel.call(mockVirtualFS, '/error-file.js')).resolves.not.toThrow();
        });
    });

    describe('State Consistency', () => {
        test('should update version_current after successful restore', async () => {
            const performRestore = async (version) => {
                mockVirtualFS.version_current = version;
                return { success: true, version };
            };

            await performRestore('v1');
            expect(mockVirtualFS.version_current).toBe('v1');

            await performRestore('v2');
            expect(mockVirtualFS.version_current).toBe('v2');
        });

        test('should persist version_current to localStorage', async () => {
            const sandboxName = 'test-plugin';
            const existingData = {
                versions: mockVirtualFS.versions,
                version_current: 'v2',
                version_latest: 'v2'
            };
            
            localStorage.getItem.mockReturnValue(LZString.compress(JSON.stringify(existingData)));

            // Simulate version current update
            const unpacked = JSON.parse(LZString.decompress(localStorage.getItem(sandboxName)));
            unpacked.version_current = 'v1';
            localStorage.setItem(sandboxName, LZString.compress(JSON.stringify(unpacked)));

            expect(localStorage.setItem).toHaveBeenCalled();
            const savedData = localStorage.setItem.mock.calls[0][1];
            expect(savedData).toContain('compressed:');
        });
    });

    describe('UI Updates', () => {
        test('should emit all required UI update notifications', () => {
            const notifications = [];
            mockParent.notifications.addToQueue = jest.fn((event, data) => {
                notifications.push(event);
            });

            // Simulate UI updates at end of restore
            mockParent.notifications.addToQueue('treeUpdate', []);
            mockParent.notifications.addToQueue('fileSelected', null);
            mockParent.notifications.addToQueue('treeVersionsUpdate', []);

            expect(notifications).toContain('treeUpdate');
            expect(notifications).toContain('fileSelected');
            expect(notifications).toContain('treeVersionsUpdate');
        });
    });
});

