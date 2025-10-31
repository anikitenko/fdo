# Quickstart: End-to-End UI Tests

## Prerequisites

1. Install Node.js (v16 or later).
2. Install dependencies:
   ```bash
   npm install
   ```
3. Ensure Playwright is installed:
   ```bash
   npx playwright install
   ```

## Running Tests

1. Start the Electron application:
   ```bash
   npm start
   ```
2. Run e2e tests:
   ```bash
   npx playwright test
   ```

## Debugging Tests

- Use Playwright's debug mode:
  ```bash
  npx playwright test --debug
  ```
- View test reports:
  ```bash
  npx playwright show-report
  ```

## Generating Coverage Report

1. Run tests with coverage enabled:
   ```bash
   npx playwright test --coverage
   ```
2. View the coverage report:
   ```bash
   npx playwright show-coverage
   ```

## Optimizing Test Execution

- Run tests in parallel to reduce execution time:
  ```bash
  npx playwright test --workers=4
  ```
  Replace `4` with the number of CPU cores available.

- Use the `--grep` option to run specific tests:
  ```bash
  npx playwright test --grep "Dialog"
  ```