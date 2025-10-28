# API Contract: Package Update Process

**Feature**: 005-npm-package-updates  
**Date**: 2025-10-28  
**Type**: JavaScript/Node.js Module API  
**Format**: CommonJS/ES Module exports

---

## Overview

This contract defines the programmatic API for the npm package update orchestration module. The API is designed for internal use by scripts and CLI tools, not as a public HTTP API.

---

## Module: `PackageUpdater`

**Location**: `src/utils/packageUpdater.js`

**Description**: Orchestrates the entire package update process with batching, testing, auditing, and rollback capabilities.

---

### Method: `updatePackages(options)`

**Description**: Main entry point to execute the complete package update workflow.

**Signature**:
```typescript
async function updatePackages(options: UpdateOptions): Promise<UpdateResult>
```

**Parameters**:
```typescript
interface UpdateOptions {
  // Execution control
  dryRun?: boolean;           // If true, only show what would be updated (default: false)
  skipTests?: boolean;        // Skip test suite execution (default: false)
  skipAudit?: boolean;        // Skip security audit (default: false)
  
  // Batch control
  batchTypes?: ('devDependencies' | 'dependencies')[];  // Which batches to run (default: both)
  
  // Version control
  target?: 'minor' | 'patch' | 'latest';  // Update target (default: 'minor')
  
  // Filtering
  includePackages?: string[];  // Only update these packages (default: all)
  excludePackages?: string[];  // Exclude these packages (default: none)
  
  // Behavior
  autoRollback?: boolean;      // Auto-rollback on test/audit failures (default: true)
  createReports?: boolean;     // Generate markdown reports (default: true)
  
  // Paths
  projectRoot?: string;        // Project root directory (default: process.cwd())
  reportsDir?: string;         // Reports output directory (default: specs/005.../reports/)
}
```

**Returns**:
```typescript
interface UpdateResult {
  success: boolean;
  
  batches: {
    devDependencies?: BatchResult;
    dependencies?: BatchResult;
  };
  
  summary: {
    updatedPackages: number;
    skippedPackages: number;
    deprecatedPackages: number;
    vulnerabilities: { high: number; critical: number };
  };
  
  reports: {
    breakingChanges?: string;   // Path to breaking changes report
    technicalDebt?: string;     // Path to technical debt report
    summary?: string;           // Path to summary report
  };
  
  errors: string[];  // Any errors encountered
}

interface BatchResult {
  status: 'SUCCESS' | 'FAILED' | 'SKIPPED';
  packagesUpdated: number;
  testResults?: TestResults;
  auditResults?: AuditResults;
  duration: number;  // milliseconds
  rollbackPerformed: boolean;
}
```

**Usage Example**:
```javascript
const { updatePackages } = require('./src/utils/packageUpdater');

const result = await updatePackages({
  target: 'minor',
  autoRollback: true,
  createReports: true
});

if (result.success) {
  console.log(`✅ Updated ${result.summary.updatedPackages} packages`);
} else {
  console.error('❌ Update failed:', result.errors);
  process.exit(1);
}
```

**Error Handling**:
- Throws `Error` if project root is invalid or package.json missing
- Throws `GitNotAvailableError` if Git is not installed
- Throws `TestFailureError` if tests fail and autoRollback=false
- Throws `AuditFailureError` if critical vulnerabilities found and autoRollback=false

**Preconditions**:
- Must be run in project with package.json and package-lock.json
- Git must be available and repository must be initialized
- npm must be installed and accessible
- Working directory must be clean (no uncommitted changes)

**Postconditions**:
- If successful: package.json and package-lock.json updated, Git commit created
- If failed: Original state restored via rollback
- Reports generated in reportsDir (if createReports=true)

---

### Method: `detectBreakingChanges()`

**Description**: Scans packages for major version updates without applying changes.

**Signature**:
```typescript
async function detectBreakingChanges(): Promise<BreakingChange[]>
```

**Returns**:
```typescript
interface BreakingChange {
  packageName: string;
  currentVersion: string;
  latestVersion: string;
  type: 'dependency' | 'devDependency';
  changelogUrl?: string;
}
```

**Usage Example**:
```javascript
const { detectBreakingChanges } = require('./src/utils/packageUpdater');

const breaking = await detectBreakingChanges();
console.log(`Found ${breaking.length} packages with major updates`);
```

---

### Method: `detectDeprecations()`

**Description**: Scans installed packages for deprecation warnings.

**Signature**:
```typescript
async function detectDeprecations(): Promise<DeprecationInfo[]>
```

**Returns**:
```typescript
interface DeprecationInfo {
  packageName: string;
  currentVersion: string;
  deprecationReason: string;
  hasReplacement: boolean;
  replacementPackage?: string;
}
```

**Usage Example**:
```javascript
const { detectDeprecations } = require('./src/utils/packageUpdater');

const deprecated = await detectDeprecations();
const noReplacement = deprecated.filter(d => !d.hasReplacement);
console.log(`${noReplacement.length} deprecated packages have no replacement`);
```

