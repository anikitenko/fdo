module.exports = {
  transform: {
    "^.+\\.[jt]sx?$": "babel-jest",
  },
  transformIgnorePatterns: ["/node_modules/(?!electron|playwright)/"],
  testEnvironment: "jsdom",
  moduleNameMapper: {
    "^.+\\.module\\.css$": "identity-obj-proxy",
    "\\.css$": "identity-obj-proxy",
    "^monaco-editor$": "<rootDir>/tests/__mocks__/monaco-editor.js",
    "^@playwright/test$": "playwright",
    "^.*AppToaster\\.jsx$": "<rootDir>/tests/__mocks__/AppToaster.jsx",
  },
  setupFiles: ["<rootDir>/jest.setup.js"],
  setupFilesAfterEnv: ["<rootDir>/tests/test-setup-react.js"],
  extensionsToTreatAsEsm: [".jsx"],
  testPathIgnorePatterns: ["/tests/e2e/"],
};