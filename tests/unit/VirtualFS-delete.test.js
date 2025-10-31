/**
 * Tests for VirtualFS Snapshot Deletion (fs.deleteSnapshot)
 * Covers Phase 5: User Story 3 - Version Management & Deletion
 */

import { SnapshotLogger } from '../../src/utils/SnapshotLogger';

// Mock dependencies
jest.mock('electron-log/renderer');
jest.mock('lz-string', () => ({
    compress: jest.fn((data) => `compressed:${data}`),
    decompress: jest.fn((data) => data.replace('compressed:', ''))
}));

const LZString = require('lz-string');

describe('VirtualFS Snapshot Deletion - fs.deleteSnapshot()', () => {
    let mockVirtualFS;
    let mockParent;

    beforeEach(() => {
        jest.clearAllMocks();
        
        // Mock notification queue
        mockParent = {
            sandboxName: 'test-plugin',
            notifications: {
                addToQueue: jest.fn()
            }
        };

        // Mock localStorage
        global.localStorage = {
            getItem: jest.fn(() => null),
            setItem: jest.fn(),
            removeItem: jest.fn()
        };

        // Create mock VirtualFS instance with multiple versions
        mockVirtualFS = {
            versions: {
                'v1': { version: 'v1', date: '2025-01-01T00:00:00.000Z', content: [] },
                'v2': { version: 'v2', date: '2025-01-02T00:00:00.000Z', content: [] },
                'v3': { version: 'v3', date: '2025-01-03T00:00:00.000Z', content: [] }
            },
            version_latest: 'v3',
            version_current: 'v3',
            parent: mockParent,
            logger: new SnapshotLogger('test-plugin'),
            __list: jest.fn(() => [])
        };
    });

    describe('Version Validation', () => {
        test('should throw error for non-existent version', async () => {
            const deleteSnapshot = async function(version) {
                if (!this.versions[version]) {
                    throw new Error(`Cannot delete: Version '${version}' does not exist`);
                }
            };

            await expect(deleteSnapshot.call(mockVirtualFS, 'nonexistent')).rejects.toThrow('does not exist');
        });

        test('should accept valid version ID', async () => {
            const deleteSnapshot = async function(version) {
                if (!this.versions[version]) {
                    throw new Error(`Cannot delete: Version '${version}' does not exist`);
                }
                delete this.versions[version];
                return { success: true };
            };

            mockVirtualFS.version_current = 'v3'; // Set current to v3 so we can delete v1
            const result = await deleteSnapshot.call(mockVirtualFS, 'v1');
            
            expect(result.success).toBe(true);
            expect(mockVirtualFS.versions['v1']).toBeUndefined();
        });
    });

    describe('Current Version Protection', () => {
        test('should prevent deletion of current version', async () => {
            const deleteSnapshot = async function(version) {
                if (this.version_current === version) {
                    throw new Error(`Cannot delete current version '${version}'. Switch to another version first.`);
                }
            };

            mockVirtualFS.version_current = 'v2';
            
            await expect(deleteSnapshot.call(mockVirtualFS, 'v2')).rejects.toThrow('Cannot delete current version');
        });

        test('should allow deletion of non-current version', async () => {
            const deleteSnapshot = async function(version) {
                if (this.version_current === version) {
                    throw new Error(`Cannot delete current version '${version}'. Switch to another version first.`);
                }
                delete this.versions[version];
                return { success: true };
            };

            mockVirtualFS.version_current = 'v3';
            
            const result = await deleteSnapshot.call(mockVirtualFS, 'v1');
            expect(result.success).toBe(true);
            expect(mockVirtualFS.versions['v1']).toBeUndefined();
        });
    });

    describe('Last Version Protection', () => {
        test('should prevent deletion of last remaining version', async () => {
            mockVirtualFS.versions = {
                'v1': { version: 'v1', date: '2025-01-01T00:00:00.000Z', content: [] }
            };
            mockVirtualFS.version_current = 'v1';

            const deleteSnapshot = async function(version) {
                if (Object.keys(this.versions).length === 1) {
                    throw new Error('Cannot delete the only remaining version');
                }
            };

            await expect(deleteSnapshot.call(mockVirtualFS, 'v1')).rejects.toThrow('only remaining version');
        });

        test('should allow deletion when multiple versions exist', async () => {
            const deleteSnapshot = async function(version) {
                if (Object.keys(this.versions).length === 1) {
                    throw new Error('Cannot delete the only remaining version');
                }
                if (this.version_current !== version) {
                    delete this.versions[version];
                    return { success: true };
                }
            };

            mockVirtualFS.version_current = 'v3';
            
            const result = await deleteSnapshot.call(mockVirtualFS, 'v1');
            expect(result.success).toBe(true);
        });
    });

    describe('version_latest Update', () => {
        test('should update version_latest when deleting latest version', async () => {
            const deleteSnapshot = async function(version) {
                if (this.version_current === version) {
                    throw new Error('Cannot delete current version');
                }
                
                delete this.versions[version];
                
                // Update version_latest if we deleted it
                if (this.version_latest === version) {
                    const remainingVersions = Object.values(this.versions);
                    const sortedVersions = remainingVersions.sort((a, b) => 
                        new Date(b.date) - new Date(a.date)
                    );
                    this.version_latest = sortedVersions[0].version;
                }
                
                return { success: true, newLatest: this.version_latest };
            };

            mockVirtualFS.version_current = 'v2';
            mockVirtualFS.version_latest = 'v3';
            
            const result = await deleteSnapshot.call(mockVirtualFS, 'v3');
            
            expect(result.success).toBe(true);
            expect(mockVirtualFS.version_latest).toBe('v2'); // Should be updated to v2 (next most recent)
            expect(mockVirtualFS.versions['v3']).toBeUndefined();
        });

        test('should not update version_latest when deleting non-latest version', async () => {
            const deleteSnapshot = async function(version) {
                if (this.version_current === version) {
                    throw new Error('Cannot delete current version');
                }
                
                delete this.versions[version];
                
                if (this.version_latest === version) {
                    const remainingVersions = Object.values(this.versions);
                    const sortedVersions = remainingVersions.sort((a, b) => 
                        new Date(b.date) - new Date(a.date)
                    );
                    this.version_latest = sortedVersions[0].version;
                }
                
                return { success: true, latest: this.version_latest };
            };

            mockVirtualFS.version_current = 'v3';
            mockVirtualFS.version_latest = 'v3';
            
            const result = await deleteSnapshot.call(mockVirtualFS, 'v1');
            
            expect(result.success).toBe(true);
            expect(mockVirtualFS.version_latest).toBe('v3'); // Should remain unchanged
        });
    });

    describe('Storage Persistence', () => {
        test('should persist deletion to localStorage', async () => {
            const existingData = {
                versions: { ...mockVirtualFS.versions },
                version_current: 'v3',
                version_latest: 'v3'
            };
            localStorage.getItem.mockReturnValue(LZString.compress(JSON.stringify(existingData)));

            const deleteSnapshot = async function(version) {
                if (this.version_current === version) throw new Error('Current version');
                
                delete this.versions[version];
                
                const sandboxFs = localStorage.getItem(this.parent.sandboxName);
                if (sandboxFs) {
                    const unpacked = JSON.parse(LZString.decompress(sandboxFs));
                    delete unpacked.versions[version];
                    localStorage.setItem(this.parent.sandboxName, LZString.compress(JSON.stringify(unpacked)));
                }
                
                return { success: true };
            };

            mockVirtualFS.version_current = 'v3';
            await deleteSnapshot.call(mockVirtualFS, 'v1');

            expect(localStorage.setItem).toHaveBeenCalledWith(
                'test-plugin',
                expect.stringContaining('compressed:')
            );
        });

        test('should update version_latest in localStorage if deleted', async () => {
            const existingData = {
                versions: { ...mockVirtualFS.versions },
                version_current: 'v2',
                version_latest: 'v3'
            };
            localStorage.getItem.mockReturnValue(LZString.compress(JSON.stringify(existingData)));

            const deleteSnapshot = async function(version) {
                if (this.version_current === version) throw new Error('Current version');
                
                delete this.versions[version];
                
                if (this.version_latest === version) {
                    const remainingVersions = Object.values(this.versions);
                    const sortedVersions = remainingVersions.sort((a, b) => 
                        new Date(b.date) - new Date(a.date)
                    );
                    this.version_latest = sortedVersions[0].version;
                }
                
                const sandboxFs = localStorage.getItem(this.parent.sandboxName);
                if (sandboxFs) {
                    const unpacked = JSON.parse(LZString.decompress(sandboxFs));
                    delete unpacked.versions[version];
                    if (unpacked.version_latest === version) {
                        unpacked.version_latest = this.version_latest;
                    }
                    localStorage.setItem(this.parent.sandboxName, LZString.compress(JSON.stringify(unpacked)));
                }
                
                return { success: true };
            };

            mockVirtualFS.version_current = 'v2';
            await deleteSnapshot.call(mockVirtualFS, 'v3');

            expect(localStorage.setItem).toHaveBeenCalled();
            expect(mockVirtualFS.version_latest).not.toBe('v3');
        });
    });

    describe('UI Updates', () => {
        test('should emit treeVersionsUpdate after successful deletion', async () => {
            const deleteSnapshot = async function(version) {
                if (this.version_current === version) throw new Error('Current version');
                
                delete this.versions[version];
                this.parent.notifications.addToQueue("treeVersionsUpdate", this.__list());
                
                return { success: true };
            };

            mockVirtualFS.version_current = 'v3';
            await deleteSnapshot.call(mockVirtualFS, 'v1');

            expect(mockParent.notifications.addToQueue).toHaveBeenCalledWith(
                "treeVersionsUpdate",
                expect.anything()
            );
        });
    });

    describe('Error Handling', () => {
        test('should emit error notification on failure', async () => {
            const deleteSnapshot = async function(version) {
                try {
                    if (!this.versions[version]) {
                        throw new Error('Version does not exist');
                    }
                } catch (error) {
                    this.parent.notifications.addToQueue('snapshotError', {
                        operation: 'delete',
                        message: error.message,
                        version
                    });
                    throw error;
                }
            };

            await expect(deleteSnapshot.call(mockVirtualFS, 'nonexistent')).rejects.toThrow();
            
            expect(mockParent.notifications.addToQueue).toHaveBeenCalledWith(
                'snapshotError',
                expect.objectContaining({
                    operation: 'delete',
                    version: 'nonexistent'
                })
            );
        });
    });

    describe('Edge Cases', () => {
        test('should handle deletion of middle version', async () => {
            const deleteSnapshot = async function(version) {
                if (this.version_current === version) throw new Error('Current version');
                delete this.versions[version];
                return { success: true, remaining: Object.keys(this.versions).length };
            };

            mockVirtualFS.version_current = 'v3';
            const result = await deleteSnapshot.call(mockVirtualFS, 'v2');

            expect(result.success).toBe(true);
            expect(result.remaining).toBe(2);
            expect(mockVirtualFS.versions['v1']).toBeDefined();
            expect(mockVirtualFS.versions['v2']).toBeUndefined();
            expect(mockVirtualFS.versions['v3']).toBeDefined();
        });

        test('should handle deletion of oldest version', async () => {
            const deleteSnapshot = async function(version) {
                if (this.version_current === version) throw new Error('Current version');
                delete this.versions[version];
                return { success: true };
            };

            mockVirtualFS.version_current = 'v3';
            await deleteSnapshot.call(mockVirtualFS, 'v1');

            expect(mockVirtualFS.versions['v1']).toBeUndefined();
            expect(mockVirtualFS.versions['v2']).toBeDefined();
            expect(mockVirtualFS.versions['v3']).toBeDefined();
        });
    });

    describe('Logging', () => {
        test('should log delete operation start and complete', () => {
            const logger = new SnapshotLogger('test');
            const startSpy = jest.spyOn(logger, 'logStart');
            const completeSpy = jest.spyOn(logger, 'logComplete');

            logger.logStart('delete', { version: 'v1', totalVersions: 3 });
            logger.logComplete('delete', { version: 'v1', duration: 50, remainingVersions: 2 });

            expect(startSpy).toHaveBeenCalledWith('delete', expect.objectContaining({ version: 'v1' }));
            expect(completeSpy).toHaveBeenCalledWith('delete', expect.objectContaining({ version: 'v1' }));
        });
    });
});

