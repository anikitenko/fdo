const path = require('path');
const { TextDecoder, TextEncoder } = require('util');

// Ensure the working directory is set to the project root
process.chdir(path.resolve(__dirname));

// Mock environment variables if needed
process.env.NODE_ENV = 'test';

// Some transitive Node dependencies expect the util implementations explicitly.
if (typeof globalThis.TextEncoder !== 'function') {
  globalThis.TextEncoder = TextEncoder;
}
if (typeof globalThis.TextDecoder !== 'function') {
  globalThis.TextDecoder = TextDecoder;
}

// Setup jsdom-like globals for component tests
if (typeof window === 'undefined') {
  global.window = global;
}
if (!global.window.document) {
  global.window.document = { createElement: () => ({ style: {} }) };
}

// Simple localStorage mock with quota simulation
class LocalStorageMock {
  constructor() { this.store = new Map(); this.maxBytes = 5 * 1024 * 1024; }
  clear() { this.store.clear(); }
  getItem(key) { return this.store.has(key) ? this.store.get(key) : null; }
  key(i) { return Array.from(this.store.keys())[i]; }
  removeItem(key) { this.store.delete(key); }
  setItem(key, value) {
    const str = String(value);
    // simulate quota exceed
    const currentSize = Array.from(this.store.values()).reduce((s, v) => s + String(v).length, 0);
    if (currentSize + str.length > this.maxBytes) {
      const err = new Error('QuotaExceededError');
      err.name = 'QuotaExceededError';
      throw err;
    }
    this.store.set(key, str);
  }
  get length() { return this.store.size; }
}

if (!global.localStorage) {
  global.localStorage = new LocalStorageMock();
}

// Mock preload bridge used in renderer code
global.window.electron = {
  system: {
    on: {
      confirmEditorClose: jest.fn(),
      confirmEditorReload: jest.fn(),
    },
    openExternal: jest.fn(),
    confirmEditorCloseApproved: jest.fn(),
    confirmEditorReloadApproved: jest.fn(),
    getModuleFiles: jest.fn().mockResolvedValue({ files: [] }),
    getFdoSdkTypes: jest.fn().mockResolvedValue({ files: [] }),
  },
  plugin: {
    compile: jest.fn().mockResolvedValue({ result: 'ok' }),
    deploy: jest.fn().mockResolvedValue({ result: 'ok' }),
  },
  settings: {
    certificates: {
      getRoot: jest.fn().mockResolvedValue([]),
    },
  },
};

// Mock Electron module for Node context
jest.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: jest.fn((name) => {
      if (name === 'userData') return '/tmp/fdo-jest-user-data';
      if (name === 'sessionData') return '/tmp/fdo-jest-session-data';
      return '/tmp';
    }),
  },
  BrowserWindow: jest.fn(),
  dialog: {},
  nativeTheme: {},
  net: {},
  protocol: {},
  session: {},
}));

jest.mock('electron-store', () => {
  return class MockElectronStore {
    constructor(options = {}) {
      this.store = { ...(options.defaults || {}) };
    }

    get(key, defaultValue = undefined) {
      if (!key) return this.store;
      return key.split('.').reduce((acc, part) => (
        acc && Object.prototype.hasOwnProperty.call(acc, part) ? acc[part] : defaultValue
      ), this.store);
    }

    set(key, value) {
      const parts = String(key).split('.');
      let cursor = this.store;
      while (parts.length > 1) {
        const part = parts.shift();
        if (!cursor[part] || typeof cursor[part] !== 'object') {
          cursor[part] = {};
        }
        cursor = cursor[part];
      }
      cursor[parts[0]] = value;
    }

    delete(key) {
      const parts = String(key).split('.');
      let cursor = this.store;
      while (parts.length > 1 && cursor) {
        cursor = cursor[parts.shift()];
      }
      if (cursor) {
        delete cursor[parts[0]];
      }
    }

    clear() {
      this.store = {};
    }
  };
});

jest.mock('file-type', () => ({
  fileTypeFromFile: jest.fn().mockResolvedValue(null),
}), { virtual: true });

// Silence console noise during tests
const origError = console.error;
console.error = (...args) => {
  const msg = (args && args[0]) || '';
  if (typeof msg === 'string' && (msg.includes('act(') || msg.includes('Not implemented'))) return;
  origError.apply(console, args);
};

console.log('Test setup complete. Current working directory:', process.cwd());
