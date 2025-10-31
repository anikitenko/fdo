// Test setup file
// This file runs before all tests

// Mock global objects that are not available in Node environment
global.localStorage = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
};

global.navigator = {
  storage: {
    estimate: jest.fn().mockResolvedValue({
      usage: 0,
      quota: 100 * 1024 * 1024 // 100MB
    })
  }
};


