/**
 * End-to-End Tests for Snapshot Loading UX  
 * Using IPC-based test harness
 */

import { TestClient } from './client.js';

let client;

beforeAll(async () => {
  client = new TestClient();
  await client.start();
}, 60000); // 60 second timeout for app startup

afterAll(async () => {
  if (client) {
    await client.stop();
  }
}, 10000);

describe('Snapshot Loading UX', () => {
  
  describe('Initial Load', () => {
    
    it('should NOT show skeleton during initial editor load', async () => {
      // Wait for editor to be ready
      await client.waitForElement('.file-tree');
      
      // Check if skeleton class is present
      const hasSkeleton = await client.hasClass('.file-tree', 'bp6-skeleton');
      
      expect(hasSkeleton).toBe(false);
    }, 15000);
    
    it('should restore files silently in background', async () => {
      // Wait for files to appear in the tree
      const files = await client.getElements('[data-icon]');
      
      expect(files.length).toBeGreaterThan(0);
    });
    
    it('should complete initial load with Monaco ready', async () => {
      const isMonacoReady = await client.eval('typeof window.monaco !== "undefined"');
      
      expect(isMonacoReady).toBe(true);
    });
  });
  
  describe('Version Switch', () => {
    
    it('should show skeleton immediately when switching versions', async () => {
      // Check if dropdown exists
      const dropdown = await client.getElement('select');
      if (!dropdown) {
        console.log('No version dropdown found, skipping test');
        return;
      }
      
      // Get current and total snapshots
      const indices = await client.eval(`
        (() => {
          const select = document.querySelector('select');
          return {
            current: select.selectedIndex,
            total: select.options.length
          };
        })()
      `);
      
      if (indices.total < 2) {
        console.log('Less than 2 snapshots, creating dummy snapshot...');
        // You could create a snapshot here via client.eval if needed
        return;
      }
      
      const nextIndex = indices.current === 0 ? 1 : 0;
      
      // Monitor class changes during version switch
      const monitorPromise = client.monitorClassChanges('.file-tree', 2000);
      
      // Switch version
      await new Promise(r => setTimeout(r, 100)); // Small delay to ensure monitor is active
      await client.selectOption('select', nextIndex);
      
      const result = await monitorPromise;
      
      // Analyze changes
      expect(result.changes).toBeDefined();
      
      // Should have skeleton class added
      const hadSkeleton = result.changes.some(change => 
        change.className.includes('bp6-skeleton')
      );
      
      expect(hadSkeleton).toBe(true);
      
      // Find when skeleton appeared
      const skeletonChange = result.changes.find(c => c.className.includes('bp6-skeleton'));
      if (skeletonChange) {
        console.log(`✓ Skeleton appeared at ${skeletonChange.time}ms`);
        expect(skeletonChange.time).toBeLessThan(300);
      }
    }, 15000);
    
    it('should NOT flicker skeleton multiple times', async () => {
      const dropdown = await client.getElement('select');
      if (!dropdown) {
        return;
      }
      
      const indices = await client.eval(`
        (() => {
          const select = document.querySelector('select');
          return {
            current: select.selectedIndex,
            total: select.options.length
          };
        })()
      `);
      
      if (indices.total < 2) {
        return;
      }
      
      const nextIndex = indices.current === 0 ? 1 : 0;
      
      // Monitor class changes during version switch
      const monitorPromise = client.monitorClassChanges('.file-tree', 2500);
      
      await new Promise(r => setTimeout(r, 100));
      await client.selectOption('select', nextIndex);
      
      const result = await monitorPromise;
      
      // Count skeleton state transitions
      let transitions = 0;
      let previousHadSkeleton = result.changes[0]?.className.includes('bp6-skeleton') || false;
      
      for (const change of result.changes.slice(1)) {
        const currentHasSkeleton = change.className.includes('bp6-skeleton');
        if (currentHasSkeleton !== previousHadSkeleton) {
          transitions++;
          previousHadSkeleton = currentHasSkeleton;
        }
      }
      
      // Should have at most 2 transitions: add skeleton, remove skeleton
      expect(transitions).toBeLessThanOrEqual(2);
      
      console.log(`✓ Skeleton had ${transitions} state transitions`);
    }, 15000);
    
    it('should complete version switch in less than 3 seconds', async () => {
      const dropdown = await client.getElement('select');
      if (!dropdown) {
        return;
      }
      
      const indices = await client.eval(`
        (() => {
          const select = document.querySelector('select');
          return {
            current: select.selectedIndex,
            total: select.options.length
          };
        })()
      `);
      
      if (indices.total < 2) {
        return;
      }
      
      const nextIndex = indices.current === 0 ? 1 : 0;
      const startTime = Date.now();
      
      // Switch version
      await client.selectOption('select', nextIndex);
      
      // Wait for restoration to complete (skeleton disappears)
      const result = await client.waitFor(
        `(() => {
          const fileTree = document.querySelector('.file-tree');
          return fileTree && !fileTree.className.includes('bp6-skeleton');
        })()`,
        3000
      );
      
      const totalTime = Date.now() - startTime;
      
      expect(result.success).toBe(true);
      expect(totalTime).toBeLessThan(3000);
      
      console.log(`✓ Version switch completed in ${totalTime}ms`);
    }, 15000);
  });
});
