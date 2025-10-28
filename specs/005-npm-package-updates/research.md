# Research: NPM Package Updates and Deprecation Resolution

**Feature**: 005-npm-package-updates  
**Date**: 2025-10-28  
**Purpose**: Research best practices, tools, and patterns for automated npm package updates with safety guarantees

---

## R1: npm Update Strategies and Tools

### Decision: Use `npm-check-updates` with custom filtering

**Rationale**: 
- Native `npm update` only updates within semver ranges, doesn't handle major versions
- `npm-check-updates` (ncu) provides fine-grained control over which packages to update
- Supports filtering by dependency type (dependencies vs devDependencies)
- Provides dry-run mode for validation before actual updates
- Can be integrated programmatically via Node.js API

**Implementation Approach**:
```javascript
const ncu = require('npm-check-updates');

// Update devDependencies only, skip major versions
await ncu.run({
  filter: (name) => isDependency(name, 'devDependencies'),
  upgrade: true,  // Modify package.json
  target: 'minor',  // Only minor/patch updates
});
```

**Alternatives Considered**:
- **npm update**: Too limited, doesn't handle major versions or provide filtering
- **Renovate/Dependabot**: Designed for CI/CD, overkill for one-time manual updates
- **Manual updates**: Error-prone, doesn't scale, no automated reporting

**References**:
- npm-check-updates: https://github.com/raineorshine/npm-check-updates
- npm update docs: https://docs.npmjs.com/cli/v8/commands/npm-update

---

## R2: Security Auditing Integration

### Decision: Use `npm audit` with JSON output parsing

**Rationale**:
- Native npm tool, no external dependencies
- Provides structured JSON output for programmatic parsing
- Categorizes vulnerabilities by severity (low, moderate, high, critical)
- Integrates with npm registry vulnerability database
- Can be automated in scripts

**Implementation Approach**:
```javascript
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

// Run audit and parse results
const { stdout } = await execAsync('npm audit --json');
const auditResult = JSON.parse(stdout);

// Block on high/critical vulnerabilities
const hasHighSeverity = auditResult.vulnerabilities.some(v => 
  v.severity === 'high' || v.severity === 'critical'
);

if (hasHighSeverity) {
  throw new Error('High/critical vulnerabilities detected');
}
```

**Alternatives Considered**:
- **Snyk**: External service, requires authentication, adds complexity
- **npm audit fix**: Too aggressive, may introduce breaking changes
- **OWASP Dependency-Check**: Designed for Java, not optimal for npm

**Best Practices**:
- Run `npm audit` after installing updated packages
- Parse JSON output to filter by severity
- Log all vulnerabilities (even if not blocking)
- Provide remediation guidance in reports

**References**:
- npm audit docs: https://docs.npmjs.com/cli/v8/commands/npm-audit
- npm audit JSON format: https://docs.npmjs.com/cli/v8/commands/npm-audit#json

---

## R3: Detecting Breaking Changes (Major Version Updates)

### Decision: Use semver comparison to identify major version bumps

**Rationale**:
- npm packages follow semantic versioning (MAJOR.MINOR.PATCH)
- Major version bump (1.x.x → 2.x.x) indicates breaking changes
- Can compare current version in package.json with latest from npm registry
- `semver` library provides robust version comparison utilities

**Implementation Approach**:
```javascript
const semver = require('semver');

function hasMajorUpdate(current, latest) {
  return semver.major(latest) > semver.major(current);
}

// Get package info from npm registry
const registryInfo = await execAsync(`npm view ${packageName} version`);
const latestVersion = registryInfo.stdout.trim();

if (hasMajorUpdate(currentVersion, latestVersion)) {
  // Skip and document in breaking changes report
  breakingChanges.push({ package: packageName, current, latest });
}
```

**Data Sources**:
- Current version: `package.json` and `package-lock.json`
- Latest version: npm registry via `npm view <package> version`
- Changelog links: `npm view <package> repository.url`

**Alternatives Considered**:
- **Manual review**: Not scalable for 50-100 packages
- **Update everything and test**: Risky, may introduce many breaking changes at once
- **npm outdated**: Provides info but doesn't categorize by breaking/non-breaking

**Best Practices**:
- Always preserve original version constraints (^, ~, exact)
- Document every skipped package with link to changelog
- Include migration guide links when available

