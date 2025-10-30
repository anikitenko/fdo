/**
 * WebSocket Test Server
 * Exposes IPC handlers over WebSocket for E2E tests
 */

import { WebSocketServer } from 'ws';
import { BrowserWindow, app } from 'electron';

let wss = null;
let mainWindow = null;

export function startTestServer(win) {
  // Check for ELECTRON_TEST_MODE instead of NODE_ENV
  if (process.env.ELECTRON_TEST_MODE !== 'true') {
    return;
  }

  mainWindow = win;
  const PORT = 9555;
  
  console.log('[TestServer] Tracking all BrowserWindows for testing');

  wss = new WebSocketServer({ port: PORT });

  wss.on('connection', (ws) => {
    console.log('[TestServer] Client connected');

    ws.on('message', async (data) => {
      try {
        const command = JSON.parse(data.toString());
        console.log('[TestServer] Received command:', command.type);

        const result = await handleCommand(command);
        ws.send(JSON.stringify({ id: command.id, result }));
      } catch (error) {
        ws.send(JSON.stringify({ 
          id: command?.id, 
          error: error.message 
        }));
      }
    });

    ws.on('close', () => {
      console.log('[TestServer] Client disconnected');
    });
  });

  console.log(`[TestServer] ✓ Listening on port ${PORT}`);
}

// Helper to get the target window (editor window if it exists and is focused, otherwise main)
function getTargetWindow() {
  const allWindows = BrowserWindow.getAllWindows();

  // Prefer a window that looks like the editor by title
  const editorByTitle = allWindows.find(w => {
    try {
      const title = w.getTitle() || '';
      return !w.isDestroyed() && /(Plugin\s*Editor|Editor)/i.test(title) && w !== mainWindow;
    } catch (_) {
      return false;
    }
  });
  if (editorByTitle) {
    console.log('[TestServer] Using editor-by-title window:', editorByTitle.getTitle());
    return editorByTitle;
  }

  // Next, try focused window
  const focusedWindow = BrowserWindow.getFocusedWindow();
  if (focusedWindow && !focusedWindow.isDestroyed()) {
    console.log('[TestServer] Using focused window:', focusedWindow.getTitle());
    return focusedWindow;
  }

  // Fallback to any non-main window
  const anyNonMain = allWindows.find(w => w !== mainWindow && !w.isDestroyed());
  if (anyNonMain) {
    console.log('[TestServer] Using non-main window:', anyNonMain.getTitle());
    return anyNonMain;
  }

  // Fallback to main window
  console.log('[TestServer] Using main window');
  return mainWindow;
}

async function handleCommand(command) {
  const targetWindow = getTargetWindow();
  
  if (!targetWindow || targetWindow.isDestroyed()) {
    throw new Error('Target window not available');
  }

  const { type, args } = command;

  switch (type) {
    case 'quit':
      // Explicitly quit Electron app (used to ensure shutdown after tests)
      setImmediate(() => app.quit());
      return { success: true };
    case 'getElement':
      return await targetWindow.webContents.executeJavaScript(`
        (() => {
          const el = document.querySelector('${args.selector}');
          if (!el) return null;
          return {
            exists: true,
            className: el.className,
            textContent: el.textContent?.trim(),
            tagName: el.tagName,
            visible: el.offsetParent !== null,
            value: el.value
          };
        })()
      `);

    case 'getElements':
      return await targetWindow.webContents.executeJavaScript(`
        (() => {
          const elements = Array.from(document.querySelectorAll('${args.selector}'));
          return elements.map(el => ({
            className: el.className,
            textContent: el.textContent?.trim(),
            tagName: el.tagName,
            visible: el.offsetParent !== null
          }));
        })()
      `);

    case 'click':
      return await targetWindow.webContents.executeJavaScript(`
        (() => {
          const el = document.querySelector('${args.selector}');
          if (!el) return { success: false, error: 'Element not found' };
          el.click();
          return { success: true };
        })()
      `);

    case 'selectOption':
      return await targetWindow.webContents.executeJavaScript(`
        (() => {
          const select = document.querySelector('${args.selector}');
          if (!select) return { success: false, error: 'Select not found' };
          select.selectedIndex = ${args.index};
          select.dispatchEvent(new Event('change', { bubbles: true }));
          return { success: true, currentIndex: select.selectedIndex };
        })()
      `);

    case 'eval':
      return await targetWindow.webContents.executeJavaScript(args.code);

    case 'waitFor':
      return await waitForCondition(targetWindow, args.code, args.timeout || 5000);

    case 'monitorClassChanges':
      return await targetWindow.webContents.executeJavaScript(`
        new Promise((resolve) => {
          const el = document.querySelector('${args.selector}');
          if (!el) {
            resolve({ error: 'Element not found' });
            return;
          }
          
          const changes = [];
          const initialClass = el.className;
          changes.push({ time: 0, className: initialClass });
          
          const observer = new MutationObserver((mutations) => {
            mutations.forEach(mutation => {
              if (mutation.attributeName === 'class') {
                changes.push({
                  time: Date.now() - startTime,
                  className: el.className
                });
              }
            });
          });
          
          const startTime = Date.now();
          observer.observe(el, { attributes: true, attributeFilter: ['class'] });
          
          setTimeout(() => {
            observer.disconnect();
            resolve({ changes });
          }, ${args.duration || 1000});
        })
      `);

    case 'getConsoleLogs':
      // Console logs would need to be captured separately
      return [];

    default:
      throw new Error(`Unknown command type: ${type}`);
  }
}

async function waitForCondition(targetWindow, code, timeout) {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    const result = await targetWindow.webContents.executeJavaScript(code);
    if (result) {
      return { success: true, duration: Date.now() - startTime };
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  return { success: false, error: 'Timeout' };
}

export function stopTestServer() {
  if (wss) {
    wss.close();
    wss = null;
    console.log('[TestServer] Stopped');
  }
}

