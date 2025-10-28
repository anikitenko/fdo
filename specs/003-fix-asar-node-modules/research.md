# Research: Fix Missing Asset Node Modules in Packaged Application

**Date**: 2025-10-28  
**Feature**: 003-fix-asar-node-modules  
**Purpose**: Resolve technical unknowns and make key decisions for implementation

## Research Areas

### 1. Electron-builder ASAR Configuration

**Question**: How does electron-builder determine what gets included in the ASAR archive, and how can we ensure `dist/renderer/assets/node_modules` is preserved?

**Research Findings**:

Electron-builder uses the following configuration options for ASAR packaging:

1. **`asar: true`** (default): Package app into ASAR archive
2. **`asarUnpack`**: Pattern(s) for files to extract from ASAR (unpack to `app.asar.unpacked/`)
3. **`files`**: Pattern(s) for files to include in the package

**Key Insight**: The issue is likely **NOT** with `asarUnpack` (which extracts files from ASAR) but rather with the `files` patterns that determine what gets copied to the package before ASAR creation.

**Default Behavior**: 
- Electron-builder copies files from `dist/` directory by default
- If webpack outputs to `dist/renderer/assets/node_modules`, these files exist on disk
- The ASAR archive is created from the copied files

**Root Cause Hypothesis**:
One of these scenarios is preventing assets from reaching the ASAR:
1. **`files` pattern excludes `node_modules`**: Common pattern is `"!**/node_modules/**"` to avoid packaging dependencies
2. **Missing `extraResources` or `extraFiles`**: Assets need explicit inclusion
3. **Webpack output not preserved**: Files are created but cleaned before packaging

**Decision**: 
- Check `package.json` or `electron-builder` config for `files` patterns
- Verify `dist/renderer/assets/node_modules` exists after webpack build
- Add explicit `files` include pattern: `"dist/renderer/assets/node_modules/**/*"`

**Alternatives Considered**:
- ❌ Use `asarUnpack` - This extracts files from ASAR; we need them IN the ASAR
- ❌ Use `extraResources` - This puts files outside ASAR in Resources/ directory
- ✅ Use `files` pattern - Ensures webpack output is included in ASAR

**References**:
- electron-builder docs: https://www.electron.build/configuration/contents
- ASAR format: Files must be explicitly included via `files` patterns

---

### 2. Webpack CopyWebpackPlugin Parsing

**Question**: How can the validation script programmatically extract copy patterns from `webpack.renderer.config.js`?

**Research Findings**:

**Approach 1: Static Analysis** (Parse AST)
- Use `@babel/parser` or `acorn` to parse webpack config as JavaScript AST
- Extract `CopyWebpackPlugin` configuration from plugins array
- Complex due to dynamic config (functions, conditionals, variables)

**Approach 2: Dynamic Evaluation** (Require and Inspect)
- `require()` the webpack config file directly
- Access `module.exports.plugins` array
- Find `CopyWebpackPlugin` instance(s)
- Extract `patterns` property

**Approach 3: Hybrid** (Eval with Sandboxing)
- Evaluate config in controlled context
- Mock webpack/path/require as needed
- Extract specific plugin configuration

**Decision**: **Use Dynamic Evaluation (Approach 2)**

**Implementation**:
```javascript
const webpackConfig = require('../webpack.renderer.config.js');
const CopyWebpackPlugin = require('copy-webpack-plugin');

const copyPlugin = webpackConfig.plugins.find(
  plugin => plugin.constructor.name === 'CopyWebpackPlugin'
);

const patterns = copyPlugin.patterns; // Array of { from, to } objects
```

**Rationale**:
- Simplest approach - leverages Node.js module system
- Webpack config is already valid JavaScript
- Avoids complexity of AST parsing
- Handles dynamic config correctly (functions execute)

**Alternatives Considered**:
- ❌ AST parsing - Overly complex for this use case
- ❌ Regex/string matching - Brittle, fails on formatting changes
- ✅ Direct require() - Simple, robust, handles dynamic config

**Edge Case Handling**:
- Config exports function: Call with empty env/argv: `webpackConfig({}, {})`
- Multiple CopyWebpackPlugin instances: Iterate all, merge patterns
- Plugin not found: Validation should fail with clear error

**References**:
- CopyWebpackPlugin docs: https://webpack.js.org/plugins/copy-webpack-plugin/
- Pattern structure: `{ from: string, to: string, globOptions?: object }`

---

### 3. ASAR Extraction and Validation

**Question**: What's the best Node.js library/approach for reading ASAR archive contents without full extraction?

**Research Findings**:

**Option 1: `asar` package (Official)**
```javascript
const asar = require('asar');

// List all files
const files = asar.listPackage('/path/to/app.asar');

// Extract single file
const content = asar.extractFile('/path/to/app.asar', 'file.txt');

// Extract directory
asar.extractAll('/path/to/app.asar', '/dest/path');
```

**Option 2: `@electron/asar` (Electron's fork)**
- Modern replacement for `asar` package
- Better TypeScript support
- Maintained by Electron team

**Option 3: Manual Implementation**
- ASAR is a simple tar-like format
- Header is JSON (file tree + offsets)
- Could implement custom reader

**Decision**: **Use `@electron/asar` package**

**Implementation**:
```javascript
const asar = require('@electron/asar');
const path = require('path');

async function validateAsarAssets(asarPath, expectedPaths) {
  const files = await asar.listPackage(asarPath);
  
  const missingPaths = expectedPaths.filter(expectedPath => {
    return !files.some(file => file.startsWith(expectedPath));
  });
  
  return {
    valid: missingPaths.length === 0,
    missingPaths,
    foundPaths: files.filter(f => f.includes('assets/node_modules'))
  };
}
```

**Rationale**:
- Official Electron tooling - guaranteed compatibility
- Lightweight - no full extraction needed
- `listPackage()` returns array of file paths - perfect for validation
- Active maintenance by Electron team

**Alternatives Considered**:
- ❌ Full extraction - Wasteful, slow, requires disk space
- ❌ Manual implementation - Reinventing the wheel
- ✅ @electron/asar - Official, lightweight, perfect fit

**Validation Logic**:
1. Get ASAR path from electron-builder output (platform-specific)
2. Call `asar.listPackage(asarPath)` to get file list
3. Check for presence of `renderer/assets/node_modules/@anikitenko/fdo-sdk/**`
4. Check for `renderer/assets/node_modules/@babel/standalone/**`
5. Check for `renderer/assets/node_modules/goober/**`
6. Report missing paths with webpack pattern reference

**References**:
- @electron/asar: https://github.com/electron/asar
- ASAR format spec: https://github.com/electron/asar#format

---

### 4. Cross-Platform Build Integration

**Question**: Where and how should validation be integrated into the build process for all platforms?

**Research Findings**:

**Current Build Scripts** (from package.json):
```json
{
  "dist:mac": "npm run build && electron-builder --mac",
  "dist:linux": "npm run build && electron-builder --linux",
  "dist:win": "npm run build && electron-builder --win"
}
```

**Integration Points**:

**Option 1: Post-build Hook** (package.json)
```json
{
  "dist:mac": "npm run build && electron-builder --mac && npm run validate:asar:mac",
  "validate:asar:mac": "node scripts/validate-asar-assets.js --platform=mac"
}
```

**Option 2: Electron-builder Hook** (afterPack)
```javascript
// electron-builder config
{
  afterPack: async (context) => {
    await require('./scripts/validate-asar-assets.js')(context);
  }
}
```

**Option 3: npm postscript**
```json
{
  "postdist:mac": "node scripts/validate-asar-assets.js --platform=mac"
}
```

**Decision**: **Use Post-build Hook (Option 1) with Platform Detection**

**Implementation**:
```json
{
  "scripts": {
    "dist:mac": "npm run build && electron-builder --mac && npm run validate:asar -- --platform=mac",
    "dist:linux": "npm run build && electron-builder --linux && npm run validate:asar -- --platform=linux",
    "dist:win": "npm run build && electron-builder --win && npm run validate:asar -- --platform=win",
    "validate:asar": "node scripts/validate-asar-assets.js"
  }
}
```

**ASAR Path Detection** (platform-specific):
```javascript
function getAsarPath(platform) {
  const basePath = path.join(__dirname, '..', 'release');
  
  switch(platform) {
    case 'mac':
      return path.join(basePath, 'mac-arm64/FDO (FlexDevOPs).app/Contents/Resources/app.asar');
    case 'linux':
      return path.join(basePath, 'linux-unpacked/resources/app.asar');
    case 'win':
      return path.join(basePath, 'win-unpacked/resources/app.asar');
    default:
      throw new Error(`Unknown platform: ${platform}`);
  }
}
```

**Rationale**:
- Simple, explicit, easy to understand
- Runs after electron-builder completes (as per clarification)
- Platform-specific paths handled via CLI argument
- Fails build if validation fails (via process.exit(1))

**Alternatives Considered**:
- ❌ afterPack hook - Runs during packaging, not after final ASAR creation
- ❌ npm postscript - Less explicit, harder to debug
- ✅ Explicit post-build command - Clear, debuggable, controllable

**Error Handling**:
```javascript
// In validate script
if (validationFailed) {
  console.error('❌ ASAR Validation Failed');
  console.error('Missing assets:', missingPaths);
  console.error('Expected from webpack:', expectedPaths);
  process.exit(1); // Fail the build
}
```

**References**:
- npm scripts: https://docs.npmjs.com/cli/v9/using-npm/scripts
- Process exit codes: https://nodejs.org/api/process.html#process_process_exit_code

---

### 5. Error Handling and Reporting

**Question**: What's the best format for error messages that satisfy FR-008 (clear error messages with expected vs. actual paths and troubleshooting)?

**Research Findings**:

**Best Practices**:
1. **Use structured output**: Console colors, tables, clear sections
2. **Show comparison**: Expected vs. Actual
3. **Provide context**: Why it failed, what to check
4. **Actionable steps**: What the developer should do next

**Error Message Format** (Decision):

```javascript
const chalk = require('chalk'); // Optional: colored output

function reportValidationFailure(result) {
  console.error('\n' + chalk.red('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.error(chalk.red.bold('❌ ASAR Asset Validation Failed'));
  console.error(chalk.red('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));
  
  console.error(chalk.yellow('Missing Assets:'));
  result.missingPaths.forEach(p => {
    console.error(chalk.red('  ✗'), p);
  });
  
  console.error(chalk.yellow('\nExpected (from webpack.renderer.config.js):'));
  result.expectedPatterns.forEach(pattern => {
    console.error('  •', `${pattern.from} → ${pattern.to}`);
  });
  
  console.error(chalk.yellow('\nActual (in app.asar):'));
  if (result.foundPaths.length > 0) {
    result.foundPaths.forEach(p => {
      console.error(chalk.green('  ✓'), p);
    });
  } else {
    console.error(chalk.red('  (no assets/node_modules found in ASAR)'));
  }
  
  console.error(chalk.yellow('\nTroubleshooting:'));
  console.error('  1. Verify webpack build: check dist/renderer/assets/node_modules/');
  console.error('  2. Check electron-builder config: ensure assets not excluded');
  console.error('  3. Check package.json "files" patterns');
  console.error('  4. Run: npm run build && ls -la dist/renderer/assets/node_modules');
  
  console.error('\n' + chalk.red('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));
}
```

**Decision**: Use structured console output with chalk for colors (optional)

**Rationale**:
- Clear visual separation (box borders)
- Color-coded status (red = missing, green = found)
- Side-by-side comparison (expected vs. actual)
- Actionable troubleshooting steps
- Satisfies FR-008 requirements

**Alternatives Considered**:
- ❌ Plain text - Harder to scan visually
- ❌ JSON output - Not human-friendly for CI logs
- ✅ Structured console with colors - Best of both worlds

**Fallback** (if chalk not desired):
Use plain console.error with box-drawing characters and emojis (works in all terminals).

**References**:
- chalk: https://github.com/chalk/chalk
- Node.js console: https://nodejs.org/api/console.html

---

## Summary of Key Decisions

| Area | Decision | Rationale |
|------|----------|-----------|
| **Electron-builder Config** | Add explicit `files` pattern for `dist/renderer/assets/node_modules/**/*` | Ensures webpack output is included in ASAR packaging |
| **Webpack Parsing** | Dynamic evaluation via `require()` | Simplest, handles dynamic configs, leverages Node.js module system |
| **ASAR Validation** | Use `@electron/asar.listPackage()` | Official Electron tool, lightweight, no full extraction needed |
| **Build Integration** | Post-build npm script with platform argument | Clear, explicit, runs after electron-builder, easy to debug |
| **Error Reporting** | Structured console output with comparison tables | Satisfies FR-008, provides actionable troubleshooting steps |
| **Validation Timing** | After electron-builder completes (per clarification) | Validates final deliverable, not intermediate artifacts |
| **Automatic Sync** | Parse webpack config at validation time | No manual maintenance, stays in sync with webpack changes (per clarification) |

## Technical Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Webpack config format changes | Low | Medium | Validation detects and reports parsing errors |
| electron-builder `files` pattern conflicts | Medium | High | Test with actual build, document pattern precedence |
| ASAR path differs across platforms | Low | High | Platform detection with fallback paths |
| Webpack build doesn't create assets | Low | Critical | Validation reports if webpack output missing |

## Next Steps

1. Create data-model.md (Phase 1) - Document configuration structures
2. Create contracts/validation-api.md (Phase 1) - Define validation script interface
3. Create quickstart.md (Phase 1) - Setup and usage guide
4. Proceed to implementation tasks (/speckit.tasks)