---

### Method: `runSecurityAudit()`

**Description**: Executes npm audit and parses results.

**Signature**:
```typescript
async function runSecurityAudit(): Promise<AuditResults>
```

**Returns**:
```typescript
interface AuditResults {
  success: boolean;  // true if zero high/critical vulnerabilities
  vulnerabilities: {
    info: number;
    low: number;
    moderate: number;
    high: number;
    critical: number;
  };
  details: VulnerabilityDetail[];
}

interface VulnerabilityDetail {
  package: string;
  severity: 'info' | 'low' | 'moderate' | 'high' | 'critical';
  title: string;
  url?: string;
  fixAvailable: boolean;
}
```

**Usage Example**:
```javascript
const { runSecurityAudit } = require('./src/utils/packageUpdater');

const audit = await runSecurityAudit();
if (!audit.success) {
  console.error(`⚠️ ${audit.vulnerabilities.high} high, ${audit.vulnerabilities.critical} critical`);
}
```

---

### Method: `createRollbackCheckpoint(message)`

**Description**: Creates a Git commit checkpoint before updates.

**Signature**:
```typescript
async function createRollbackCheckpoint(message: string): Promise<RollbackCheckpoint>
```

**Parameters**:
- `message`: string - Commit message for checkpoint

**Returns**:
```typescript
interface RollbackCheckpoint {
  commitHash: string;
  createdAt: string;  // ISO 8601
  message: string;
  packageJsonHash: string;
  lockFileHash: string;
}
```

**Usage Example**:
```javascript
const { createRollbackCheckpoint } = require('./src/utils/packageUpdater');

const checkpoint = await createRollbackCheckpoint('before devDependencies update');
console.log(`Created checkpoint: ${checkpoint.commitHash}`);
```

---

### Method: `rollbackToCheckpoint(checkpoint)`

**Description**: Restores package files to a previous checkpoint.

**Signature**:
```typescript
async function rollbackToCheckpoint(checkpoint: RollbackCheckpoint): Promise<void>
```

**Parameters**:
- `checkpoint`: RollbackCheckpoint - Checkpoint to restore

**Returns**: Promise<void> (throws on error)

**Usage Example**:
```javascript
const { rollbackToCheckpoint, createRollbackCheckpoint } = require('./src/utils/packageUpdater');

const checkpoint = await createRollbackCheckpoint('before update');

try {
  // ... attempt updates
} catch (error) {
  await rollbackToCheckpoint(checkpoint);
  console.log('Rolled back to checkpoint');
}
```

**Postconditions**:
- package.json and package-lock.json restored to checkpoint state
- `npm ci` executed to restore node_modules
- Git working directory matches checkpoint

---

### Method: `generateReports(updateState)`

**Description**: Generates Markdown reports from update results.

**Signature**:
```typescript
async function generateReports(updateState: UpdateState): Promise<GeneratedReports>
```

**Parameters**:
```typescript
interface UpdateState {
  updated: PackageDependency[];
  skipped: BreakingChange[];
  deprecated: TechnicalDebtRecord[];
  testResults?: TestResults;
  auditResults?: AuditResults;
}
```

**Returns**:
```typescript
interface GeneratedReports {
  breakingChangesReport: string;  // File path
  technicalDebtReport: string;    // File path
  summaryReport: string;          // File path
}
```

**Usage Example**:
```javascript
const { generateReports } = require('./src/utils/packageUpdater');

const reports = await generateReports({
  updated: [...],
  skipped: [...],
  deprecated: [...]
});

console.log('Reports generated:');
console.log(`- ${reports.summaryReport}`);
console.log(`- ${reports.breakingChangesReport}`);
console.log(`- ${reports.technicalDebtReport}`);
```

---

## Module: `BatchProcessor`

**Location**: `src/utils/packageUpdater/batchProcessor.js`

**Description**: Handles processing of individual update batches.

---

### Method: `processBatch(batch, options)`

**Description**: Processes a single update batch through the state machine.

**Signature**:
```typescript
async function processBatch(batch: UpdateBatch, options: BatchOptions): Promise<BatchResult>
```

**Parameters**:
```typescript
interface BatchOptions {
  skipTests?: boolean;
  skipAudit?: boolean;
  autoRollback?: boolean;
}
```

**State Machine Flow**:
1. **PENDING** → Start update
2. **UPDATING** → Run npm install
3. **TESTING** → Execute test suite
4. **AUDITING** → Run security audit
5. **SUCCESS** or **ROLLING_BACK** → **FAILED**

**Returns**: BatchResult (see UpdateResult interface above)

---

## Module: `ReportGenerator`

**Location**: `src/utils/packageUpdater/reportGenerator.js`

**Description**: Generates formatted Markdown reports.

---

### Method: `generateBreakingChangesReport(changes)`

**Signature**:
```typescript
function generateBreakingChangesReport(changes: BreakingChange[]): string
```