**References**:
- Semantic versioning: https://semver.org/
- semver npm package: https://github.com/npm/node-semver
- npm view command: https://docs.npmjs.com/cli/v8/commands/npm-view

---

## R4: Automated Rollback Strategies

### Decision: Git-based rollback with tagged checkpoints

**Rationale**:
- Git provides atomic snapshots of file state
- Can create checkpoints before each batch update
- Rollback is instant (git checkout/reset)
- Preserves full history for debugging
- No custom rollback logic needed

**Implementation Approach**:
```javascript
const simpleGit = require('simple-git');
const git = simpleGit();

// Before updates: Create checkpoint
await git.add(['package.json', 'package-lock.json']);
await git.commit('checkpoint: before package updates');
const checkpoint = await git.revparse(['HEAD']);

// After tests fail: Rollback
await git.reset(['--hard', checkpoint]);
await execAsync('npm ci'); // Restore node_modules from lock file
```

**Rollback Triggers**:
1. **Automated**: Test suite failures after batch update
2. **Manual**: Production issues discovered after deployment
3. **Timeout**: Installation takes > 5 minutes (likely conflict/corruption)

**Alternatives Considered**:
- **Manual backups**: Error-prone, requires custom file copying logic
- **npm shrinkwrap**: Lock file is already preserved, doesn't help with rollback
- **Docker snapshots**: Overkill for local development, slow

**Best Practices**:
- Create checkpoint after each successful batch
- Tag checkpoints with descriptive names: `pkg-update-devdeps-success`
- Document rollback command in generated reports
- Test rollback process as part of implementation testing

**References**:
- simple-git library: https://github.com/steveukx/git-js
- Git reset docs: https://git-scm.com/docs/git-reset
- npm ci command: https://docs.npmjs.com/cli/v8/commands/npm-ci

---

## R5: Batch Update Strategy (devDependencies vs dependencies)

### Decision: Two-phase batch updates with test validation between batches

**Rationale**:
- devDependencies (build tools, test frameworks) are lower risk
  - Don't affect production runtime
  - Failures are caught during build/test phase
  - Easier to rollback without production impact
- dependencies (runtime packages) are higher risk
  - Affect production behavior
  - May introduce subtle bugs not caught by tests
  - Need more careful staging/monitoring

**Update Sequence**:
```
Phase 1: devDependencies
  ├─ Update package.json (devDependencies only)
  ├─ Run npm install
  ├─ Run full test suite
  ├─ Run build process
  ├─ If success: Commit checkpoint
  └─ If failure: Rollback to pre-Phase-1 checkpoint

Phase 2: dependencies
  ├─ Update package.json (dependencies only)
  ├─ Run npm install
  ├─ Run full test suite
  ├─ Run application smoke tests
  ├─ If success: Commit final checkpoint
  └─ If failure: Rollback to Phase-1-success checkpoint
```

**Alternatives Considered**:
- **All-at-once**: Fastest but riskiest; hard to isolate failures
- **One-by-one**: Safest but extremely slow (50-100 packages × test suite time)
- **By category** (build tools, then UI, then utilities): Harder to implement, unclear boundaries

**Best Practices**:
- Run full test suite after each batch (not just unit tests)
- Include smoke test of main application flows (launch, basic interaction)
- Log detailed timing for each phase to identify slow points

**References**:
- npm package.json structure: https://docs.npmjs.com/cli/v8/configuring-npm/package-json
- Testing strategies: https://martinfowler.com/articles/practical-test-pyramid.html

---

## R6: Deprecated Package Detection and Reporting

### Decision: Parse `npm install` output for deprecation warnings

**Rationale**:
- npm prints deprecation warnings to stderr during install
- Format is consistent: `npm WARN deprecated <package>@<version>: <message>`
- Can capture and parse programmatically
- No API call needed (already part of install process)

**Implementation Approach**:
```javascript
const { exec } = require('child_process');

function captureNpmWarnings(command) {
  return new Promise((resolve, reject) => {
    const process = exec(command);
    let stderr = '';
    
    process.stderr.on('data', (data) => {
      stderr += data;
    });
    
    process.on('close', (code) => {
      // Parse deprecation warnings
      const warnings = stderr.match(/npm WARN deprecated (.+?): (.+)/g) || [];
      const deprecated = warnings.map(w => {
        const [, pkg, message] = w.match(/deprecated (.+?): (.+)/);
        return { package: pkg, reason: message };
      });
      
      resolve({ code, deprecated });
    });
  });
}
```

