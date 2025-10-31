# Data Model: End-to-End UI Tests

## Entities

### Entity: Test Case
- **Attributes**:
  - `id`: Unique identifier for the test case.
  - `name`: Descriptive name of the test case.
  - `description`: Detailed description of the test case.
  - `steps`: Ordered list of steps to execute the test.
  - `expectedOutcome`: Expected result of the test case.

### Entity: Test Suite
- **Attributes**:
  - `id`: Unique identifier for the test suite.
  - `name`: Descriptive name of the test suite.
  - `testCases`: List of associated test cases.

### Entity: Test Result
- **Attributes**:
  - `testCaseId`: Identifier of the test case.
  - `status`: Outcome of the test case execution (`success` or `failure`).
  - `executionTime`: Time taken to execute the test case.
  - `details`: Additional information about the test execution.

## Relationships
- A `Test Suite` contains multiple `Test Cases`.