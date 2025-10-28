# Data Model: NPM Package Updates and Deprecation Resolution

**Feature**: 005-npm-package-updates  
**Date**: 2025-10-28  
**Purpose**: Define data structures, state machines, and validation rules for package update process

---

## Overview

This feature manages npm package updates through a state machine with multiple entities tracking package states, update batches, security audits, and generated reports. The data model supports idempotent operations, rollback capabilities, and comprehensive reporting.

---

## Core Entities

### 1. Package Dependency

**Description**: Represents a single npm package entry from package.json

**Attributes**:
| Attribute | Type | Constraints | Description |
|-----------|------|-------------|-------------|
| `name` | string | required, npm package name format | Package name (e.g., "react") |
| `currentVersion` | string | required, semver format | Currently installed version |
| `latestVersion` | string | required, semver format | Latest available version from npm registry |
| `type` | enum | `"dependency" \| "devDependency"` | Dependency category |
| `versionConstraint` | string | required, semver range | Original constraint from package.json (^, ~, exact) |
| `isDeprecated` | boolean | required | Whether package shows deprecation warning |
| `deprecationReason` | string | optional | Reason from npm deprecation message |
| `hasReplacement` | boolean | required | Whether a non-deprecated alternative exists |
| `replacementPackage` | string | optional | Name of replacement package if available |
| `changelogUrl` | string | optional, URL format | Link to package changelog/releases |

**Relationships**:
- Belongs to one `UpdateBatch`
- May have associated `BreakingChange` record
- May have associated `TechnicalDebt` record

**Validation Rules**:
```javascript
function validatePackageDependency(pkg) {
  assert(semver.valid(pkg.currentVersion), 'Current version must be valid semver');
  assert(semver.valid(pkg.latestVersion), 'Latest version must be valid semver');
  assert(pkg.name.match(/^[@a-z0-9-~][a-z0-9-._~]*$/), 'Invalid npm package name');
  assert(['dependency', 'devDependency'].includes(pkg.type), 'Invalid dependency type');
  
  if (pkg.isDeprecated && !pkg.hasReplacement) {
    assert(pkg.deprecationReason, 'Deprecation reason required for packages without replacement');
  }
}
```

**Example**:
```json
{
  "name": "react",
  "currentVersion": "17.0.2",
  "latestVersion": "18.3.1",
  "type": "dependency",
  "versionConstraint": "^17.0.2",
  "isDeprecated": false,
  "hasReplacement": true,
  "changelogUrl": "https://github.com/facebook/react/releases"
}
```

---

### 2. Transitive Dependency

**Description**: Indirect dependency required by direct dependencies

**Attributes**:
| Attribute | Type | Constraints | Description |
|-----------|------|-------------|-------------|
| `name` | string | required | Package name |
| `version` | string | required, semver format | Installed version |
| `requiredBy` | string[] | required, non-empty | List of parent packages requiring this |
| `vulnerabilities` | object[] | optional | Security vulnerabilities from npm audit |

**Relationships**:
- Referenced by one or more `PackageDependency` records
- May have associated `SecurityVulnerability` records

**Validation Rules**:
```javascript
function validateTransitiveDependency(dep) {
  assert(dep.requiredBy.length > 0, 'Must be required by at least one package');
  assert(semver.valid(dep.version), 'Version must be valid semver');
}
```

---

### 3. Update Batch

**Description**: Group of packages updated together (devDependencies or dependencies)

**Attributes**:
| Attribute | Type | Constraints | Description |
|-----------|------|-------------|-------------|
| `id` | string | required, unique | Batch identifier (e.g., "devdeps-2025-10-28") |
| `type` | enum | `"devDependencies" \| "dependencies"` | Batch category |
| `status` | enum | See state machine below | Current batch status |
| `packages` | PackageDependency[] | required, non-empty | Packages in this batch |
| `startedAt` | ISO 8601 timestamp | required | When batch processing started |
| `completedAt` | ISO 8601 timestamp | optional | When batch completed (success/failure) |
| `testResults` | TestResults | optional | Test execution results |
| `auditResults` | AuditResults | optional | Security audit results |
| `rollbackCheckpoint` | string | required | Git commit hash before updates |

