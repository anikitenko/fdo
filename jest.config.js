module.exports = {
  transform: {
    "^.+\\.(?:[jt]sx?|mjs)$": "babel-jest",
  },
  transformIgnorePatterns: ["/node_modules/"],
  testEnvironment: "jsdom",
  maxWorkers: 2,
  workerIdleMemoryLimit: "512MB",
  moduleNameMapper: {
    "^.+\\.module\\.css$": "identity-obj-proxy",
    "^.+\\.module\\.scss$": "identity-obj-proxy",
    "\\.css$": "identity-obj-proxy",
    "\\.scss$": "identity-obj-proxy",
    "^monaco-editor$": "<rootDir>/tests/__mocks__/monaco-editor.js",
    "^@playwright/test$": "playwright",
    "^.*AppToaster\\.jsx$": "<rootDir>/tests/__mocks__/AppToaster.jsx",
  },
  setupFiles: ["<rootDir>/jest.setup.js"],
  setupFilesAfterEnv: ["<rootDir>/tests/test-setup-react.js"],
  testPathIgnorePatterns: ["/tests/e2e/"],
};