**Returns**: Markdown-formatted string

---

### Method: `generateTechnicalDebtReport(debt)`

**Signature**:
```typescript
function generateTechnicalDebtReport(debt: TechnicalDebtRecord[]): string
```

**Returns**: Markdown-formatted string

---

### Method: `generateSummaryReport(summary)`

**Signature**:
```typescript
function generateSummaryReport(summary: UpdateSummary): string
```

**Returns**: Markdown-formatted string

---

## CLI Script: `scripts/updatePackages.js`

**Description**: Command-line interface for package updates.

**Usage**:
```bash
node scripts/updatePackages.js [options]
```

**Options**:
```
--dry-run              Show what would be updated without applying changes
--skip-tests           Skip running test suite
--skip-audit           Skip security audit
--target <level>       Update target: minor (default), patch, or latest
--batch <type>         Run specific batch: devDependencies, dependencies, or both (default)
--include <packages>   Comma-separated list of packages to update
--exclude <packages>   Comma-separated list of packages to skip
--no-rollback          Disable automatic rollback on failures
--no-reports           Skip generating Markdown reports
--help                 Show help message
```

**Examples**:
```bash
# Update all packages (both batches)
node scripts/updatePackages.js

# Dry run to see what would change
node scripts/updatePackages.js --dry-run

# Update only devDependencies
node scripts/updatePackages.js --batch devDependencies

# Update only specific packages
node scripts/updatePackages.js --include react,react-dom

# Patch updates only (no minor versions)
node scripts/updatePackages.js --target patch
```

**Exit Codes**:
- `0`: Success (all updates applied)
- `1`: Failure (rollback performed or error occurred)
- `2`: Partial success (some batches failed)

---

## Error Types

### `GitNotAvailableError`

**Thrown when**: Git is not installed or repository not initialized

**Message**: "Git is not available or repository not initialized"

**Recovery**: Install Git and run `git init`

---

### `TestFailureError`

**Thrown when**: Test suite fails and autoRollback=false

**Message**: "Test suite failed: {numFailedTests} tests failed"

**Recovery**: Fix failing tests or enable autoRollback

---

### `AuditFailureError`

**Thrown when**: Critical vulnerabilities detected and autoRollback=false

**Message**: "Security audit failed: {high} high, {critical} critical vulnerabilities"

**Recovery**: Review npm audit output and update vulnerable packages

---

### `RollbackFailureError`

**Thrown when**: Rollback process fails

**Message**: "Failed to rollback to checkpoint {commitHash}: {error}"

**Recovery**: Manual Git reset may be required

---

## Integration Points

### Jest Test Runner

**Called by**: `BatchProcessor.processBatch()` during TESTING state

**Interface**:
```javascript
const jest = require('jest');
const results = await jest.runCLI({ json: true, silent: true }, [process.cwd()]);
```

---

### npm CLI

**Called by**: Various modules for package operations

**Commands Used**:
- `npm install` - Install/update packages
- `npm ci` - Clean install from lock file
- `npm audit --json` - Security audit
- `npm view <package> version` - Get latest version
- `npm outdated --json` - List outdated packages

---

### Git (via simple-git)

**Called by**: Checkpoint and rollback operations

**Commands Used**:
- `git add package.json package-lock.json`
- `git commit -m <message>`
- `git reset --hard <commit>`
- `git rev-parse HEAD`

---

## Configuration

No external configuration file required. All behavior controlled through function parameters and options.

**Environment Variables** (optional):
- `NPM_CONFIG_AUDIT_LEVEL`: Override audit severity threshold
- `NODE_ENV`: Affects test execution (test/development/production)

---

## Testing Contract

### Unit Tests

**Location**: `tests/unit/packageUpdater.test.js`

**Coverage Requirements**:
- All public methods must have unit tests
- Error paths must be tested
- State machine transitions must be tested

**Example Test**:
```javascript
describe('PackageUpdater', () => {
  it('should detect breaking changes', async () => {
    const changes = await detectBreakingChanges();
    expect(changes).toBeInstanceOf(Array);
    changes.forEach(change => {
      expect(semver.major(change.latestVersion)).toBeGreaterThan(
        semver.major(change.currentVersion)
      );
    });
  });
});
```

---

### Integration Tests

**Location**: `tests/integration/packageUpdate.test.js`

**Test Scenarios**:
1. Successful update flow (both batches)
2. Rollback on test failure
3. Rollback on audit failure
4. Dry-run mode (no changes applied)
5. Partial update (only devDependencies)

---

## Contract Versioning

**Version**: 1.0.0  
**Stability**: Stable  
**Breaking Changes**: Require major version bump

**Compatibility**:
- Node.js >= 16.x (required for npm 7+)
- npm >= 7.x (required for modern npm audit)
- Git >= 2.x (required for checkpoint operations)

---

**Contract Complete**: All API methods, parameters, return types, and error handling defined. Ready for implementation.

