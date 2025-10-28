# Quickstart: NPM Package Updates

**Feature**: 005-npm-package-updates  
**Audience**: Developers maintaining FDO dependencies  
**Time to Complete**: 5-10 minutes

---

## Overview

This guide walks you through updating npm packages in the FDO project using the automated update system. The system safely updates packages to their latest compatible versions while avoiding breaking changes, running tests, checking for security vulnerabilities, and automatically rolling back on failures.

---

## Prerequisites

Before starting, ensure you have:

- ✅ Node.js >= 16.x installed
- ✅ npm >= 7.x installed
- ✅ Git >= 2.x installed
- ✅ Clean working directory (no uncommitted changes)
- ✅ All existing tests passing

**Check your environment**:
```bash
node --version   # Should be >= 16.x
npm --version    # Should be >= 7.x
git --version    # Should be >= 2.x
git status       # Should show "nothing to commit, working tree clean"
npm test         # Should pass with 0 failures
```

---

## Quick Start: Running Updates

### Step 1: Install Dependencies (First Time Only)

If this is your first time running the update system:

```bash
npm install npm-check-updates semver simple-git --save-dev
```

### Step 2: Run Update Script

**Option A: Full Update (Recommended)**

Update all packages in both batches (devDependencies → dependencies):

```bash
node scripts/updatePackages.js
```

**Option B: Dry Run First**

See what would change without applying updates:

```bash
node scripts/updatePackages.js --dry-run
```

Sample output:
```
🔍 Scanning packages...

📦 devDependencies updates:
  - jest: 29.5.0 → 30.0.5 (minor)
  - webpack: 5.88.0 → 5.95.0 (patch)
  - eslint: 8.45.0 → 8.57.0 (minor)
  [+27 more packages]

📦 dependencies updates:
  - react: 18.2.0 → 18.3.1 (minor)
  - electron: 37.1.0 → 37.2.6 (patch)
  [+42 more packages]

⏭️  Skipped (breaking changes):
  - @types/node: 18.x.x → 20.x.x (major version change)

⚠️  Deprecated packages (no replacement):
  - request: 2.88.2 (deprecated, see technical debt report)

✅ Dry run complete. Run without --dry-run to apply changes.
```

### Step 3: Review Generated Reports

After updates complete, review the generated reports:

```bash
cat specs/005-npm-package-updates/reports/update-summary.md
cat specs/005-npm-package-updates/reports/breaking-changes-report.md
cat specs/005-npm-package-updates/reports/technical-debt-report.md
```

### Step 4: Commit Changes

If everything looks good:

```bash
git add .
git commit -m "chore(deps): update npm packages to latest compatible versions"
```

---

## Common Scenarios

### Scenario 1: Update Only devDependencies

Useful for testing the update system on lower-risk packages first:

```bash
node scripts/updatePackages.js --batch devDependencies
```

### Scenario 2: Update Specific Packages

Update only certain packages:

```bash
node scripts/updatePackages.js --include react,react-dom,electron
```

### Scenario 3: Exclude Problematic Packages

Skip packages known to cause issues:

```bash
node scripts/updatePackages.js --exclude webpack,esbuild
```

### Scenario 4: Patch Updates Only

Only update to patch versions (no minor versions):

```bash
node scripts/updatePackages.js --target patch
```

### Scenario 5: Update Without Running Tests

**⚠️ Not recommended for production**

```bash
node scripts/updatePackages.js --skip-tests --no-rollback
```

---

## Understanding the Update Process

The system follows this workflow:

### Phase 1: devDependencies Update

```
1. Create Git checkpoint
   ↓
2. Update devDependencies in package.json
   ↓
3. Run npm install
   ↓
4. Run full test suite
   ↓
5. Run npm audit (security check)
   ↓
6. If all pass: Commit changes
   If any fail: Rollback to checkpoint
```

### Phase 2: dependencies Update

