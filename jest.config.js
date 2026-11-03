module.exports = {
  // Plugin examples use FDO's node:test runner; browser suites use Playwright.
  // Restrict crawling too, so exported projects under artifacts cannot collide.
  roots: ["<rootDir>/tests"],
  transform: {
    "^.+\\.md$": "<rootDir>/tests/helpers/markdownTextTransformer.cjs",
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
  testPathIgnorePatterns: ["/tests/e2e/", "/tests/website/"],
};
