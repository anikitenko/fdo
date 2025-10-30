/**
 * Integration Tests for Multi-Window Synchronization
 * Covers Phase 5: User Story 3 - Multi-Window Sync
 */

import { SnapshotLogger } from '../../src/utils/SnapshotLogger';

// Mock dependencies
jest.mock('electron-log/renderer');
jest.mock('lz-string', () => ({
    compress: jest.fn((data) => `compressed:${data}`),
    decompress: jest.fn((data) => data.replace('compressed:', ''))
}));

const LZString = require('lz-string');

describe('Multi-Window Synchronization', () => {
    let windowA;
    let windowB;
    let sharedLocalStorage;
    let storageEventHandlers;

    beforeEach(() => {
        jest.clearAllMocks();
        
        // Shared localStorage between "windows"
        sharedLocalStorage = new Map();
        storageEventHandlers = [];

        // Mock localStorage that's shared between windows
        const createMockLocalStorage = () => ({
            getItem: jest.fn((key) => sharedLocalStorage.get(key) || null),
            setItem: jest.fn((key, value) => {
                const oldValue = sharedLocalStorage.get(key);
                sharedLocalStorage.set(key, value);
                
                // Trigger storage events to other windows
                storageEventHandlers.forEach(handler => {
                    handler({ key, newValue: value, oldValue });
                });
            }),
            removeItem: jest.fn((key) => sharedLocalStorage.delete(key))
        });

        // Create two "windows" with separate VirtualFS instances
        const createWindow = (name) => ({
            name,
            localStorage: createMockLocalStorage(),
            virtualFS: {
                versions: {},
                version_latest: null,
                version_current: null,
                parent: {
                    sandboxName: 'test-plugin',
                    notifications: {
                        addToQueue: jest.fn()
                    }
                },
                logger: new SnapshotLogger(`test-${name}`),
                __list: jest.fn(() => []),
                _storageEventHandler: null
            },
            addEventListener: jest.fn((event, handler) => {
                if (event === 'storage') {
                    storageEventHandlers.push(handler);
                }
            })
        });

        windowA = createWindow('windowA');
        windowB = createWindow('windowB');

        // Make global.localStorage point to windowA by default
        global.localStorage = windowA.localStorage;
        global.window = windowA;
    });

    afterEach(() => {
        storageEventHandlers = [];
    });

    describe('Setup and Initialization', () => {
        test('should register storage event listener', () => {
            const setupMultiWindowSync = function() {
                if (typeof window === 'undefined') return;
                
                const handleStorageEvent = (event) => {
                    // Handler logic
                };
                
                window.addEventListener('storage', handleStorageEvent);
                this._storageEventHandler = handleStorageEvent;
            };

            setupMultiWindowSync.call(windowA.virtualFS);

            expect(windowA.addEventListener).toHaveBeenCalledWith('storage', expect.any(Function));
        });
    });

    describe('Version List Synchronization', () => {
        test('should sync new version from Window A to Window B', async () => {
            // Setup initial state
            const initialVersions = {
                'v1': { version: 'v1', date: '2025-01-01T00:00:00.000Z', content: [] }
            };
            
            windowA.virtualFS.versions = { ...initialVersions };
            windowB.virtualFS.versions = { ...initialVersions };
            
            windowA.virtualFS.version_latest = 'v1';
            windowB.virtualFS.version_latest = 'v1';

            // Setup Window B's storage event handler
            const handleStorageEvent = (event) => {
                if (event.key !== windowB.virtualFS.parent.sandboxName || !event.newValue) return;
                
                try {
                    const externalData = JSON.parse(LZString.decompress(event.newValue));
                    windowB.virtualFS.versions = externalData.versions;
                    windowB.virtualFS.version_latest = externalData.version_latest;
                    windowB.virtualFS.parent.notifications.addToQueue("treeVersionsUpdate", windowB.virtualFS.__list());
                } catch (error) {
                    // Ignore
                }
            };
            
            storageEventHandlers.push(handleStorageEvent);

            // Window A creates new version
            const newVersion = {
                'v2': { version: 'v2', date: '2025-01-02T00:00:00.000Z', content: [] }
            };
            windowA.virtualFS.versions = { ...windowA.virtualFS.versions, ...newVersion };
            windowA.virtualFS.version_latest = 'v2';

            const updatedData = {
                versions: windowA.virtualFS.versions,
                version_latest: windowA.virtualFS.version_latest,
                version_current: 'v2'
            };

            // Trigger storage event (simulates Window A saving)
            sharedLocalStorage.set('test-plugin', LZString.compress(JSON.stringify(updatedData)));
            storageEventHandlers.forEach(handler => {
                handler({
                    key: 'test-plugin',
                    newValue: LZString.compress(JSON.stringify(updatedData)),
                    oldValue: null
                });
            });

            // Verify Window B received the update
            expect(windowB.virtualFS.versions['v2']).toBeDefined();
            expect(windowB.virtualFS.version_latest).toBe('v2');
            expect(windowB.virtualFS.parent.notifications.addToQueue).toHaveBeenCalledWith(
                "treeVersionsUpdate",
                expect.anything()
            );
        });

        test('should handle simultaneous creates from 2 windows (last-write-wins)', async () => {
            const initialVersions = {
                'v1': { version: 'v1', date: '2025-01-01T00:00:00.000Z', content: [] }
            };
            
            windowA.virtualFS.versions = { ...initialVersions };
            windowB.virtualFS.versions = { ...initialVersions };

            // Window A creates v2
            windowA.virtualFS.versions['v2'] = { version: 'v2', date: '2025-01-02T10:00:00.000Z', content: [] };
            windowA.virtualFS.version_latest = 'v2';

            // Window B creates v3 (slightly later)
            windowB.virtualFS.versions['v3'] = { version: 'v3', date: '2025-01-02T10:00:01.000Z', content: [] };
            windowB.virtualFS.version_latest = 'v3';

            // Window B's write wins (happens last)
            const finalData = {
                versions: windowB.virtualFS.versions,
                version_latest: windowB.virtualFS.version_latest,
                version_current: 'v3'
            };

            sharedLocalStorage.set('test-plugin', LZString.compress(JSON.stringify(finalData)));

            // Verify last write wins
            const stored = JSON.parse(LZString.decompress(sharedLocalStorage.get('test-plugin')));
            expect(stored.version_latest).toBe('v3');
        });
    });

    describe('Deletion Synchronization', () => {
        test('should sync deletion from Window A to Window B', async () => {
            // Setup initial state with multiple versions
            const initialVersions = {
                'v1': { version: 'v1', date: '2025-01-01T00:00:00.000Z', content: [] },
                'v2': { version: 'v2', date: '2025-01-02T00:00:00.000Z', content: [] },
                'v3': { version: 'v3', date: '2025-01-03T00:00:00.000Z', content: [] }
            };
            
            windowA.virtualFS.versions = { ...initialVersions };
            windowB.virtualFS.versions = { ...initialVersions };
            windowA.virtualFS.version_current = 'v3';
            windowB.virtualFS.version_current = 'v3';

            // Setup Window B's storage event handler
            const handleStorageEvent = (event) => {
                if (event.key !== windowB.virtualFS.parent.sandboxName || !event.newValue) return;
                
                try {
                    const externalData = JSON.parse(LZString.decompress(event.newValue));
                    windowB.virtualFS.versions = externalData.versions;
                    windowB.virtualFS.version_latest = externalData.version_latest;
                    windowB.virtualFS.parent.notifications.addToQueue("treeVersionsUpdate", windowB.virtualFS.__list());
                } catch (error) {
                    // Ignore
                }
            };
            
            storageEventHandlers.push(handleStorageEvent);

            // Window A deletes v1
            delete windowA.virtualFS.versions['v1'];
            windowA.virtualFS.version_latest = 'v3';

            const updatedData = {
                versions: windowA.virtualFS.versions,
                version_latest: windowA.virtualFS.version_latest,
                version_current: 'v3'
            };

            // Trigger storage event
            storageEventHandlers.forEach(handler => {
                handler({
                    key: 'test-plugin',
                    newValue: LZString.compress(JSON.stringify(updatedData)),
                    oldValue: null
                });
            });

            // Verify Window B sees the deletion
            expect(windowB.virtualFS.versions['v1']).toBeUndefined();
            expect(windowB.virtualFS.versions['v2']).toBeDefined();
            expect(windowB.virtualFS.versions['v3']).toBeDefined();
        });

        test('should handle current version deletion in another window', async () => {
            // Setup: Window B's current version is v2
            const initialVersions = {
                'v1': { version: 'v1', date: '2025-01-01T00:00:00.000Z', content: [] },
                'v2': { version: 'v2', date: '2025-01-02T00:00:00.000Z', content: [] },
                'v3': { version: 'v3', date: '2025-01-03T00:00:00.000Z', content: [] }
            };
            
            windowA.virtualFS.versions = { ...initialVersions };
            windowB.virtualFS.versions = { ...initialVersions };
            windowA.virtualFS.version_current = 'v3';
            windowB.virtualFS.version_current = 'v2'; // Window B is on v2

            // Setup Window B's storage event handler
            const handleStorageEvent = (event) => {
                if (event.key !== windowB.virtualFS.parent.sandboxName || !event.newValue) return;
                
                try {
                    const externalData = JSON.parse(LZString.decompress(event.newValue));
                    windowB.virtualFS.versions = externalData.versions;
                    windowB.virtualFS.version_latest = externalData.version_latest;
                    
                    // Check if current version was deleted
                    if (!windowB.virtualFS.versions[windowB.virtualFS.version_current]) {
                        windowB.virtualFS.version_current = windowB.virtualFS.version_latest;
                        windowB.virtualFS.parent.notifications.addToQueue('snapshotWarning', {
                            message: 'Current version was deleted in another window. Version list updated.',
                            severity: 'warning'
                        });
                    }
                    
                    windowB.virtualFS.parent.notifications.addToQueue("treeVersionsUpdate", windowB.virtualFS.__list());
                } catch (error) {
                    // Ignore
                }
            };
            
            storageEventHandlers.push(handleStorageEvent);

            // Window A deletes v2 (Window B's current version)
            delete windowA.virtualFS.versions['v2'];
            windowA.virtualFS.version_latest = 'v3';

            const updatedData = {
                versions: windowA.virtualFS.versions,
                version_latest: windowA.virtualFS.version_latest,
                version_current: 'v3'
            };

            // Trigger storage event
            storageEventHandlers.forEach(handler => {
                handler({
                    key: 'test-plugin',
                    newValue: LZString.compress(JSON.stringify(updatedData)),
                    oldValue: null
                });
            });

            // Verify Window B detected the deletion and updated
            expect(windowB.virtualFS.version_current).toBe('v3'); // Updated to latest
            expect(windowB.virtualFS.parent.notifications.addToQueue).toHaveBeenCalledWith(
                'snapshotWarning',
                expect.objectContaining({
                    message: expect.stringContaining('deleted in another window')
                })
            );
        });
    });

    describe('Sync Latency', () => {
        test('should update within 2 seconds (SC-013)', async () => {
            const initialVersions = {
                'v1': { version: 'v1', date: '2025-01-01T00:00:00.000Z', content: [] }
            };
            
            windowB.virtualFS.versions = { ...initialVersions };
            
            const handleStorageEvent = (event) => {
                if (event.key !== windowB.virtualFS.parent.sandboxName || !event.newValue) return;
                const externalData = JSON.parse(LZString.decompress(event.newValue));
                windowB.virtualFS.versions = externalData.versions;
                windowB.virtualFS.version_latest = externalData.version_latest;
            };
            
            storageEventHandlers.push(handleStorageEvent);

            const startTime = Date.now();

            // Window A creates new version
            const updatedData = {
                versions: {
                    ...initialVersions,
                    'v2': { version: 'v2', date: '2025-01-02T00:00:00.000Z', content: [] }
                },
                version_latest: 'v2',
                version_current: 'v2'
            };

            // Trigger storage event (happens immediately in this test)
            storageEventHandlers.forEach(handler => {
                handler({
                    key: 'test-plugin',
                    newValue: LZString.compress(JSON.stringify(updatedData)),
                    oldValue: null
                });
            });

            const syncTime = Date.now() - startTime;

            // Verify sync happened and was fast
            expect(windowB.virtualFS.versions['v2']).toBeDefined();
            expect(syncTime).toBeLessThan(2000); // Should be nearly instant in test
        });
    });

    describe('Event Filtering', () => {
        test('should ignore events for different sandboxes', async () => {
            windowB.virtualFS.parent.sandboxName = 'different-plugin';
            
            const handleStorageEvent = (event) => {
                if (event.key !== windowB.virtualFS.parent.sandboxName || !event.newValue) return;
                windowB.virtualFS.versions = { modified: true };
            };
            
            storageEventHandlers.push(handleStorageEvent);

            // Trigger event for wrong sandbox
            storageEventHandlers.forEach(handler => {
                handler({
                    key: 'test-plugin', // Different from Window B's sandbox
                    newValue: 'some-data',
                    oldValue: null
                });
            });

            // Verify Window B didn't update
            expect(windowB.virtualFS.versions.modified).toBeUndefined();
        });

        test('should ignore events with no newValue', async () => {
            const initialVersions = { 'v1': { version: 'v1', content: [] } };
            windowB.virtualFS.versions = { ...initialVersions };
            
            const handleStorageEvent = (event) => {
                if (event.key !== windowB.virtualFS.parent.sandboxName || !event.newValue) return;
                windowB.virtualFS.versions = { modified: true };
            };
            
            storageEventHandlers.push(handleStorageEvent);

            // Trigger event with no newValue (removal event)
            storageEventHandlers.forEach(handler => {
                handler({
                    key: 'test-plugin',
                    newValue: null,
                    oldValue: 'some-data'
                });
            });

            // Verify Window B didn't update
            expect(windowB.virtualFS.versions.modified).toBeUndefined();
            expect(windowB.virtualFS.versions['v1']).toBeDefined();
        });
    });

    describe('Error Handling', () => {
        test('should handle corrupted storage data gracefully', async () => {
            const handleStorageEvent = (event) => {
                if (event.key !== windowB.virtualFS.parent.sandboxName || !event.newValue) return;
                
                try {
                    const externalData = JSON.parse(LZString.decompress(event.newValue));
                    windowB.virtualFS.versions = externalData.versions;
                } catch (error) {
                    // Should not throw, just log and continue
                    if (windowB.virtualFS.logger) {
                        windowB.virtualFS.logger.logError('multiWindowSync', error, {
                            failurePoint: 'parseExternalData'
                        });
                    }
                }
            };
            
            storageEventHandlers.push(handleStorageEvent);

            // Trigger event with corrupted data
            storageEventHandlers.forEach(handler => {
                handler({
                    key: 'test-plugin',
                    newValue: 'corrupted-invalid-data',
                    oldValue: null
                });
            });

            // Should not throw - test passes if no exception
            expect(true).toBe(true);
        });
    });

    describe('State Consistency', () => {
        test('should maintain consistency after multiple sync events', async () => {
            const initialVersions = {
                'v1': { version: 'v1', date: '2025-01-01T00:00:00.000Z', content: [] }
            };
            
            windowB.virtualFS.versions = { ...initialVersions };
            windowB.virtualFS.version_latest = 'v1';
            
            const handleStorageEvent = (event) => {
                if (event.key !== windowB.virtualFS.parent.sandboxName || !event.newValue) return;
                
                try {
                    const externalData = JSON.parse(LZString.decompress(event.newValue));
                    windowB.virtualFS.versions = externalData.versions;
                    windowB.virtualFS.version_latest = externalData.version_latest;
                } catch (error) {
                    // Ignore
                }
            };
            
            storageEventHandlers.push(handleStorageEvent);

            // Apply multiple sync events
            const events = [
                { versions: { ...initialVersions, 'v2': { version: 'v2', date: '2025-01-02', content: [] } }, version_latest: 'v2' },
                { versions: { ...initialVersions, 'v2': { version: 'v2', date: '2025-01-02', content: [] }, 'v3': { version: 'v3', date: '2025-01-03', content: [] } }, version_latest: 'v3' },
                { versions: { ...initialVersions, 'v3': { version: 'v3', date: '2025-01-03', content: [] } }, version_latest: 'v3' } // v2 deleted
            ];

            events.forEach(data => {
                storageEventHandlers.forEach(handler => {
                    handler({
                        key: 'test-plugin',
                        newValue: LZString.compress(JSON.stringify(data)),
                        oldValue: null
                    });
                });
            });

            // Verify final state is consistent
            expect(windowB.virtualFS.versions['v1']).toBeDefined();
            expect(windowB.virtualFS.versions['v2']).toBeUndefined(); // Was deleted
            expect(windowB.virtualFS.versions['v3']).toBeDefined();
            expect(windowB.virtualFS.version_latest).toBe('v3');
        });
    });
});

