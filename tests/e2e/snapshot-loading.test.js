/**
 * End-to-End Tests for Snapshot Loading UX  
 * Using IPC-based test harness
 */

const { TestClient } = require('./client');

let client;

beforeAll(async () => {
  client = new TestClient();
  await client.start();
  
  console.log('[Test Setup] Client started successfully');
}, 60000); // 60 second timeout for app startup

afterAll(async () => {
  if (client) {
    console.log('[Cleanup] Auto-approving any close confirmations...');
    
    // Use IPC to directly approve the close without showing Alert
    try {
      await client.eval(`
        (() => {
          console.log('[Cleanup] Approving editor close via IPC...');
          // Directly call the IPC method to approve close
          if (window.electron && window.electron.system && window.electron.system.confirmEditorCloseApproved) {
            window.electron.system.confirmEditorCloseApproved();
            console.log('[Cleanup] Close approved via IPC');
            return true;
          }
          return false;
        })()
      `);
      
      console.log('[Cleanup] Close approved, waiting for window to close...');
      await new Promise(r => setTimeout(r, 1000));
    } catch (err) {
      console.log('[Cleanup] Error approving close:', err.message);
    }
    
    console.log('[Cleanup] Stopping client...');
    await client.stop();
  }
}, 15000);

describe('Snapshot Loading UX', () => {
  
  describe('Initial Load', () => {
    
    it('should create plugin, open editor, and NEVER show skeleton during initial load', async () => {
      // Monitor skeleton class throughout the entire initial load process
      // Step 1: Wait for app to load
      await client.waitForElement('#root', 10000);
      await new Promise(r => setTimeout(r, 1000));
      
      // Step 2: Click on NavigationPluginsButton (text contains "Plugins Activated")
      console.log('[Test] Clicking NavigationPluginsButton...');
      const clickedPluginsButton = await client.eval(`
        (() => {
          const button = Array.from(document.querySelectorAll('button'))
            .find(el => el.textContent.includes('Plugins Activated'));
          if (button) {
            button.click();
            return true;
          }
          return false;
        })()
      `);
      expect(clickedPluginsButton).toBe(true);
      await new Promise(r => setTimeout(r, 500));
      
      // Step 3: Click on "Create plugin" button
      console.log('[Test] Clicking Create plugin button...');
      const clickedCreatePlugin = await client.eval(`
        (() => {
          const button = Array.from(document.querySelectorAll('button'))
            .find(el => el.textContent === 'Create plugin');
          if (button) {
            button.click();
            return true;
          }
          return false;
        })()
      `);
      expect(clickedCreatePlugin).toBe(true);
      
      // Wait longer for dialog to appear (React lazy loading)
      console.log('[Test] Waiting for Create Plugin dialog to appear...');
      await new Promise(r => setTimeout(r, 2000));
      
      // Debug: Check if any dialogs/overlays are visible
      const dialogInfo = await client.eval(`
        (() => {
          const dialogs = Array.from(document.querySelectorAll('[class*="Dialog"], [class*="dialog"], [role="dialog"]'));
          const overlays = Array.from(document.querySelectorAll('[class*="Overlay"], [class*="overlay"]'));
          const inputs = Array.from(document.querySelectorAll('input'));
          return {
            dialogCount: dialogs.length,
            dialogs: dialogs.map(d => ({ className: d.className, visible: d.offsetParent !== null })),
            overlayCount: overlays.length,
            inputCount: inputs.length,
            inputs: inputs.map(i => ({ placeholder: i.placeholder, type: i.type, visible: i.offsetParent !== null }))
          };
        })()
      `);
      console.log('[Test] Dialog info:', JSON.stringify(dialogInfo, null, 2));
      
      // Step 4: Fill in the Name field with a test plugin name
      console.log('[Test] Filling in plugin name...');
      
      const testPluginName = 'E2ETestPlugin';
      const filledName = await client.eval(`
        (() => {
          const nameInput = Array.from(document.querySelectorAll('input'))
            .find(el => el.placeholder && el.placeholder.toLowerCase().includes('name'));
          if (nameInput) {
            // Properly set value for React-controlled inputs
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
              window.HTMLInputElement.prototype,
              'value'
            ).set;
            
            nativeInputValueSetter.call(nameInput, '${testPluginName}');
            
            // Trigger React's onChange
            const event = new Event('input', { bubbles: true });
            nameInput.dispatchEvent(event);
            
            // Blur to ensure React processes the change
            nameInput.blur();
            
            return true;
          }
          return false;
        })()
      `);
      
      if (!filledName) {
        console.log('[Test] Could not find Name input field');
      }
      expect(filledName).toBe(true);
      
      // Wait for React to process the change and check for validation errors
      await new Promise(r => setTimeout(r, 500));
      
      // Check if there's an error popup and dismiss it if present
      const hasErrorPopup = await client.eval(`
        (() => {
          // Look for error messages or alert dialogs
          const alerts = document.querySelectorAll('[class*="Alert"], [class*="alert"], [role="alert"]');
          if (alerts.length > 0) {
            // Try to find and click OK/Close button
            const closeButton = document.querySelector('[class*="Alert"] button, [role="alert"] button');
            if (closeButton) {
              closeButton.click();
              return true;
            }
          }
          return false;
        })()
      `);
      
      if (hasErrorPopup) {
        console.log('[Test] Dismissed error popup');
        await new Promise(r => setTimeout(r, 300));
      }
      
      // Step 5: Click "Open editor" button
      console.log('[Test] Clicking Open editor button...');
      const clickedOpenEditor = await client.eval(`
        (() => {
          const button = Array.from(document.querySelectorAll('button'))
            .find(el => el.textContent.trim() === 'Open editor');
          if (button) {
            button.click();
            return true;
          }
          return false;
        })()
      `);
      expect(clickedOpenEditor).toBe(true);
      
      // Step 6: Wait for BlueprintJS Tree to exist, THEN monitor skeleton
      console.log('[Test] Waiting for file tree to appear...');
      
      // Initialize in-page performance metrics container
      await client.eval(`
        (() => {
          window._perf = { start: performance.now(), marks: {}, events: [], mut: { tree: 0, editor: 0 } };
          window._mark = (n) => { window._perf.marks[n] = performance.now(); };
          window._log = (e, d={}) => { window._perf.events.push({ t: performance.now(), e, ...d }); };
        })()
      `);

      // Wait for BlueprintJS Tree element to exist (more reliable than CSS module class)
      await client.waitFor(
        `(() => document.querySelector('.bp6-tree') !== null)()`,
        15000
      );
      
      console.log('[Test] File tree found, starting skeleton monitoring...');
      await client.eval(`
        (() => {
          const tree = document.querySelector('.bp6-tree');
          if (tree && window._perf) {
            window._mark && window._mark('tree_ready');
            const mo1 = new MutationObserver((muts) => { window._perf.mut.tree += muts.length; });
            mo1.observe(tree, { attributes: true, childList: true, subtree: true });
            window._mo_tree = mo1;
          }
        })()
      `);
      
      // Start monitoring skeleton changes
      await client.eval(`
        (() => {
          window._skeletonLog = [];
          window._monitoringStarted = Date.now();
          
          // Check skeleton state every 30ms for 6 seconds (to catch the "1 second after" issue)
          const checkSkeleton = () => {
            // Find the Tree element - it might be inside a div with file-tree class
            const tree = document.querySelector('.bp6-tree');
            if (tree) {
              const hasSkeleton = tree.classList.contains('bp6-skeleton');
              const currentTime = Date.now() - window._monitoringStarted;
              
              // Only log when state changes to reduce noise
              const lastLog = window._skeletonLog[window._skeletonLog.length - 1];
              if (!lastLog || lastLog.hasSkeleton !== hasSkeleton) {
                window._skeletonLog.push({
                  time: currentTime,
                  hasSkeleton,
                  event: hasSkeleton ? 'SKELETON_ON' : 'SKELETON_OFF'
                });
                if (window._log) window._log('skeleton', { on: hasSkeleton, tms: currentTime });
                console.log('[Skeleton Monitor] ' + currentTime + 'ms: skeleton=' + hasSkeleton);
              }
            }
          };
          
          // Check immediately
          checkSkeleton();
          
          // Continue checking every 30ms
          window._skeletonInterval = setInterval(checkSkeleton, 30);
          
          // Stop after 6 seconds (to catch delayed skeleton appearance)
          setTimeout(() => {
            clearInterval(window._skeletonInterval);
            console.log('[Skeleton Monitor] Monitoring complete - total events: ' + window._skeletonLog.length);
          }, 6000);
        })()
      `);
      
      // Wait for Monaco editor to load
      console.log('[Test] Waiting for Monaco editor to load...');
      let editorReady = false;
      for (let i = 0; i < 20; i++) {  // Try for up to 10 seconds
        editorReady = await client.eval(`
          (() => {
            const editorContainer = document.querySelector('.monaco-editor');
            const anyMonaco = document.querySelector('[class*="monaco"]');
            
            if (editorContainer) {
              const hasViewLines = editorContainer.querySelector('.view-lines');
              const hasScrollable = editorContainer.querySelector('.monaco-scrollable-element');
              return hasViewLines !== null || hasScrollable !== null;
            }
            
            return anyMonaco !== null;
          })()
        `);
        
        if (editorReady) {
          console.log('[Test] Monaco editor loaded successfully after', (i * 500), 'ms');
          // Mark editor_ready and attach mutation observer for editor container
          await client.eval(`
            (() => {
              if (window._mark) window._mark('editor_ready');
              const ed = document.querySelector('.monaco-editor');
              if (ed && window._perf) {
                const mo2 = new MutationObserver((muts) => { window._perf.mut.editor += muts.length; });
                mo2.observe(ed, { attributes: true, childList: true, subtree: true });
                window._mo_editor = mo2;
              }
            })()
          `);
          break;
        }
        
        await new Promise(r => setTimeout(r, 500));
      }
      
      // Wait for monitoring to complete (6 seconds total)
      await new Promise(r => setTimeout(r, 6500));
      
      // Retrieve skeleton log
      const skeletonLog = await client.eval(`window._skeletonLog`);
      console.log('[Test] Skeleton transition log:');
      skeletonLog.forEach(entry => {
        console.log(`  ${entry.time}ms: ${entry.event}`);
      });
      
      // Verify index file content is visible in editor after initial load (poll up to 2s)
      let indexContentOk = false;
      for (let i = 0; i < 10; i++) {
        indexContentOk = await client.eval(`
          (() => {
            const models = (window.monaco?.editor?.getModels?.() || []);
            const model = models.find(m => {
              const p = (m?.uri?.path || m?.uri?.fsPath || '').toLowerCase();
              return p.endsWith('/index.ts') || p.endsWith('/index.js');
            });
            return !!(model && model.getValue().trim().length > 0);
          })()
        `);
        if (indexContentOk) {
          await client.eval(`window._mark && window._mark('index_content_ready')`);
          break;
        }
        await new Promise(r => setTimeout(r, 200));
      }
      expect(indexContentOk).toBe(true);

      // Verify file tree renders index file label
      const hasIndexInTree = await client.eval(`
        (() => {
          const nodes = Array.from(document.querySelectorAll('.bp6-tree .bp6-tree-node-content'));
          return nodes.some(n => /index\.(t|j)sx?/i.test(n.textContent || ''));
        })()
      `);
      expect(hasIndexInTree).toBe(true);

      // CRITICAL: Skeleton should NEVER appear during initial load
      const skeletonEverAppeared = skeletonLog.some(entry => entry.hasSkeleton);
      
      if (skeletonEverAppeared) {
        console.error('[Test] ❌ FAIL: Skeleton appeared during initial load!');
        console.error('[Test] This causes a bad UX flash. Skeleton should only appear on version switch.');
      } else {
        console.log('[Test] ✅ PASS: Skeleton never appeared during initial load');
      }
      
      expect(editorReady).toBe(true);
      expect(skeletonEverAppeared).toBe(false); // MUST be false for initial load!
      
      // Dump perf metrics for initial load and assert mutation bounds to prevent excessive re-renders
      const perf = await client.eval(`window._perf`);
      if (perf && perf.marks) {
        const toMs = (a,b) => (a!==undefined && b!==undefined) ? Math.round((a - b)) : null;
        const tTree = toMs(perf.marks.tree_ready, perf.start);
        const tEditor = toMs(perf.marks.editor_ready, perf.start);
        const tIndex = toMs(perf.marks.index_content_ready, perf.start);
        console.log(`[Metrics] initial: tree_ready=${tTree}ms, editor_ready=${tEditor}ms, index_content=${tIndex}ms, mut(tree)=${perf.mut.tree}, mut(editor)=${perf.mut.editor}`);
        // Reasonable upper bounds to catch regressions (tweak if environment requires)
        expect(perf.mut.tree).toBeLessThan(400);
        expect(perf.mut.editor).toBeLessThan(400);
      }
    }, 30000);
    
    it('should restore files silently in background', async () => {
      // Wait for files to appear in the tree
      const files = await client.getElements('[data-icon]');
      
      expect(files.length).toBeGreaterThan(0);
    });
    
    it('should complete initial load with Monaco ready', async () => {
      // Monaco should already be loaded from previous test, but double-check with polling
      let editorReady = false;
      for (let i = 0; i < 10; i++) {  // Try for up to 5 seconds
        editorReady = await client.eval(`
          (() => {
            const editorContainer = document.querySelector('.monaco-editor');
            if (!editorContainer) return false;
            
            const hasViewLines = editorContainer.querySelector('.view-lines');
            const hasScrollable = editorContainer.querySelector('.monaco-scrollable-element');
            
            return hasViewLines !== null || hasScrollable !== null;
          })()
        `);
        
        if (editorReady) break;
        await new Promise(r => setTimeout(r, 500));
      }
      
      expect(editorReady).toBe(true);
    }, 10000);
  });
  
  describe('Version Switch', () => {
    
    it('should create multiple test snapshots for version switching', async () => {
      console.log('[Test] Creating first snapshot...');
      
      // Create first snapshot
      let snapshotCreated = await client.eval(`
        (() => {
          const buttons = Array.from(document.querySelectorAll('button'));
          const createButton = buttons.find(btn => 
            btn.textContent.includes('Create snapshot')
          );
          
          if (createButton) {
            console.log('[Test] Clicking snapshot button:', createButton.textContent);
            createButton.click();
            return true;
          }
          return false;
        })()
      `);
      
      expect(snapshotCreated).toBe(true);
      
      // Wait for snapshot creation to complete (look for skeleton to disappear)
      console.log('[Test] Waiting for first snapshot creation to complete...');
      await new Promise(r => setTimeout(r, 500)); // Wait for skeleton to appear
      
      await client.waitFor(
        `(() => {
          const tree = document.querySelector('.bp6-tree');
          return tree && !tree.classList.contains('bp6-skeleton');
        })()`,
        5000
      );
      
      console.log('[Test] First snapshot created successfully');
      
      // Verify snapshot was created
      const currentSnapshot1 = await client.getSnapshotsSelectText();
      console.log('[Test] Current snapshot after first create:', currentSnapshot1);
      expect(currentSnapshot1).toBeTruthy(); // Should have a snapshot version
      
      // Open snapshots menu
      console.log('[Test] Opening snapshot selector to verify count...');
      const openResult = await client.clickSnapshotsSelect();
      console.log('[Test] Open result:', openResult);
      await new Promise(r => setTimeout(r, 500)); // Wait for menu to render
      
      const menuItems1 = await client.getBlueprintMenuItems();
      console.log('[Test] Available snapshots after first create:', menuItems1.length);
      console.log('[Test] Snapshot list:', menuItems1.map(m => m.text));
      
      // Close menu by clicking elsewhere or pressing Escape
      await client.eval(`document.body.click()`);
      await new Promise(r => setTimeout(r, 200));
      
      expect(menuItems1.length).toBeGreaterThanOrEqual(2); // Initial + 1 created
      
      // Make a small change to the file
      console.log('[Test] Making a change to create a second snapshot...');
      await client.eval(`
        (() => {
          // Add a comment to the file to make a change
          const editor = document.querySelector('.monaco-editor');
          if (editor) {
            // Trigger a text change via Monaco API
            if (window.monaco) {
              const model = window.monaco.editor.getModels()[0];
              if (model) {
                const currentValue = model.getValue();
                model.setValue(currentValue + '\\n// Test comment for snapshot 2');
                console.log('[Test] Added comment to file');
              }
            }
          }
        })()
      `);
      
      await new Promise(r => setTimeout(r, 500));
      
      // Create second snapshot
      console.log('[Test] Creating second snapshot...');
      snapshotCreated = await client.eval(`
        (() => {
          const buttons = Array.from(document.querySelectorAll('button'));
          const createButton = buttons.find(btn => 
            btn.textContent.includes('Create snapshot')
          );
          
          if (createButton) {
            createButton.click();
            return true;
          }
          return false;
        })()
      `);
      
      expect(snapshotCreated).toBe(true);
      
      // Wait for second snapshot creation
      console.log('[Test] Waiting for second snapshot creation to complete...');
      await new Promise(r => setTimeout(r, 500));
      
      await client.waitFor(
        `(() => {
          const tree = document.querySelector('.bp6-tree');
          return tree && !tree.classList.contains('bp6-skeleton');
        })()`,
        5000
      );
      
      console.log('[Test] Second snapshot created successfully');
      
      // Verify we now have more snapshots
      await client.clickSnapshotsSelect();
      await new Promise(r => setTimeout(r, 500));
      
      const menuItems2 = await client.getBlueprintMenuItems();
      console.log('[Test] Available snapshots after second create:', menuItems2.length);
      console.log('[Test] Snapshot list:', menuItems2.map(m => m.text));
      
      // Close menu
      await client.eval(`document.body.click()`);
      await new Promise(r => setTimeout(r, 200));
      
      expect(menuItems2.length).toBeGreaterThanOrEqual(3); // Initial + 2 created
      
      console.log('[Test] ✅ Successfully created multiple snapshots for version switching tests');
    }, 30000);
    
    it('should show skeleton immediately and smoothly when switching versions', async () => {
      console.log('[Test] Starting version switch UX analysis...');
      
      // Get current snapshot
      const currentSnapshot = await client.getSnapshotsSelectText();
      console.log('[Test] Current snapshot:', currentSnapshot);
      
      // Open menu to see available snapshots
      await client.clickSnapshotsSelect();
      await new Promise(r => setTimeout(r, 500));
      
      const menuItems = await client.getBlueprintMenuItems();
      console.log('[Test] Available snapshots:', menuItems.length);
      menuItems.forEach((item, i) => {
        console.log(`  [${i}] ${item.text} ${item.selected ? '(current)' : ''}`);
      });
      
      expect(menuItems.length).toBeGreaterThanOrEqual(3);
      
      // Find a non-selected snapshot to switch to
      const targetItem = menuItems.find(item => !item.selected);
      if (!targetItem) {
        console.log('[Test] No non-selected snapshot found, using first item');
      }
      const targetText = targetItem ? targetItem.text : menuItems[0].text;
      console.log('[Test] Switching to snapshot:', targetText);
      
      // Start monitoring skeleton BEFORE the switch
      await client.eval(`
        (() => {
          window._switchLog = [];
          window._switchStarted = Date.now();
          
          const checkSkeleton = () => {
            const tree = document.querySelector('.bp6-tree');
            if (tree) {
              const hasSkeleton = tree.classList.contains('bp6-skeleton');
              const currentTime = Date.now() - window._switchStarted;
              
              const lastLog = window._switchLog[window._switchLog.length - 1];
              if (!lastLog || lastLog.hasSkeleton !== hasSkeleton) {
                window._switchLog.push({
                  time: currentTime,
                  hasSkeleton,
                  event: hasSkeleton ? 'SKELETON_ON' : 'SKELETON_OFF'
                });
                console.log('[Switch Monitor] ' + currentTime + 'ms: skeleton=' + hasSkeleton);
              }
            }
          };
          
          checkSkeleton();
          window._switchInterval = setInterval(checkSkeleton, 20); // Check every 20ms for precise timing
          
          setTimeout(() => {
            clearInterval(window._switchInterval);
            console.log('[Switch Monitor] Monitoring complete');
          }, 4000); // Monitor for 4 seconds
        })()
      `);
      
      // Trigger the switch by clicking the menu item
      console.log('[Test] Clicking menu item to switch...');
      const clickResult = await client.clickBlueprintMenuItem(targetText);
      console.log('[Test] Menu item click result:', clickResult);
      await client.eval(`window._mark && window._mark('switch_start')`);
      
      // Handle the confirmation popup ASAP (poll up to 1s)
      console.log('[Test] Looking for confirmation popup...');
      let alertHandled = false;
      for (let i = 0; i < 20; i++) {
        alertHandled = await client.eval(`
          (() => {
            const alerts = document.querySelectorAll('.bp6-alert');
            if (alerts.length > 0) {
              const buttons = Array.from(alerts[0].querySelectorAll('button'));
              const switchButton = buttons.find(btn => btn.textContent.trim() === 'Switch');
              const okButton = buttons.find(btn => btn.textContent.trim() === 'OK');
              const toClick = switchButton || okButton;
              if (toClick) { toClick.click(); return true; }
            }
            return false;
          })()
        `);
        if (alertHandled) break;
        await new Promise(r => setTimeout(r, 50));
      }
      
      console.log('[Test] Alert handled:', alertHandled);
      expect(alertHandled).toBe(true);
      await client.eval(`window._mark && window._mark('switch_confirm')`);
      
      // Wait for switch to complete
      await new Promise(r => setTimeout(r, 4500));
      
      // Retrieve switch log
      const switchLog = await client.eval(`window._switchLog`);
      console.log('[Test] Version switch skeleton transitions:');
      switchLog.forEach(entry => {
        console.log(`  ${entry.time}ms: ${entry.event}`);
      });
      
      // Analyze the transitions
      const hadSkeleton = switchLog.some(entry => entry.hasSkeleton);
      expect(hadSkeleton).toBe(true); // Skeleton SHOULD appear during switch
      
      // Check that skeleton appeared quickly (within 200ms)
      const firstSkeletonOn = switchLog.find(e => e.hasSkeleton);
      if (firstSkeletonOn) {
        console.log(`[Test] ✓ Skeleton appeared at ${firstSkeletonOn.time}ms`);
        expect(firstSkeletonOn.time).toBeLessThan(200);
      }
      
      // Check that skeleton disappeared (switch completed)
      const lastEntry = switchLog[switchLog.length - 1];
      expect(lastEntry.hasSkeleton).toBe(false); // Should end with skeleton OFF

      // Compute transition count (off->on->off expected = 2 state changes)
      const transitionsCount = switchLog.reduce((acc, curr, idx, arr) => {
        if (idx === 0) return 0;
        return acc + (curr.hasSkeleton !== arr[idx - 1].hasSkeleton ? 1 : 0);
      }, 0);
      expect(transitionsCount).toBe(2);
      
      // Emit switch metrics
      const firstOn = switchLog.find(e => e.hasSkeleton);
      const switchMetrics = await client.eval(`window._perf`);
      if (switchMetrics && switchMetrics.marks) {
        const start = switchMetrics.marks.switch_start || 0;
        const confirm = switchMetrics.marks.switch_confirm || 0;
        const tFirstOn = firstOn ? firstOn.time : null;
        const tComplete = lastEntry ? lastEntry.time : null;
        console.log(`[Metrics] switch: alert_to_confirm=${Math.round(confirm - start)}ms, first_on=${tFirstOn}ms, complete=${tComplete}ms, mut(tree)=${switchMetrics.mut?.tree||0}, mut(editor)=${switchMetrics.mut?.editor||0}`);
      }

      console.log('[Test] ✅ Version switch skeleton timing validated');
    }, 20000);
    
    it('should NOT flicker skeleton multiple times', async () => {
      console.log('[Test] Testing for skeleton flicker during version switch...');
      
      // Open menu to get available snapshots
      await client.clickSnapshotsSelect();
      await new Promise(r => setTimeout(r, 500));
      
      const menuItems = await client.getBlueprintMenuItems();
      if (menuItems.length < 2) {
        console.log('[Test] Not enough snapshots for flicker test');
        return;
      }
      
      // Find next snapshot to switch to
      const currentItem = menuItems.find(item => item.selected);
      const currentIndex = menuItems.indexOf(currentItem);
      const nextIndex = (currentIndex + 1) % menuItems.length;
      const targetText = menuItems[nextIndex].text;
      
      console.log('[Test] Switching to snapshot:', targetText);
      
      // Start monitoring
      await client.eval(`
        (() => {
          window._flickerLog = [];
          window._flickerStarted = Date.now();
          
          const checkSkeleton = () => {
            const tree = document.querySelector('.bp6-tree');
            if (tree) {
              const hasSkeleton = tree.classList.contains('bp6-skeleton');
              const currentTime = Date.now() - window._flickerStarted;
              
              const lastLog = window._flickerLog[window._flickerLog.length - 1];
              if (!lastLog || lastLog.hasSkeleton !== hasSkeleton) {
                window._flickerLog.push({
                  time: currentTime,
                  hasSkeleton
                });
              }
            }
          };
          
          checkSkeleton();
          window._flickerInterval = setInterval(checkSkeleton, 20);
          
          setTimeout(() => {
            clearInterval(window._flickerInterval);
          }, 5000);
        })()
      `);
      
      // Trigger switch
      await client.clickBlueprintMenuItem(targetText);
      
      // Handle popup - click "Switch" button
      await new Promise(r => setTimeout(r, 500));
      await client.eval(`
        (() => {
          const alerts = document.querySelectorAll('.bp6-alert');
          console.log('[Test] Found ' + alerts.length + ' alerts');
          if (alerts.length > 0) {
            const buttons = Array.from(alerts[0].querySelectorAll('button'));
            console.log('[Test] Alert buttons:', buttons.map(b => '"' + b.textContent.trim() + '"').join(', '));
            
            const switchButton = buttons.find(btn => btn.textContent.trim() === 'Switch');
            if (switchButton) {
              console.log('[Test] Clicking Switch button on version switch confirmation');
              switchButton.click();
            } else {
              console.error('[Test] Switch button not found! Available buttons:', buttons.map(b => b.textContent.trim()));
            }
          } else {
            console.error('[Test] No alerts found!');
          }
        })()
      `);
      
      // Wait for monitoring to complete
      await new Promise(r => setTimeout(r, 5500));
      
      const result = { changes: await client.eval(`window._flickerLog`) };
      
      // Log all changes for debugging
      console.log('[Test] Skeleton state changes during version switch:');
      result.changes.forEach((change, i) => {
        console.log(`  ${i}: ${change.time}ms - skeleton: ${change.hasSkeleton}`);
      });
      
      // Count skeleton state transitions
      let transitions = [];
      let previousHadSkeleton = result.changes[0]?.hasSkeleton || false;
      transitions.push({ time: 0, state: previousHadSkeleton ? 'on' : 'off' });
      
      for (const change of result.changes.slice(1)) {
        const currentHasSkeleton = change.hasSkeleton;
        if (currentHasSkeleton !== previousHadSkeleton) {
          transitions.push({ 
            time: change.time, 
            state: currentHasSkeleton ? 'on' : 'off' 
          });
          previousHadSkeleton = currentHasSkeleton;
        }
      }
      
      console.log('[Test] Skeleton transitions:', JSON.stringify(transitions, null, 2));
      
      // Expected sequence: off -> on (switch start) -> off (restoration complete)
      // BAD sequence: off -> on -> off -> on (flicker!) -> off
      
      // Should have at most 2 transitions: add skeleton, remove skeleton
      expect(transitions.length - 1).toBeLessThanOrEqual(2); // -1 for initial state
      
      console.log(`✓ Skeleton had ${transitions.length - 1} state transitions (expected ≤ 2)`);
    }, 15000);
    
    it('should complete version switch in less than 3 seconds', async () => {
      console.log('[Test] Starting timed version switch test...');
      
      // Open menu to get snapshots
      await client.clickSnapshotsSelect();
      await new Promise(r => setTimeout(r, 500));
      
      const menuItems = await client.getBlueprintMenuItems();
      if (menuItems.length < 2) {
        console.log('[Test] Not enough snapshots for timing test');
        return;
      }
      
      // Find first snapshot (should be different from current)
      const targetText = menuItems[0].text;
      console.log('[Test] Switching to snapshot:', targetText);
      
      const startTime = Date.now();
      
      // Switch version
      await client.clickBlueprintMenuItem(targetText);
      
      // Handle popup immediately - click "Switch" button (poll up to 1s)
      for (let i = 0; i < 20; i++) {
        const handled = await client.eval(`
          (() => {
            const alerts = document.querySelectorAll('.bp6-alert');
            if (alerts.length > 0) {
              const buttons = Array.from(alerts[0].querySelectorAll('button'));
              const switchButton = buttons.find(btn => btn.textContent.trim() === 'Switch');
              if (switchButton) { switchButton.click(); return true; }
            }
            return false;
          })()
        `);
        if (handled) break;
        await new Promise(r => setTimeout(r, 50));
      }
      
      // Wait for restoration to complete (skeleton disappears)
      const result = await client.waitFor(
        `(() => {
          const fileTree = document.querySelector('.bp6-tree');
          return fileTree && !fileTree.className.includes('bp6-skeleton');
        })()`,
        3000
      );
      
      const totalTime = Date.now() - startTime;
      
      expect(result.success).toBe(true);
      expect(totalTime).toBeLessThan(3000);
      
      // Verify editor shows content after switch completes (poll up to 2s)
      let indexContentOkAfterSwitch = false;
      for (let i = 0; i < 10; i++) {
        indexContentOkAfterSwitch = await client.eval(`
          (() => {
            const models = (window.monaco?.editor?.getModels?.() || []);
            const model = models.find(m => {
              const p = (m?.uri?.path || m?.uri?.fsPath || '').toLowerCase();
              return p.endsWith('/index.ts') || p.endsWith('/index.js');
            });
            return !!(model && model.getValue().trim().length > 0);
          })()
        `);
        if (indexContentOkAfterSwitch) break;
        await new Promise(r => setTimeout(r, 200));
      }
      expect(indexContentOkAfterSwitch).toBe(true);

      console.log(`✓ Version switch completed in ${totalTime}ms`);
    }, 15000);
  });
});
