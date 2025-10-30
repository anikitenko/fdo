/**
 * @jest-environment jsdom
 * 
 * Integration tests for Snapshot UI behavior
 * Tests the actual UI state during snapshot creation/restoration
 */

import React, { useEffect, useState } from 'react';
import { render, waitFor, act, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

// Mock dependencies
jest.mock('monaco-editor');
jest.mock('electron-log/renderer', () => ({
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
}));
jest.mock('../../src/components/editor/EditorPage.module.css', () => ({
    'file-tree': 'file-tree',
    'file-tree-icon': 'file-tree-icon'
}));
jest.mock('vscode-icons-js', () => ({
    getIconForFolder: jest.fn(() => 'folder.svg'),
    getIconForOpenFolder: jest.fn(() => 'folder-open.svg'),
    getIconForFile: jest.fn(() => 'file.svg')
}));
jest.mock('react-contexify', () => ({
    useContextMenu: () => ({ show: jest.fn() })
}));
jest.mock('@blueprintjs/core', () => ({
    Tree: ({ className }) => <div className={className} data-testid="tree" />,
    ProgressBar: ({ value }) => (
        <div className="bp6-progress-meter" style={{ width: `${value * 100}%` }} data-testid="progress-bar" />
    ),
    Callout: ({ children }) => <div data-testid="callout">{children}</div>,
    Intent: {
        PRIMARY: 'primary',
        SUCCESS: 'success',
        WARNING: 'warning',
        DANGER: 'danger'
    }
}));

// Create a test component that mimics FileBrowserComponent's loading behavior
const TestLoadingComponent = ({ notifications }) => {
    const [treeLoading, setTreeLoading] = useState(false);
    
    useEffect(() => {
        if (!notifications) return;
        const unsubscribe = notifications.subscribe('treeLoading', setTreeLoading);
        return () => unsubscribe();
    }, [notifications]);
    
    return (
        <div 
            data-testid="loading-component" 
            className={treeLoading ? "bp6-skeleton" : ""}
        >
            {treeLoading ? 'Loading...' : 'Ready'}
        </div>
    );
};

// Import components
import SnapshotProgress from '../../src/components/editor/SnapshotProgress';

describe('Snapshot UI Integration Tests', () => {
    let mockNotifications;
    
    beforeEach(() => {
        // Mock notifications system
        mockNotifications = {
            listeners: new Map(),
            addToQueue: jest.fn((event, data) => {
                const listeners = mockNotifications.listeners.get(event) || [];
                listeners.forEach(callback => callback(data));
            }),
            subscribe: jest.fn((event, callback) => {
                if (!mockNotifications.listeners.has(event)) {
                    mockNotifications.listeners.set(event, []);
                }
                mockNotifications.listeners.get(event).push(callback);
                return () => {
                    const listeners = mockNotifications.listeners.get(event) || [];
                    const index = listeners.indexOf(callback);
                    if (index > -1) listeners.splice(index, 1);
                };
            })
        };
    });
    
    describe('Loading State Visibility', () => {
        test('skeleton should appear when treeLoading is true', async () => {
            const { container } = render(
                <TestLoadingComponent notifications={mockNotifications} />
            );
            
            // Initially no skeleton
            expect(container.querySelector('.bp6-skeleton')).not.toBeInTheDocument();
            
            // Trigger loading
            act(() => {
                mockNotifications.addToQueue('treeLoading', true);
            });
            
            // Skeleton should appear
            await waitFor(() => {
                expect(container.querySelector('.bp6-skeleton')).toBeInTheDocument();
            });
        });
        
        test('skeleton should disappear when treeLoading is false', async () => {
            const { container } = render(
                <TestLoadingComponent notifications={mockNotifications} />
            );
            
            // Show skeleton
            act(() => {
                mockNotifications.addToQueue('treeLoading', true);
            });
            
            await waitFor(() => {
                expect(container.querySelector('.bp6-skeleton')).toBeInTheDocument();
            });
            
            // Hide skeleton
            act(() => {
                mockNotifications.addToQueue('treeLoading', false);
            });
            
            await waitFor(() => {
                expect(container.querySelector('.bp6-skeleton')).not.toBeInTheDocument();
            });
        });
        
        test('skeleton should not flicker during rapid treeLoading updates', async () => {
            const { container } = render(
                <TestLoadingComponent notifications={mockNotifications} />
            );
            
            const stateChanges = [];
            
            // Monitor skeleton state
            const observer = new MutationObserver(() => {
                const hasSkeleton = !!container.querySelector('.bp6-skeleton');
                stateChanges.push({ time: Date.now(), hasSkeleton });
            });
            
            observer.observe(container, { 
                childList: true, 
                subtree: true, 
                attributes: true,
                attributeFilter: ['class']
            });
            
            // Rapid updates
            act(() => {
                mockNotifications.addToQueue('treeLoading', true);
            });
            
            await waitFor(() => {
                expect(container.querySelector('.bp6-skeleton')).toBeInTheDocument();
            });
            
            act(() => {
                mockNotifications.addToQueue('treeLoading', false);
            });
            
            await waitFor(() => {
                expect(container.querySelector('.bp6-skeleton')).not.toBeInTheDocument();
            });
            
            observer.disconnect();
            
            // Should only see clean transitions: false -> true -> false (no flickering)
            const skeletonStates = stateChanges.map(s => s.hasSkeleton);
            const uniqueTransitions = skeletonStates.filter((state, i) => 
                i === 0 || state !== skeletonStates[i - 1]
            );
            
            // Should have at most 2 unique transitions: initial state + one toggle
            expect(uniqueTransitions.length).toBeLessThanOrEqual(3); // false -> true, true -> false
        });
    });
    
    describe('Progress Updates', () => {
        test('should display progress during snapshot creation', async () => {
            const { container } = render(
                <SnapshotProgress notifications={mockNotifications} />
            );
            
            // Start snapshot creation
            act(() => {
                mockNotifications.addToQueue('snapshotProgress', {
                    operation: 'create',
                    stage: 'validation',
                    progress: 25,
                    message: 'Validating files...'
                });
            });
            
            await waitFor(() => {
                const progressBar = container.querySelector('.bp6-progress-meter');
                expect(progressBar).toBeInTheDocument();
                // Progress bar should reflect 25%
                expect(progressBar.style.width).toBe('25%');
            });
        });
        
        test('should display progress during snapshot restoration', async () => {
            const { container } = render(
                <SnapshotProgress notifications={mockNotifications} />
            );
            
            // Start restoration
            act(() => {
                mockNotifications.addToQueue('snapshotProgress', {
                    operation: 'restore',
                    stage: 'files',
                    progress: 60,
                    message: 'Restoring files (3/5)...'
                });
            });
            
            await waitFor(() => {
                const progressBar = container.querySelector('.bp6-progress-meter');
                expect(progressBar).toBeInTheDocument();
                expect(progressBar.style.width).toBe('60%');
            });
        });
        
        test('progress should reach 100% before completion', async () => {
            const { container } = render(
                <SnapshotProgress notifications={mockNotifications} />
            );
            
            const progressValues = [];
            
            // Monitor progress bar
            const observer = new MutationObserver(() => {
                const progressBar = container.querySelector('.bp6-progress-meter');
                if (progressBar) {
                    const width = parseFloat(progressBar.style.width);
                    if (!isNaN(width)) {
                        progressValues.push(width);
                    }
                }
            });
            
            observer.observe(container, { 
                childList: true, 
                subtree: true, 
                attributes: true 
            });
            
            // Simulate progress updates
            act(() => {
                mockNotifications.addToQueue('snapshotProgress', {
                    operation: 'create',
                    stage: 'validation',
                    progress: 20
                });
            });
            
            await new Promise(resolve => setTimeout(resolve, 10));
            
            act(() => {
                mockNotifications.addToQueue('snapshotProgress', {
                    operation: 'create',
                    stage: 'snapshot',
                    progress: 60
                });
            });
            
            await new Promise(resolve => setTimeout(resolve, 10));
            
            act(() => {
                mockNotifications.addToQueue('snapshotProgress', {
                    operation: 'create',
                    stage: 'persistence',
                    progress: 100
                });
            });
            
            await waitFor(() => {
                expect(progressValues[progressValues.length - 1]).toBe(100);
            });
            
            observer.disconnect();
            
            // Progress should be monotonically increasing
            for (let i = 1; i < progressValues.length; i++) {
                expect(progressValues[i]).toBeGreaterThanOrEqual(progressValues[i - 1]);
            }
        });
    });
    
    describe('Version Switch Flow', () => {
        test('should show loading state immediately when switch starts', async () => {
            const { container } = render(
                <TestLoadingComponent notifications={mockNotifications} />
            );
            
            const startTime = Date.now();
            
            // Simulate version switch start
            act(() => {
                mockNotifications.addToQueue('treeLoading', true);
            });
            
            // Skeleton should appear within one frame (16ms)
            await waitFor(() => {
                expect(container.querySelector('.bp6-skeleton')).toBeInTheDocument();
            }, { timeout: 50 });
            
            const appearTime = Date.now() - startTime;
            expect(appearTime).toBeLessThan(100); // Should appear within 100ms
        });
        
        test('should maintain loading state during restoration', async () => {
            const { container } = render(
                <TestLoadingComponent notifications={mockNotifications} />
            );
            
            // Start loading
            act(() => {
                mockNotifications.addToQueue('treeLoading', true);
            });
            
            await waitFor(() => {
                expect(container.querySelector('.bp6-skeleton')).toBeInTheDocument();
            });
            
            // Simulate restoration in progress - skeleton should remain visible
            for (let i = 0; i < 5; i++) {
                await new Promise(resolve => setTimeout(resolve, 10));
                
                // Skeleton should remain visible
                expect(container.querySelector('.bp6-skeleton')).toBeInTheDocument();
            }
        });
        
        test('should hide loading state only after restoration completes', async () => {
            const { container } = render(
                <TestLoadingComponent notifications={mockNotifications} />
            );
            
            // Start loading
            act(() => {
                mockNotifications.addToQueue('treeLoading', true);
            });
            
            await waitFor(() => {
                expect(container.querySelector('.bp6-skeleton')).toBeInTheDocument();
            });
            
            // Skeleton should still be visible
            expect(container.querySelector('.bp6-skeleton')).toBeInTheDocument();
            
            // Complete restoration
            act(() => {
                mockNotifications.addToQueue('treeLoading', false);
            });
            
            // Skeleton should disappear
            await waitFor(() => {
                expect(container.querySelector('.bp6-skeleton')).not.toBeInTheDocument();
            });
        });
    });
    
    describe('Initial Load Behavior', () => {
        test('should NOT show skeleton during silent initial load', async () => {
            const { container } = render(
                <TestLoadingComponent notifications={mockNotifications} />
            );
            
            // Simulate initial load - NO treeLoading notification is sent
            // (restoration happens silently in background)
            
            // Wait a bit
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Skeleton should NOT appear (silent background load)
            expect(container.querySelector('.bp6-skeleton')).not.toBeInTheDocument();
        });
    });
    
    describe('Success Notifications', () => {
        test('should display success message with correct duration for ms', async () => {
            render(<SnapshotProgress notifications={mockNotifications} />);
            
            act(() => {
                mockNotifications.addToQueue('snapshotProgress', {
                    operation: 'create',
                    duration: 350,
                    fileCount: 5,
                    complete: true,
                    version: 'abc123def'
                });
            });
            
            await waitFor(() => {
                expect(screen.getByText(/350ms/)).toBeInTheDocument();
            });
        });
        
        test('should display success message with correct duration for seconds', async () => {
            render(<SnapshotProgress notifications={mockNotifications} />);
            
            act(() => {
                mockNotifications.addToQueue('snapshotProgress', {
                    operation: 'restore',
                    duration: 2547,
                    fileCount: 10,
                    complete: true,
                    version: 'xyz789abc'
                });
            });
            
            await waitFor(() => {
                expect(screen.getByText(/2\.5s/)).toBeInTheDocument();
            });
        });
    });
});

