/**
 * IPC handlers for E2E testing
 * Only enabled when NODE_ENV=test
 */

import { ipcMain, BrowserWindow } from 'electron';

let isTestMode = false;

export function enableTestHandlers() {
  if (process.env.NODE_ENV !== 'test') {
    console.warn('Test handlers should only be enabled in test mode');
    return;
  }
  
  isTestMode = true;
  console.log('[TEST] Enabling test IPC handlers');

  // Get DOM element info
  ipcMain.handle('test:getElement', async (event, selector) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return null;
    
    return await event.sender.executeJavaScript(`
      (() => {
        const el = document.querySelector('${selector}');
        if (!el) return null;
        return {
          exists: true,
          className: el.className,
          textContent: el.textContent,
          tagName: el.tagName,
          visible: el.offsetParent !== null
        };
      })()
    `);
  });

  // Get all matching elements
  ipcMain.handle('test:getElements', async (event, selector) => {
    return await event.sender.executeJavaScript(`
      (() => {
        const elements = Array.from(document.querySelectorAll('${selector}'));
        return elements.map(el => ({
          className: el.className,
          textContent: el.textContent,
          tagName: el.tagName,
          visible: el.offsetParent !== null
        }));
      })()
    `);
  });

  // Execute arbitrary JavaScript in renderer
  ipcMain.handle('test:eval', async (event, code) => {
    return await event.sender.executeJavaScript(code);
  });

  // Click element
  ipcMain.handle('test:click', async (event, selector) => {
    return await event.sender.executeJavaScript(`
      (() => {
        const el = document.querySelector('${selector}');
        if (!el) return { success: false, error: 'Element not found' };
        el.click();
        return { success: true };
      })()
    `);
  });

  // Change select value
  ipcMain.handle('test:selectOption', async (event, selector, index) => {
    return await event.sender.executeJavaScript(`
      (() => {
        const select = document.querySelector('${selector}');
        if (!select) return { success: false, error: 'Select not found' };
        select.selectedIndex = ${index};
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return { success: true };
      })()
    `);
  });

  // Wait for element
  ipcMain.handle('test:waitForElement', async (event, selector, timeout = 5000) => {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      const result = await event.sender.executeJavaScript(`
        document.querySelector('${selector}') !== null
      `);
      
      if (result) {
        return { success: true };
      }
      
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    return { success: false, error: 'Timeout waiting for element' };
  });

  // Get console logs
  const consoleLogs = [];
  ipcMain.on('test:console-log', (event, message) => {
    consoleLogs.push(message);
  });

  ipcMain.handle('test:getConsoleLogs', () => {
    return consoleLogs.splice(0); // Return and clear
  });

  // Monitor class changes
  ipcMain.handle('test:monitorClassChanges', async (event, selector, duration = 1000) => {
    return await event.sender.executeJavaScript(`
      new Promise((resolve) => {
        const el = document.querySelector('${selector}');
        if (!el) {
          resolve({ error: 'Element not found' });
          return;
        }
        
        const changes = [];
        const observer = new MutationObserver((mutations) => {
          mutations.forEach(mutation => {
            if (mutation.attributeName === 'class') {
              changes.push({
                time: Date.now(),
                className: el.className
              });
            }
          });
        });
        
        observer.observe(el, { attributes: true, attributeFilter: ['class'] });
        
        setTimeout(() => {
          observer.disconnect();
          resolve({ changes });
        }, ${duration});
      })
    `);
  });

  // Get app ready state
  ipcMain.handle('test:isAppReady', async (event) => {
    return await event.sender.executeJavaScript(`
      (() => {
        return {
          monaco: typeof window.monaco !== 'undefined',
          react: typeof window.React !== 'undefined',
          fileTree: document.querySelector('.file-tree') !== null
        };
      })()
    `);
  });
}

export function isInTestMode() {
  return isTestMode;
}