**Report Structure**:
```markdown
# Technical Debt Report: Deprecated Packages

## Packages with No Replacement

| Package | Current Version | Deprecation Reason | Monitoring Plan |
|---------|----------------|--------------------|-----------------| 
| old-pkg | 1.2.3 | Unmaintained | Check monthly for security issues |
```

**Alternatives Considered**:
- **npm outdated**: Doesn't show deprecation status
- **npm-check**: External tool, requires installation
- **Manual inspection**: Not scalable, error-prone

**Best Practices**:
- Distinguish between "deprecated but has replacement" vs "deprecated with no replacement"
- Include links to replacement packages when available
- Set up monitoring for security issues in deprecated packages

**References**:
- npm deprecate command: https://docs.npmjs.com/cli/v8/commands/npm-deprecate
- Deprecation best practices: https://docs.npmjs.com/deprecating-and-undeprecating-packages-or-package-versions

---

## R7: Test Suite Integration and Failure Detection

### Decision: Use Jest programmatic API with custom reporters

**Rationale**:
- Project already uses Jest (per package.json)
- Jest provides Node.js API for programmatic execution
- Can capture test results and parse failures
- Custom reporters can format output for automation

**Implementation Approach**:
```javascript
const jest = require('jest');

async function runTests() {
  const results = await jest.runCLI(
    {
      json: true,
      silent: true,
      testMatch: ['**/*.test.js'],
    },
    [process.cwd()]
  );
  
  const { success, numFailedTests, numPassedTests } = results.results;
  
  if (!success) {
    console.error(`Tests failed: ${numFailedTests} failures`);
    return { success: false, failures: numFailedTests };
  }
  
  return { success: true, passed: numPassedTests };
}
```

**Test Validation Strategy**:
1. Run full test suite (not just affected tests)
2. Require 100% pass rate (no flaky test tolerance)
3. Include integration tests for critical paths
4. Capture test timing to detect performance regressions

**Alternatives Considered**:
- **Shell script**: Less control, harder to parse output
- **npm test only**: Limited error handling, no programmatic access
- **Custom test runner**: Overkill, adds complexity

**Best Practices**:
- Always run tests in clean environment (npm ci before tests)
- Capture both stdout and stderr for debugging
- Log test execution time (detect performance regressions)
- Generate test report artifact for manual review

**References**:
- Jest programmatic API: https://jestjs.io/docs/cli
- Jest configuration: https://jestjs.io/docs/configuration

---

## R8: Report Generation and Documentation

### Decision: Markdown reports with structured format

**Rationale**:
- Markdown is human-readable and version-control friendly
- Can be viewed in GitHub/GitLab with formatting
- Easy to generate programmatically
- Supports tables for structured data

**Report Types**:

**1. Breaking Changes Report**:
```markdown
# Breaking Changes Report

Generated: 2025-10-28

## Packages Skipped (Major Version Updates)

| Package | Current | Latest | Changelog |
|---------|---------|--------|-----------|
| react | 17.0.2 | 18.3.1 | [View](https://github.com/facebook/react/releases) |
```

**2. Technical Debt Report**:
```markdown
# Technical Debt Report

## Deprecated Packages Without Replacement

| Package | Current | Reason | Action Plan |
|---------|---------|--------|-------------|
| old-lib | 1.0.0 | Unmaintained | Monitor for security issues |
```

**3. Update Summary**:
```markdown
# Update Summary

- **Packages Updated**: 45
- **Packages Skipped**: 5 (breaking changes)
- **Deprecated Packages**: 2 (no replacement)
- **Security Audit**: ✅ PASS (0 high/critical)
- **Test Results**: ✅ PASS (128/128 tests)
```

**Storage Location**: `specs/005-npm-package-updates/reports/`

**Best Practices**:
- Include generation timestamp
- Link to relevant changelogs and documentation
- Use emoji/symbols for visual scanning (✅ ❌ ⚠️)
- Keep reports under version control for history

**References**:
- Markdown guide: https://www.markdownguide.org/
- GitHub Flavored Markdown: https://github.github.com/gfm/

---

