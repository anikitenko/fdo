# API Contracts: End-to-End UI Tests

## Endpoints

### Endpoint: `/run-test`
- **Method**: POST
- **Description**: Executes a specific test case.
- **Request Body**:
  ```json
  {
    "testCaseId": "string"
  }
  ```
- **Response**:
  ```json
  {
    "status": "success | failure",
    "details": "string"
  }
  ```

### Endpoint: `/get-test-results`
- **Method**: GET
- **Description**: Retrieves the results of executed test cases.
- **Response**:
  ```json
  [
    {
      "testCaseId": "string",
      "status": "success | failure",
      "executionTime": "number"
    }
  ]
  ```

### Endpoint: `/get-test-result`
- **Method**: GET
- **Description**: Retrieves the result of a specific test case.
- **Request Query Parameters**:
  - `testCaseId`: Identifier of the test case.
- **Response**:
  ```json
  {
    "testCaseId": "string",
    "status": "success | failure",
    "executionTime": "number",
    "details": "string"
  }
  ```