**Relationships**:
- Contains multiple `PackageDependency` records
- Has one `RollbackCheckpoint`
- Has optional `TestResults`
- Has optional `AuditResults`

**State Machine**:
```
PENDING → UPDATING → TESTING → AUDITING → SUCCESS
                 ↓       ↓         ↓
                ROLLING_BACK → FAILED
```

**State Transitions**:
| From State | Event | To State | Action |
|------------|-------|----------|--------|
| `PENDING` | startUpdate | `UPDATING` | Begin npm install with updated package.json |
| `UPDATING` | updateComplete | `TESTING` | Run test suite |
| `UPDATING` | updateFailed | `ROLLING_BACK` | Restore from checkpoint |
| `TESTING` | testsPass | `AUDITING` | Run npm audit |
| `TESTING` | testsFail | `ROLLING_BACK` | Restore from checkpoint |
| `AUDITING` | auditPass | `SUCCESS` | Commit changes, create new checkpoint |
| `AUDITING` | auditFail | `ROLLING_BACK` | Restore from checkpoint (high/critical vulnerabilities) |
| `ROLLING_BACK` | rollbackComplete | `FAILED` | Generate failure report |

**Validation Rules**:
```javascript
function validateUpdateBatch(batch) {
  assert(['devDependencies', 'dependencies'].includes(batch.type), 'Invalid batch type');
  assert(batch.packages.length > 0, 'Batch must contain at least one package');
  assert(batch.rollbackCheckpoint.match(/^[0-9a-f]{40}$/), 'Invalid Git commit hash');
  
  if (batch.status === 'SUCCESS') {
    assert(batch.completedAt, 'Completed timestamp required for successful batch');
    assert(batch.testResults && batch.testResults.success, 'Test results required for success');
    assert(batch.auditResults && batch.auditResults.success, 'Audit results required for success');
  }
}
```

**Example**:
```json
{
  "id": "devdeps-2025-10-28-143022",
  "type": "devDependencies",
  "status": "SUCCESS",
  "packages": [...],
  "startedAt": "2025-10-28T14:30:22Z",
  "completedAt": "2025-10-28T14:35:10Z",
  "testResults": { "success": true, "passed": 128, "failed": 0 },
  "auditResults": { "success": true, "vulnerabilities": { "high": 0, "critical": 0 } },
  "rollbackCheckpoint": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0"
}
```

---

### 4. Breaking Change

**Description**: Package with major version update (skipped for manual review)

**Attributes**:
| Attribute | Type | Constraints | Description |
|-----------|------|-------------|-------------|
| `packageName` | string | required | Package with breaking change |
| `currentVersion` | string | required, semver format | Current version |
| `latestVersion` | string | required, semver format | Latest version (major bump) |
| `type` | enum | `"dependency" \| "devDependency"` | Dependency category |
| `changelogUrl` | string | optional, URL format | Link to changelog/migration guide |
| `detectedAt` | ISO 8601 timestamp | required | When breaking change was detected |
| `reason` | string | required | Why it was skipped |

**Validation Rules**:
```javascript
function validateBreakingChange(change) {
  const currentMajor = semver.major(change.currentVersion);
  const latestMajor = semver.major(change.latestVersion);
  assert(latestMajor > currentMajor, 'Latest version must be a major version bump');
}
```

**Example**:
```json
{
  "packageName": "react",
  "currentVersion": "17.0.2",
  "latestVersion": "18.3.1",
  "type": "dependency",
  "changelogUrl": "https://github.com/facebook/react/releases/tag/v18.0.0",
  "detectedAt": "2025-10-28T14:31:05Z",
  "reason": "Major version update detected (17 → 18)"
}
```

---

### 5. Technical Debt Record

**Description**: Deprecated package with no available replacement

**Attributes**:
| Attribute | Type | Constraints | Description |
|-----------|------|-------------|-------------|
| `packageName` | string | required | Deprecated package name |
| `currentVersion` | string | required, semver format | Current installed version |
| `deprecationReason` | string | required | Reason from npm deprecation warning |
| `detectedAt` | ISO 8601 timestamp | required | When deprecation was detected |
| `monitoringPlan` | string | required | How package will be monitored for security issues |
| `searchedFor` | string | optional | What replacement was searched for |