```
1. Create Git checkpoint (from Phase 1 success)
   ↓
2. Update dependencies in package.json
   ↓
3. Run npm install
   ↓
4. Run full test suite
   ↓
5. Run npm audit (security check)
   ↓
6. If all pass: Commit changes and generate reports
   If any fail: Rollback to Phase 1 checkpoint
```

---

## Reading Reports

### Summary Report

**Location**: `specs/005-npm-package-updates/reports/update-summary.md`

**What it shows**:
- Total packages updated
- Total packages skipped (breaking changes)
- Deprecated packages (technical debt)
- Security audit results
- Test results

**Example**:
```markdown
# Update Summary

**Generated**: 2025-10-28 14:40:00

## Results

- ✅ **Packages Updated**: 45
- ⏭️  **Packages Skipped**: 5 (breaking changes)
- ⚠️  **Deprecated Packages**: 2 (no replacement)
- 🔒 **Security Audit**: PASS (0 high/critical vulnerabilities)
- ✅ **Test Results**: PASS (128/128 tests)
```

### Breaking Changes Report

**Location**: `specs/005-npm-package-updates/reports/breaking-changes-report.md`

**What it shows**:
- Packages with major version updates
- Links to changelogs and migration guides
- Recommended action for each package

**Example**:
```markdown
# Breaking Changes Report

## Packages Skipped (Major Version Updates)

| Package | Current | Latest | Changelog | Type |
|---------|---------|--------|-----------|------|
| react | 17.0.2 | 18.3.1 | [View](https://github.com/facebook/react/releases/tag/v18.0.0) | dependency |

### Recommended Actions

1. **react** (17.0.2 → 18.3.1)
   - Review migration guide: https://react.dev/blog/2022/03/08/react-18-upgrade-guide
   - Expected effort: Medium (API changes in concurrent features)
   - Plan migration for Sprint 42
```

### Technical Debt Report

**Location**: `specs/005-npm-package-updates/reports/technical-debt-report.md`

**What it shows**:
- Deprecated packages with no direct replacement
- Deprecation reasons
- Monitoring and migration plans

**Example**:
```markdown
# Technical Debt Report

## Deprecated Packages Without Replacement

| Package | Version | Reason | Action Plan |
|---------|---------|--------|-------------|
| request | 2.88.2 | Deprecated, see [issue #3142](https://github.com/request/request/issues/3142) | Migrate to axios or node-fetch in Q2 2026. Monitor npm advisories monthly. |
```

---

## Troubleshooting

### Problem: Tests fail after update

**Symptom**: Update script rolls back automatically

**Solution**:
1. Check which batch failed (devDependencies or dependencies)
2. Review test output in console
3. Run updates with `--dry-run` to see what changed
4. Update specific packages one at a time with `--include`

```bash
# Find failing tests
npm test

# Update only non-problematic packages
node scripts/updatePackages.js --exclude <failing-package>
```

### Problem: Security audit fails

**Symptom**: `npm audit` reports high/critical vulnerabilities

**Solution**:
1. Review audit output: `npm audit`
2. Check if vulnerability is in direct or transitive dependency
3. Update the vulnerable package: `npm update <package>`
4. If no fix available, document as technical debt

```bash
# View detailed audit report
npm audit

# View audit in JSON format
npm audit --json

# Attempt automatic fix (use with caution)
npm audit fix
```

### Problem: npm install fails with conflicts

**Symptom**: Peer dependency conflicts or installation errors

**Solution**:
1. Check npm error message for specific conflict
2. Try with legacy peer deps: `npm install --legacy-peer-deps`
3. Manually resolve conflicts in package.json

```bash
# Install with legacy peer deps flag
npm install --legacy-peer-deps
```

### Problem: Rollback fails

**Symptom**: Cannot restore to checkpoint

**Solution**:
1. Check Git status: `git status`
2. Manual rollback: `git reset --hard <commit-hash>`
3. Restore node_modules: `npm ci`

```bash
# View recent commits (find checkpoint)
git log --oneline -10

# Manual rollback
git reset --hard <checkpoint-hash>
npm ci
```

### Problem: Script can't find checkpoint

**Symptom**: "Git repository not initialized" error

