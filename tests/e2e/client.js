/**
 * E2E Test Client
 * Communicates with Electron app via WebSocket
 */

const WebSocket = require('ws');
const { ElectronTestApp } = require('./launcher');

class TestClient {
  constructor() {
    this.app = null;
    this.ws = null;
    this.commandId = 0;
    this.pendingCommands = new Map();
  }

  async start() {
    // Check if SKIP_LAUNCH env var is set (for manual app launch)
    const skipLaunch = process.env.SKIP_LAUNCH === 'true';
    
    if (skipLaunch) {
      console.log('[TestClient] Skipping app launch - expecting manually started app');
    } else {
      // Launch Electron app
      this.app = new ElectronTestApp();
      await this.app.launch();
    }

    // Connect to test server
    await this.connect();
    
    return this;
  }

  async connect(port = 9555, maxRetries = 10, retryDelay = 1000) {
    console.log(`[TestClient] Connecting to test server on port ${port}...`);
    
    const endpoints = [`ws://127.0.0.1:${port}`, `ws://localhost:${port}`];
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        await new Promise((resolve, reject) => {
          let connected = false;
          let lastError = null;
          let attemptsLeft = endpoints.length;
          
          const tryConnect = (url) => {
            const ws = new WebSocket(url);
            
            const timeout = setTimeout(() => {
              ws.terminate();
              lastError = new Error('Connection attempt timeout');
              next();
            }, retryDelay);
            
            ws.on('open', () => {
              if (connected) return;
              clearTimeout(timeout);
              connected = true;
              this.ws = ws;
              
              // Set up message handler
              this.ws.on('message', (data) => {
                const response = JSON.parse(data.toString());
                const pending = this.pendingCommands.get(response.id);
                
                if (pending) {
                  this.pendingCommands.delete(response.id);
                  if (response.error) {
                    pending.reject(new Error(response.error));
                  } else {
                    pending.resolve(response.result);
                  }
                }
              });
              
              console.log('[TestClient] ✓ Connected to test server at', url);
              resolve();
            });
            
            ws.on('error', (error) => {
              clearTimeout(timeout);
              lastError = error;
              next();
            });
          };
          
          const next = () => {
            if (connected) return;
            attemptsLeft -= 1;
            if (attemptsLeft <= 0) {
              reject(lastError || new Error('All endpoints failed'));
              return;
            }
            const nextUrl = endpoints[endpoints.length - attemptsLeft];
            tryConnect(nextUrl);
          };
          
          // Start with first endpoint
          tryConnect(endpoints[0]);
        });
        
        return; // Success!
        
      } catch (error) {
        if (attempt === maxRetries - 1) {
          throw new Error(`Failed to connect to test server after ${maxRetries} attempts`);
        }
        console.log(`[TestClient] Connection attempt ${attempt + 1} failed, retrying...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }
  }

  async sendCommand(type, args = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.commandId;
      
      this.pendingCommands.set(id, { resolve, reject });
      
      this.ws.send(JSON.stringify({ id, type, args }));

      // Timeout after 10 seconds
      setTimeout(() => {
        if (this.pendingCommands.has(id)) {
          this.pendingCommands.delete(id);
          reject(new Error(`Command timeout: ${type}`));
        }
      }, 10000);
    });
  }

  async stop() {
    console.log('[TestClient] Stopping...');
    
    // If Electron was started externally (SKIP_LAUNCH=true), request app quit via WS first
    if (this.ws && (!this.app || process.env.SKIP_LAUNCH === 'true')) {
      try {
        await this.sendCommand('quit');
      } catch (_) {
        // Ignore errors on quit; the socket may close before response
      }
    }

    if (this.ws) {
      console.log('[TestClient] Closing WebSocket...');
      this.ws.close();
      this.ws = null;
    }
    
    if (this.app) {
      console.log('[TestClient] Closing Electron app...');
      await this.app.close();
      this.app = null;
    }
    
    console.log('[TestClient] Stopped successfully');
  }

  // High-level API

  async getElement(selector) {
    return await this.sendCommand('getElement', { selector });
  }

  async getElements(selector) {
    return await this.sendCommand('getElements', { selector });
  }

  async click(selector) {
    return await this.sendCommand('click', { selector });
  }

  async selectOption(selector, index) {
    return await this.sendCommand('selectOption', { selector, index });
  }

  // BlueprintJS-specific methods
  
  async clickBlueprintSelect(selectSelector) {
    // Click the button inside a BlueprintJS Select to open the menu
    return await this.eval(`
      (() => {
        const selectContainer = document.querySelector('${selectSelector}');
        if (!selectContainer) return { success: false, error: 'Select container not found' };
        
        const button = selectContainer.querySelector('button');
        if (!button) return { success: false, error: 'Select button not found' };
        
        button.click();
        return { success: true };
      })()
    `);
  }
  
  // Helper specifically for the Snapshots Select in CodeDeployActions
  async clickSnapshotsSelect() {
    return await this.eval(`
      (() => {
        const formGroups = Array.from(document.querySelectorAll('.bp6-form-group'));
        const snapshotGroup = formGroups.find(fg => {
          const label = fg.querySelector('label');
          return label && label.textContent.includes('Snapshots');
        });
        
        if (!snapshotGroup) return { success: false, error: 'Snapshots FormGroup not found' };
        
        const button = snapshotGroup.querySelector('.bp6-popover-target button');
        if (!button) return { success: false, error: 'Snapshots button not found' };
        
        button.click();
        return { success: true };
      })()
    `);
  }
  
  async getSnapshotsSelectText() {
    return await this.eval(`
      (() => {
        const formGroups = Array.from(document.querySelectorAll('.bp6-form-group'));
        const snapshotGroup = formGroups.find(fg => {
          const label = fg.querySelector('label');
          return label && label.textContent.includes('Snapshots');
        });
        
        if (!snapshotGroup) return null;
        
        const button = snapshotGroup.querySelector('.bp6-popover-target button');
        return button ? button.textContent.trim() : null;
      })()
    `);
  }
  
  async clickBlueprintMenuItem(menuItemText) {
    // Click a menu item by its text content
    return await this.eval(`
      (() => {
        // Wait a moment for menu to render
        const menuItems = Array.from(document.querySelectorAll('.bp6-menu-item'));
        const item = menuItems.find(mi => mi.textContent.includes('${menuItemText}'));
        
        if (!item) {
          console.log('[Test] Available menu items:', menuItems.map(mi => mi.textContent));
          return { success: false, error: 'Menu item not found', available: menuItems.map(mi => mi.textContent) };
        }
        
        item.click();
        return { success: true };
      })()
    `);
  }
  
  async getBlueprintSelectText(selectSelector) {
    // Get the currently selected text from a BlueprintJS Select
    return await this.eval(`
      (() => {
        const selectContainer = document.querySelector('${selectSelector}');
        if (!selectContainer) return null;
        
        const button = selectContainer.querySelector('button');
        return button ? button.textContent.trim() : null;
      })()
    `);
  }
  
  async getBlueprintMenuItems() {
    // Get all visible menu item texts
    return await this.eval(`
      (() => {
        const menuItems = Array.from(document.querySelectorAll('.bp6-menu-item'));
        return menuItems.map(mi => ({
          text: mi.textContent.trim(),
          disabled: mi.classList.contains('bp6-disabled'),
          selected: mi.classList.contains('bp6-active') || mi.classList.contains('selected-item')
        }));
      })()
    `);
  }

  async eval(code) {
    return await this.sendCommand('eval', { code });
  }

  async waitFor(condition, timeout = 5000) {
    return await this.sendCommand('waitFor', { code: condition, timeout });
  }

  async monitorClassChanges(selector, duration = 1000) {
    return await this.sendCommand('monitorClassChanges', { selector, duration });
  }

  // Helper methods

  async hasClass(selector, className) {
    const el = await this.getElement(selector);
    return el && el.className.includes(className);
  }

  async getText(selector) {
    const el = await this.getElement(selector);
    return el ? el.textContent : null;
  }

  async waitForElement(selector, timeout = 5000) {
    const result = await this.waitFor(
      `document.querySelector('${selector}') !== null`,
      timeout
    );
    if (!result.success) {
      throw new Error(`Timeout waiting for element: ${selector}`);
    }
  }
}

module.exports = { TestClient };