**Validation Rules**:
```javascript
function validateTechnicalDebt(debt) {
  assert(debt.deprecationReason.length > 0, 'Deprecation reason required');
  assert(debt.monitoringPlan.length > 0, 'Monitoring plan required');
}
```

**Example**:
```json
{
  "packageName": "request",
  "currentVersion": "2.88.2",
  "deprecationReason": "request has been deprecated, see https://github.com/request/request/issues/3142",
  "detectedAt": "2025-10-28T14:31:10Z",
  "monitoringPlan": "Check npm advisories monthly; plan migration to axios or node-fetch in Q2 2026",
  "searchedFor": "HTTP client library with similar API"
}
```

---

### 6. Rollback Checkpoint

**Description**: Git commit snapshot before package updates

**Attributes**:
| Attribute | Type | Constraints | Description |
|-----------|------|-------------|-------------|
| `commitHash` | string | required, 40-char hex | Git commit SHA |
| `createdAt` | ISO 8601 timestamp | required | When checkpoint was created |
| `batchId` | string | required | Associated UpdateBatch ID |
| `message` | string | required | Git commit message |
| `packageJsonHash` | string | required | SHA256 hash of package.json |
| `lockFileHash` | string | required | SHA256 hash of package-lock.json |

**Validation Rules**:
```javascript
function validateRollbackCheckpoint(checkpoint) {
  assert(checkpoint.commitHash.match(/^[0-9a-f]{40}$/), 'Invalid Git commit hash');
  assert(checkpoint.packageJsonHash.match(/^[0-9a-f]{64}$/), 'Invalid SHA256 hash');
  assert(checkpoint.lockFileHash.match(/^[0-9a-f]{64}$/), 'Invalid SHA256 hash');
}
```

**Example**:
```json
{
  "commitHash": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0",
  "createdAt": "2025-10-28T14:30:20Z",
  "batchId": "devdeps-2025-10-28-143022",
  "message": "checkpoint: before devDependencies update",
  "packageJsonHash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "lockFileHash": "d41d8cd98f00b204e9800998ecf8427e4ee66b5e1a3e13be8c3e9e38d01e5b6f"
}
```

---

### 7. Test Results

**Description**: Outcome of automated test suite execution

**Attributes**:
| Attribute | Type | Constraints | Description |
|-----------|------|-------------|-------------|
| `success` | boolean | required | Whether all tests passed |
| `totalTests` | integer | required, >= 0 | Total number of tests |
| `passedTests` | integer | required, >= 0 | Number of passed tests |
| `failedTests` | integer | required, >= 0 | Number of failed tests |
| `skippedTests` | integer | required, >= 0 | Number of skipped tests |
| `duration` | integer | required, milliseconds | Total test execution time |
| `failures` | object[] | optional | Details of failed tests |

**Validation Rules**:
```javascript
function validateTestResults(results) {
  assert(results.passedTests + results.failedTests + results.skippedTests === results.totalTests,
    'Test counts must sum to total');
  assert(results.success === (results.failedTests === 0), 'Success flag must match zero failures');
  assert(results.duration > 0, 'Duration must be positive');
}
```

**Example**:
```json
{
  "success": true,
  "totalTests": 128,
  "passedTests": 128,
  "failedTests": 0,
  "skippedTests": 0,
  "duration": 45230,
  "failures": []
}
```

---

### 8. Audit Results

**Description**: Security audit outcome from npm audit

**Attributes**:
| Attribute | Type | Constraints | Description |
|-----------|------|-------------|-------------|
| `success` | boolean | required | Whether audit passed (no high/critical vulnerabilities) |
| `vulnerabilities` | object | required | Counts by severity level |
| `vulnerabilities.info` | integer | required, >= 0 | Info-level vulnerabilities |
| `vulnerabilities.low` | integer | required, >= 0 | Low-severity vulnerabilities |
| `vulnerabilities.moderate` | integer | required, >= 0 | Moderate-severity vulnerabilities |
| `vulnerabilities.high` | integer | required, >= 0 | High-severity vulnerabilities |
| `vulnerabilities.critical` | integer | required, >= 0 | Critical-severity vulnerabilities |
| `details` | object[] | optional | Detailed vulnerability information |

