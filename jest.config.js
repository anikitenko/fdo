module.exports = {
  transform: {
    "^.+\\.[jt]sx?$": "babel-jest",
  },
  transformIgnorePatterns: ["/node_modules/(?!electron|playwright)/"],
  testEnvironment: "node",
  moduleNameMapper: {
    "\\.css$": "identity-obj-proxy",
    "^monaco-editor$": "<rootDir>/tests/__mocks__/monaco-editor.js",
    "^@playwright/test$": "playwright",
  },
  setupFiles: ["<rootDir>/jest.setup.js"],
  extensionsToTreatAsEsm: [".jsx"],
  testPathIgnorePatterns: ["/tests/e2e/"],
};