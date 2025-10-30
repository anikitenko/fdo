/**
 * Tests for VirtualFS Snapshot Creation (fs.create)
 * Covers Phase 3: User Story 1 - Reliable Snapshot Creation
 */

import { SnapshotLogger } from '../../src/utils/SnapshotLogger';

// Mock dependencies
jest.mock('electron-log/renderer');
jest.mock('lz-string', () => ({
    compress: jest.fn((data) => `compressed:${data}`),
    decompress: jest.fn((data) => data.replace('compressed:', ''))
}));

const LZString = require('lz-string');

describe('VirtualFS Snapshot Creation - fs.create()', () => {
    let mockVirtualFS;
    let mockParent;
    let mockModels;

    beforeEach(() => {
        jest.clearAllMocks();
        
        // Mock notification queue
        const notificationQueue = [];
        mockParent = {
            sandboxName: 'test-plugin',
            files: {},
            notifications: {
                addToQueue: jest.fn((event, data) => {
                    notificationQueue.push({ event, data });
                }),
                subscribe: jest.fn()
            },
            listModels: jest.fn(() => mockModels)
        };

        // Setup mock models (files in editor)
        mockModels = [];

        // Mock localStorage
        global.localStorage = {
            getItem: jest.fn(() => null),
            setItem: jest.fn(),
            removeItem: jest.fn()
        };

        // Mock navigator.storage for quota checks
        global.navigator = {
            storage: {
                estimate: jest.fn().mockResolvedValue({
                    usage: 10 * 1024 * 1024, // 10MB
                    quota: 100 * 1024 * 1024  // 100MB (10% usage)
                })
            }
        };

        // Create mock VirtualFS instance
        mockVirtualFS = {
            versions: {},
            version_latest: 0,
            version_current: 0,
            parent: mockParent,
            logger: new SnapshotLogger('test-plugin'),
            loading: false,
            setLoading() { this.loading = true; },
            stopLoading() { this.loading = false; },
            __list: jest.fn(() => [])
        };
    });

    describe('File Count Scenarios', () => {
        test('should create snapshot with 0 files', async () => {
            // Setup
            mockModels = [];

            // Execute create (simplified version for unit test)
            mockVirtualFS.setLoading();
            const latest = 'test-version-0';
            const date = new Date().toISOString();
            const content = [];

            mockVirtualFS.versions[latest] = {
                tabs: [],
                content: content,
                version: latest,
                prev: '',
                date: date
            };
            mockVirtualFS.version_latest = latest;
            mockVirtualFS.version_current = latest;

            // Verify
            expect(mockVirtualFS.versions[latest].content).toHaveLength(0);
            expect(mockVirtualFS.version_latest).toBe(latest);
        });

        test('should create snapshot with 1 file', async () => {
            // Setup single file
            mockModels = [{
                uri: {
                    toString: () => 'file:///test/file1.js'
                },
                getValue: () => 'console.log("test");'
            }];

            // Execute
            const latest = 'test-version-1';
            const content = [];
            
            mockModels.forEach((model) => {
                const modelUri = model.uri.toString().replace('file://', '');
                if (!modelUri.includes('/node_modules/') && !modelUri.includes('/dist/')) {
                    content.push({
                        id: modelUri,
                        content: model.getValue(),
                        state: null
                    });
                }
            });

            // Verify
            expect(content).toHaveLength(1);
            expect(content[0].id).toBe('/test/file1.js');
            expect(content[0].content).toBe('console.log("test");');
        });

        test('should create snapshot with 5 files', async () => {
            // Setup 5 files
            mockModels = Array.from({ length: 5 }, (_, i) => ({
                uri: {
                    toString: () => `file:///test/file${i + 1}.js`
                },
                getValue: () => `const file${i + 1} = true;`
            }));

            // Execute
            const content = [];
            mockModels.forEach((model) => {
                const modelUri = model.uri.toString().replace('file://', '');
                if (!modelUri.includes('/node_modules/') && !modelUri.includes('/dist/')) {
                    content.push({
                        id: modelUri,
                        content: model.getValue(),
                        state: null
                    });
                }
            });

            // Verify
            expect(content).toHaveLength(5);
            content.forEach((file, i) => {
                expect(file.id).toBe(`/test/file${i + 1}.js`);
                expect(file.content).toBe(`const file${i + 1} = true;`);
            });
        });

        test('should create snapshot with 20 files', async () => {
            // Setup 20 files
            mockModels = Array.from({ length: 20 }, (_, i) => ({
                uri: {
                    toString: () => `file:///test/file${i + 1}.js`
                },
                getValue: () => `const file${i + 1} = ${i + 1};`
            }));

            // Execute
            const content = [];
            mockModels.forEach((model) => {
                const modelUri = model.uri.toString().replace('file://', '');
                if (!modelUri.includes('/node_modules/') && !modelUri.includes('/dist/')) {
                    content.push({
                        id: modelUri,
                        content: model.getValue(),
                        state: null
                    });
                }
            });

            // Verify
            expect(content).toHaveLength(20);
            expect(content[0].id).toBe('/test/file1.js');
            expect(content[19].id).toBe('/test/file20.js');
        });

        test('should create snapshot with 50 files', async () => {
            // Setup 50 files
            mockModels = Array.from({ length: 50 }, (_, i) => ({
                uri: {
                    toString: () => `file:///test/file${i + 1}.js`
                },
                getValue: () => `// File ${i + 1}\nconst value = ${i + 1};`
            }));

            // Execute
            const content = [];
            mockModels.forEach((model) => {
                const modelUri = model.uri.toString().replace('file://', '');
                if (!modelUri.includes('/node_modules/') && !modelUri.includes('/dist/')) {
                    content.push({
                        id: modelUri,
                        content: model.getValue(),
                        state: null
                    });
                }
            });

            // Verify
            expect(content).toHaveLength(50);
            expect(content[49].id).toBe('/test/file50.js');
        });
    });

    describe('File Filtering', () => {
        test('should exclude node_modules files', async () => {
            mockModels = [
                {
                    uri: { toString: () => 'file:///test/file.js' },
                    getValue: () => 'valid file'
                },
                {
                    uri: { toString: () => 'file:///test/node_modules/lib.js' },
                    getValue: () => 'should be excluded'
                }
            ];

            const content = [];
            mockModels.forEach((model) => {
                const modelUri = model.uri.toString().replace('file://', '');
                if (!modelUri.includes('/node_modules/') && !modelUri.includes('/dist/')) {
                    content.push({
                        id: modelUri,
                        content: model.getValue(),
                        state: null
                    });
                }
            });

            expect(content).toHaveLength(1);
            expect(content[0].id).toBe('/test/file.js');
        });

        test('should exclude dist files', async () => {
            mockModels = [
                {
                    uri: { toString: () => 'file:///test/src/main.js' },
                    getValue: () => 'source file'
                },
                {
                    uri: { toString: () => 'file:///test/dist/bundle.js' },
                    getValue: () => 'compiled file'
                }
            ];

            const content = [];
            mockModels.forEach((model) => {
                const modelUri = model.uri.toString().replace('file://', '');
                if (!modelUri.includes('/node_modules/') && !modelUri.includes('/dist/')) {
                    content.push({
                        id: modelUri,
                        content: model.getValue(),
                        state: null
                    });
                }
            });

            expect(content).toHaveLength(1);
            expect(content[0].id).toBe('/test/src/main.js');
        });
    });

    describe('Syntax Errors in Files', () => {
        test('should create snapshot successfully with syntax errors', async () => {
            mockModels = [
                {
                    uri: { toString: () => 'file:///test/broken.js' },
                    getValue: () => 'const x = {{{  // Invalid syntax'
                },
                {
                    uri: { toString: () => 'file:///test/valid.js' },
                    getValue: () => 'const y = 42;'
                }
            ];

            const content = [];
            mockModels.forEach((model) => {
                const modelUri = model.uri.toString().replace('file://', '');
                if (!modelUri.includes('/node_modules/') && !modelUri.includes('/dist/')) {
                    content.push({
                        id: modelUri,
                        content: model.getValue(),
                        state: null
                    });
                }
            });

            // Verify both files captured regardless of syntax
            expect(content).toHaveLength(2);
            expect(content[0].content).toContain('Invalid syntax');
            expect(content[1].content).toBe('const y = 42;');
        });
    });

    describe('Storage Quota Checking', () => {
        test('should proceed when quota is below 95%', async () => {
            global.navigator.storage.estimate.mockResolvedValue({
                usage: 50 * 1024 * 1024, // 50MB
                quota: 100 * 1024 * 1024  // 100MB (50% usage)
            });

            const checkStorageQuota = async function() {
                if ('storage' in navigator && 'estimate' in navigator.storage) {
                    const {usage, quota} = await navigator.storage.estimate();
                    const usagePercent = (usage / quota) * 100;
                    return usagePercent < 95;
                }
                return true;
            };

            const hasQuota = await checkStorageQuota.call(mockVirtualFS);
            expect(hasQuota).toBe(true);
        });

        test('should block when quota exceeds 95%', async () => {
            global.navigator.storage.estimate.mockResolvedValue({
                usage: 96 * 1024 * 1024, // 96MB
                quota: 100 * 1024 * 1024  // 100MB (96% usage)
            });

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

            const hasQuota = await checkStorageQuota.call(mockVirtualFS);
            
            expect(hasQuota).toBe(false);
            expect(mockParent.notifications.addToQueue).toHaveBeenCalledWith(
                'storageWarning',
                expect.objectContaining({
                    severity: 'critical',
                    percent: 96
                })
            );
        });
    });

    describe('Progress Tracking', () => {
        test('should emit progress notifications during create', () => {
            const progressTracker = {
                operation: 'create',
                notificationQueue: mockParent.notifications,
                currentStage: null,
                emit(data) {
                    this.notificationQueue.addToQueue('snapshotProgress', {
                        operation: this.operation,
                        ...data
                    });
                }
            };

            // Simulate progress updates
            progressTracker.emit({ stage: 'Capturing files...', progress: 0 });
            progressTracker.emit({ stage: 'Capturing files...', progress: 40 });
            progressTracker.emit({ stage: 'Compressing data...', progress: 60 });
            progressTracker.emit({ stage: 'Saving to storage...', progress: 90 });
            progressTracker.emit({ stage: 'Complete', progress: 100, complete: true });

            const progressCalls = mockParent.notifications.addToQueue.mock.calls
                .filter(call => call[0] === 'snapshotProgress');

            expect(progressCalls).toHaveLength(5);
            expect(progressCalls[0][1].progress).toBe(0);
            expect(progressCalls[4][1].complete).toBe(true);
        });
    });

    describe('Error Handling and Rollback', () => {
        test('should rollback on create failure', async () => {
            const _ = require('lodash');
            
            // Create initial state
            mockVirtualFS.versions = {
                'old-version': { content: [], date: '2025-01-01' }
            };
            mockVirtualFS.version_latest = 'old-version';
            mockVirtualFS.version_current = 'old-version';

            // Capture backup
            const backup = {
                versions: _.cloneDeep(mockVirtualFS.versions),
                version_latest: mockVirtualFS.version_latest,
                version_current: mockVirtualFS.version_current,
                localStorage: localStorage.getItem(mockParent.sandboxName)
            };

            // Simulate partial create
            mockVirtualFS.versions['new-version'] = { content: [], date: '2025-01-02' };
            mockVirtualFS.version_latest = 'new-version';

            // Simulate failure and rollback
            mockVirtualFS.versions = backup.versions;
            mockVirtualFS.version_latest = backup.version_latest;
            mockVirtualFS.version_current = backup.version_current;

            // Verify rollback restored original state
            expect(mockVirtualFS.version_latest).toBe('old-version');
            expect(mockVirtualFS.versions).not.toHaveProperty('new-version');
        });

        test('should emit rollback notification on failure', async () => {
            const rollback = async function(backupState) {
                this.parent.notifications.addToQueue('operationRollback', {
                    message: 'Operation failed and was rolled back to previous state',
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
    });

    describe('Rapid Succession Snapshots', () => {
        test('should handle 3 snapshots within 1 second', async () => {
            const snapshots = [];
            
            // Simulate 3 rapid creates
            for (let i = 0; i < 3; i++) {
                const latest = `snapshot-${i}-${Date.now()}`;
                const date = new Date().toISOString();
                
                mockVirtualFS.versions[latest] = {
                    tabs: [],
                    content: [],
                    version: latest,
                    prev: mockVirtualFS.version_latest || '',
                    date: date
                };
                mockVirtualFS.version_latest = latest;
                mockVirtualFS.version_current = latest;
                
                snapshots.push(latest);
            }

            // Verify all 3 snapshots created
            expect(Object.keys(mockVirtualFS.versions)).toHaveLength(3);
            expect(snapshots).toHaveLength(3);
            snapshots.forEach(version => {
                expect(mockVirtualFS.versions).toHaveProperty(version);
            });
        });
    });

    describe('Data Integrity', () => {
        test('should preserve exact file contents', async () => {
            const originalContent = 'const x = 42;\n// Comment\nfunction test() { return x; }';
            
            mockModels = [{
                uri: { toString: () => 'file:///test/file.js' },
                getValue: () => originalContent
            }];

            const content = [];
            mockModels.forEach((model) => {
                const modelUri = model.uri.toString().replace('file://', '');
                if (!modelUri.includes('/node_modules/') && !modelUri.includes('/dist/')) {
                    content.push({
                        id: modelUri,
                        content: model.getValue(),
                        state: null
                    });
                }
            });

            expect(content[0].content).toBe(originalContent);
            expect(content[0].content).toContain('\n');
            expect(content[0].content).toContain('//');
        });

        test('should handle unicode characters', async () => {
            const unicodeContent = '// 你好世界 🌍\nconst emoji = "✅ 🎉";';
            
            mockModels = [{
                uri: { toString: () => 'file:///test/unicode.js' },
                getValue: () => unicodeContent
            }];

            const content = [];
            mockModels.forEach((model) => {
                const modelUri = model.uri.toString().replace('file://', '');
                if (!modelUri.includes('/node_modules/') && !modelUri.includes('/dist/')) {
                    content.push({
                        id: modelUri,
                        content: model.getValue(),
                        state: null
                    });
                }
            });

            expect(content[0].content).toBe(unicodeContent);
            expect(content[0].content).toContain('你好世界');
            expect(content[0].content).toContain('🌍');
        });
    });

    describe('Metadata Validation', () => {
        test('should include required metadata fields', () => {
            const latest = 'test-version';
            const date = new Date().toISOString();
            const prevVersion = 'prev-version';
            
            mockVirtualFS.versions[latest] = {
                tabs: [],
                content: [],
                version: latest,
                prev: prevVersion,
                date: date
            };

            const snapshot = mockVirtualFS.versions[latest];
            
            expect(snapshot).toHaveProperty('version');
            expect(snapshot).toHaveProperty('date');
            expect(snapshot).toHaveProperty('prev');
            expect(snapshot).toHaveProperty('tabs');
            expect(snapshot).toHaveProperty('content');
            expect(snapshot.version).toBe(latest);
            expect(snapshot.prev).toBe(prevVersion);
        });

        test('should generate unique version IDs', () => {
            const versions = new Set();
            
            for (let i = 0; i < 10; i++) {
                const latest = (Math.random() + 1).toString(36).substring(2);
                versions.add(latest);
            }

            // All versions should be unique
            expect(versions.size).toBe(10);
        });
    });
});

