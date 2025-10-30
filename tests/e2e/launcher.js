/**
 * Electron App Launcher for E2E Testing
 * Programmatically launches and controls the Electron app
 */

const { spawn } = require('child_process');
const { join } = require('path');
const electron = require('electron');
const net = require('net');

// Helper function to check if a port is open
function isPortOpen(port, host = 'localhost') {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const timeout = 200;
    
    socket.setTimeout(timeout);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
    
    socket.connect(port, host);
  });
}

class ElectronTestApp {
  constructor() {
    this.process = null;
    this.mainWindow = null;
    this.pid = null;
  }

  async launch() {
    return new Promise((resolve, reject) => {
      console.log('[Launcher] Starting Electron app...');

      const testEnv = {
        ...process.env,
        ELECTRON_TEST_MODE: 'true',
        ELECTRON_ENABLE_LOGGING: '1',
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
      };

      const mainScript = join(__dirname, '../../dist/main/index.js');
      const absoluteMainScript = require('path').resolve(mainScript);

      console.log(`[Launcher] Spawning Electron with ELECTRON_TEST_MODE=${testEnv.ELECTRON_TEST_MODE}`);
      console.log(`[Launcher] Electron binary: ${electron}`);
      console.log(`[Launcher] Main script: ${absoluteMainScript}`);

      this.process = spawn(electron, [absoluteMainScript], {
        env: testEnv,
        stdio: 'inherit',
        detached: true
      });

      this.pid = this.process.pid;
      this.process.unref();

      console.log(`[Launcher] Electron spawned (PID: ${this.pid}), waiting for test server...`);

      const targetPort = parseInt(process.env.E2E_TEST_SERVER_PORT || '9555', 10);
      const timeoutMs = 30000;
      const pollIntervalMs = 250;
      const startTime = Date.now();

      let settled = false;

      const cleanupListeners = () => {
        if (this.process) {
          this.process.removeAllListeners('exit');
          this.process.removeAllListeners('error');
        }
      };

      const handleFailure = (error) => {
        if (settled) return;
        settled = true;
        cleanupListeners();
        reject(error);
      };

      this.process.once('error', (error) => {
        handleFailure(new Error(`[Launcher] Electron process error: ${error.message}`));
      });

      this.process.once('exit', (code, signal) => {
        handleFailure(new Error(`[Launcher] Electron exited before test server was ready (code=${code}, signal=${signal || 'none'})`));
      });

      const waitForServer = async () => {
        while (!settled && (Date.now() - startTime) < timeoutMs) {
          const open = await isPortOpen(targetPort);
          if (open) {
            settled = true;
            cleanupListeners();
            console.log(`[Launcher] ✓ Test server is ready on port ${targetPort}`);
            resolve(this);
            return;
          }
          await new Promise((r) => setTimeout(r, pollIntervalMs));
        }

        if (!settled) {
          handleFailure(new Error(`[Launcher] Test server did not start listening on port ${targetPort} within ${timeoutMs}ms`));
        }
      };

      waitForServer();
    });
  }

  async close() {
    if (this.pid) {
      try {
        console.log(`[Launcher] Sending SIGTERM to Electron process group (PID: ${this.pid})...`);
        // Kill the detached process group (negative PID)
        process.kill(-this.pid, 'SIGTERM');
        
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Force kill if still running
        try {
          process.kill(-this.pid, 'SIGKILL');
        } catch (e) {
          // Already dead, that's fine
        }
        
        console.log('[Launcher] Electron process terminated');
      } catch (error) {
        // Process already dead
        console.log(`[Launcher] Process already terminated (${error.code || error.message})`);
      }
      this.pid = null;
    }
  }
}

module.exports = { ElectronTestApp };

