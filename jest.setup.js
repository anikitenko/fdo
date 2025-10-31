const path = require('path');

// Ensure the working directory is set to the project root
process.chdir(path.resolve(__dirname));

// Mock environment variables if needed
process.env.NODE_ENV = 'test';

// Mock Electron for unit tests
jest.mock('electron', () => ({
  app: { isPackaged: false },
  BrowserWindow: jest.fn(),
  dialog: {},
  nativeTheme: {},
  net: {},
  protocol: {},
  session: {},
}));

console.log('Test setup complete. Current working directory:', process.cwd());