**Solution**:
1. Ensure you're in project root
2. Initialize Git if needed: `git init`
3. Commit current state: `git add . && git commit -m "checkpoint"`

---

## Best Practices

### ✅ DO

- **Run dry-run first** to preview changes
- **Update devDependencies first** to test on lower-risk packages
- **Review reports** after each update
- **Commit after successful updates** to preserve checkpoint
- **Run updates regularly** (monthly) to avoid large batches

### ❌ DON'T

- **Skip tests in production** - always validate updates
- **Update during active development** - ensure clean working directory
- **Ignore breaking changes reports** - plan migration for skipped packages
- **Disable auto-rollback** unless you know what you're doing
- **Update too frequently** - monthly is usually sufficient

---

## Advanced Usage

### Programmatic API

You can use the update system programmatically in Node.js:

```javascript
const { updatePackages } = require('./src/utils/packageUpdater');

async function main() {
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
}

main();
```

### Custom Batch Processing

Process batches separately with custom logic:

```javascript
const { processBatch } = require('./src/utils/packageUpdater/batchProcessor');

const batch = {
  id: 'custom-batch',
  type: 'devDependencies',
  packages: [/* ... */]
};

const result = await processBatch(batch, {
  skipTests: false,
  skipAudit: false,
  autoRollback: true
});
```

### Generating Reports Only

Generate reports from existing update state:

```javascript
const { generateReports } = require('./src/utils/packageUpdater');

const reports = await generateReports({
  updated: [/* ... */],
  skipped: [/* ... */],
  deprecated: [/* ... */]
});

console.log('Reports:', reports);
```

---

## Next Steps

After updating packages:

1. **Test thoroughly** - Run full test suite multiple times
2. **Review breaking changes** - Plan migration for skipped packages
3. **Monitor technical debt** - Set reminders to check deprecated packages
4. **Update documentation** - Note any behavioral changes
5. **Deploy to staging** - Test in production-like environment before release

---

## Getting Help

### Resources

- **Feature Spec**: `specs/005-npm-package-updates/spec.md`
- **Implementation Plan**: `specs/005-npm-package-updates/plan.md`
- **API Contract**: `specs/005-npm-package-updates/contracts/update-process-api.md`
- **Data Model**: `specs/005-npm-package-updates/data-model.md`

### Common Commands Reference

```bash
# Full update with dry-run preview
node scripts/updatePackages.js --dry-run
node scripts/updatePackages.js

# Update only devDependencies
node scripts/updatePackages.js --batch devDependencies

# Update specific packages
node scripts/updatePackages.js --include <package1>,<package2>

# Exclude problematic packages
node scripts/updatePackages.js --exclude <package1>,<package2>

# Patch updates only
node scripts/updatePackages.js --target patch

# View help
node scripts/updatePackages.js --help

# Check for breaking changes without updating
node -e "require('./src/utils/packageUpdater').detectBreakingChanges().then(console.log)"

# Check for deprecated packages
node -e "require('./src/utils/packageUpdater').detectDeprecations().then(console.log)"

# Run security audit
npm audit

# Manual rollback
git reset --hard <checkpoint-hash>
npm ci
```

---

## FAQ

**Q: How often should I run updates?**  
A: Monthly is recommended. This keeps dependencies current without overwhelming changes.

**Q: What if a critical security vulnerability requires immediate update?**  
A: Update the specific package: `npm update <package>`, run tests, and deploy immediately.

**Q: Can I update packages with breaking changes?**  
A: Yes, but manually. Review migration guides, update package.json, test thoroughly.

**Q: What happens if I interrupt the update process?**  
A: The system will rollback to the last checkpoint automatically.

**Q: Do updates affect plugin compatibility?**  
A: No. Plugin API (FDO SDK) remains stable. Only internal dependencies change.

**Q: Can I run updates in CI/CD?**  
A: Yes. Use `--skip-tests` if CI already runs tests separately. Ensure `--no-rollback` for failure visibility.

---

**Quickstart Complete**: You're now ready to safely update npm packages in the FDO project!