**Validation Rules**:
```javascript
function validateAuditResults(results) {
  assert(results.success === (results.vulnerabilities.high === 0 && results.vulnerabilities.critical === 0),
    'Success requires zero high/critical vulnerabilities');
}
```

**Example**:
```json
{
  "success": true,
  "vulnerabilities": {
    "info": 2,
    "low": 5,
    "moderate": 1,
    "high": 0,
    "critical": 0
  },
  "details": []
}
```

---

### 9. Update Report

**Description**: Generated documentation of update process results

**Attributes**:
| Attribute | Type | Constraints | Description |
|-----------|------|-------------|-------------|
| `type` | enum | `"breaking-changes" \| "technical-debt" \| "summary"` | Report type |
| `generatedAt` | ISO 8601 timestamp | required | When report was generated |
| `filePath` | string | required | Path to generated Markdown file |
| `content` | string | required | Markdown content |
| `metadata` | object | optional | Additional report-specific metadata |

**Example**:
```json
{
  "type": "summary",
  "generatedAt": "2025-10-28T14:40:00Z",
  "filePath": "specs/005-npm-package-updates/reports/update-summary-2025-10-28.md",
  "content": "# Update Summary\n\n- **Packages Updated**: 45...",
  "metadata": {
    "updatedPackages": 45,
    "skippedPackages": 5,
    "deprecatedPackages": 2
  }
}
```

---

## Relationships Diagram

```
UpdateBatch (1) ──┬── (N) PackageDependency
                  │
                  ├── (1) RollbackCheckpoint
                  │
                  ├── (0..1) TestResults
                  │
                  └── (0..1) AuditResults

PackageDependency (1) ──┬── (0..1) BreakingChange
                        │
                        └── (0..1) TechnicalDebtRecord

TransitiveDependency (N) ──── (N) PackageDependency (requiredBy)

UpdateReport (N) ────── (1) UpdateBatch (references)
```

---

## State Machine: Update Process

### States

1. **PENDING**: Batch created, waiting to start
2. **UPDATING**: Running npm install with updated package.json
3. **TESTING**: Running test suite to validate updates
4. **AUDITING**: Running security audit on updated packages
5. **SUCCESS**: All checks passed, changes committed
6. **ROLLING_BACK**: Restoring from checkpoint due to failure
7. **FAILED**: Rollback complete, batch failed

### Events

- `startUpdate`: Begin update process
- `updateComplete`: npm install succeeded
- `updateFailed`: npm install failed (conflicts, network issues)
- `testsPass`: All tests passed
- `testsFail`: One or more tests failed
- `auditPass`: No high/critical vulnerabilities
- `auditFail`: High or critical vulnerabilities detected
- `rollbackComplete`: Git restore completed

---

## Data Storage

### In-Memory State

During update process, state is maintained in memory:

```javascript
const updateState = {
  batches: Map<string, UpdateBatch>,
  checkpoint: RollbackCheckpoint,
  results: {
    updated: PackageDependency[],
    skipped: BreakingChange[],
    deprecated: TechnicalDebtRecord[]
  }
};
```

### Persistent Storage

After completion, data is persisted to:

1. **Git Repository**: package.json, package-lock.json (via commits)
2. **Markdown Reports**: `specs/005-npm-package-updates/reports/*.md`
3. **Update Metadata**: `specs/005-npm-package-updates/reports/update-state.json` (optional)

---

## Validation Summary

| Entity | Key Validation Rules |
|--------|---------------------|
| PackageDependency | Valid semver versions, valid npm package name, deprecation reason required if no replacement |
| TransitiveDependency | Non-empty requiredBy list, valid semver version |
| UpdateBatch | Valid batch type, non-empty packages list, valid Git commit hash, completed state requires test/audit results |
| BreakingChange | Latest version must be major version bump from current |
| TechnicalDebtRecord | Non-empty deprecation reason and monitoring plan |
| RollbackCheckpoint | Valid Git commit hash (40-char hex), valid SHA256 hashes (64-char hex) |
| TestResults | Test counts must sum correctly, success flag must match zero failures |
| AuditResults | Success requires zero high/critical vulnerabilities |

---

**Data Model Complete**: All entities, relationships, and validation rules defined. Ready for contract generation.