## R9: Performance Optimization for npm install

### Decision: Use npm ci in production, npm install in development

**Rationale**:
- `npm ci` is faster for clean installs (uses package-lock.json directly)
- `npm install` is needed when updating package.json
- CI/CD should always use `npm ci` for reproducibility

**Implementation Strategy**:
```javascript
// During updates: Use npm install (modifies lock file)
await execAsync('npm install');

// After rollback: Use npm ci (restore from lock file)
await execAsync('npm ci');
```

**Performance Tips**:
1. Use `--prefer-offline` to prioritize npm cache
2. Use `--no-audit` during install (run audit separately)
3. Use `--legacy-peer-deps` if peer dependency conflicts block install
4. Consider `npm prune` to remove unused packages after updates

**Alternatives Considered**:
- **pnpm**: Faster but requires migration (out of scope)
- **yarn**: Different lock file format (out of scope)

**Benchmarks** (typical Electron app):
- npm install (with cache): ~30-90 seconds
- npm ci (with cache): ~15-30 seconds
- npm install (no cache): ~2-5 minutes

**References**:
- npm ci docs: https://docs.npmjs.com/cli/v8/commands/npm-ci
- npm performance: https://docs.npmjs.com/cli/v8/using-npm/config#cache

---

## R10: Git Integration and Version Control

### Decision: Commit package updates with descriptive messages

**Rationale**:
- Package updates should be tracked in version control
- Descriptive commit messages enable easy rollback
- Lock file changes should be committed atomically with package.json

**Commit Strategy**:
```bash
# After successful devDependencies update
git add package.json package-lock.json
git commit -m "chore(deps): update devDependencies

- Updated 30 packages to latest minor/patch versions
- Skipped 3 packages with breaking changes (see reports/)
- All tests passing"

# After successful dependencies update
git add package.json package-lock.json specs/005-npm-package-updates/reports/
git commit -m "chore(deps): update dependencies

- Updated 45 packages to latest minor/patch versions
- Skipped 5 packages with breaking changes
- Security audit: 0 vulnerabilities
- All tests passing"
```

**Best Practices**:
- Use conventional commit format: `chore(deps): <message>`
- Include test results in commit message
- Commit reports directory for documentation
- Tag successful update completion: `git tag pkg-update-2025-10-28`

**Alternatives Considered**:
- **Single commit**: Harder to rollback devDeps vs deps separately
- **Separate branch**: Overkill for maintenance updates
- **No commits**: Loses history and rollback capability

**References**:
- Conventional commits: https://www.conventionalcommits.org/
- Git tagging: https://git-scm.com/book/en/v2/Git-Basics-Tagging

---

## Implementation Checklist

Based on research above, the implementation requires:

- [ ] Install `npm-check-updates` as devDependency
- [ ] Install `semver` for version comparison
- [ ] Install `simple-git` for Git operations
- [ ] Create `src/utils/packageUpdater.js` module
- [ ] Create `scripts/updatePackages.js` CLI script
- [ ] Implement batch update logic (devDeps → deps)
- [ ] Implement security audit integration
- [ ] Implement breaking changes detection
- [ ] Implement rollback mechanism (Git-based)
- [ ] Implement report generation (Markdown)
- [ ] Create Jest tests for update logic
- [ ] Create integration test for full update flow
- [ ] Document manual rollback procedure
- [ ] Add npm scripts to package.json

---

## Key Decisions Summary

| Decision Area | Choice | Rationale |
|--------------|--------|-----------|
| Update Tool | npm-check-updates | Fine-grained control, programmatic API |
| Security Scanning | npm audit (native) | No external dependencies, JSON output |
| Breaking Changes | semver comparison | Reliable detection of major version bumps |
| Rollback Strategy | Git checkpoints | Atomic, instant, preserves history |
| Batch Strategy | devDeps → deps | Lower risk first, test between batches |
| Deprecation Detection | Parse npm output | No API needed, consistent format |
| Test Integration | Jest programmatic API | Project standard, full control |
| Report Format | Markdown | Human-readable, VCS-friendly |
| Performance | npm ci for restore | Faster, reproducible |
| Version Control | Descriptive commits | History, rollback capability |

---

**Research Complete**: All technical unknowns resolved. Ready for Phase 1 (Data Model, Contracts, Quickstart).

