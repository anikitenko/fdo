# Research: Dynamic CLI Path Resolution

**Feature**: `004-dynamic-cli-paths`  
**Date**: 2025-10-28  
**Purpose**: Research best practices and patterns for dynamic CLI installation across platforms

## Overview

This document consolidates research findings for implementing dynamic CLI path resolution in the FDO application. All research items resolve "NEEDS CLARIFICATION" markers from the technical context and inform implementation decisions.

---

## R1: Electron Path Detection APIs

### Decision

Use a combination of Electron APIs with fallback chain:
1. **Primary**: `app.getAppPath()` - Returns application source directory
2. **Fallback**: `process.execPath` - Returns path to Electron executable
3. **Validation**: `fs.existsSync()` and `fs.accessSync()` for path verification

### Rationale

**`app.getAppPath()`** best practices (from Electron documentation):
- Returns the application's source directory
- Works for both development and production builds
- Points to: 
  - Production: `<app>.app/Contents/Resources/app.asar` (macOS)
  - Development: Project root directory
- Safe to use across all platforms

**`process.execPath`** characteristics:
- Returns actual executable binary path
- Useful for creating wrapper scripts that call the executable
- Example outputs:
  - macOS: `/Applications/FDO.app/Contents/MacOS/FDO (FlexDevOPs)`
  - Windows: `C:\Program Files\FDO\FDO.exe`
  - Linux: `/opt/fdo/FDO` or `/usr/lib/fdo/fdo`

**Detection Strategy**:
```javascript
function detectApplicationPath() {
  // For wrapper scripts, we need the executable path
  const execPath = process.execPath;
  
  // Validate it exists and is executable
  if (fs.existsSync(execPath)) {
    try {
      fs.accessSync(execPath, fs.constants.X_OK);
      return { path: execPath, method: 'process.execPath' };
    } catch (err) {
      // Not executable, try app path
    }
  }
  
  // Fallback to app path
  const appPath = app.getAppPath();
  return { path: appPath, method: 'app.getAppPath' };
}
```

### Alternatives Considered

- **Hardcoded paths**: Current approach, fails for custom installations
- **Environment variables**: Not reliably set for GUI applications
- **Registry queries (Windows)**: Complex, requires additional dependencies
- **Which/whereis commands**: Unreliable, varies by shell configuration

### Sources

- Electron Documentation: https://www.electronjs.org/docs/latest/api/app#appgetapppath
- Electron Documentation: https://nodejs.org/api/process.html#processexecpath
- Stack Overflow: "How to get the path of the Electron app in production" (multiple threads)

---

## R2: Platform-Specific CLI Installation Patterns

### Decision

**macOS**:
- **Primary**: `/usr/local/bin/fdo` (system-wide, requires sudo)
- **Fallback 1**: `~/.local/bin/fdo` (user-level, in XDG Base Directory spec)
- **Fallback 2**: `~/bin/fdo` (traditional user bin directory)
- **Format**: Bash script wrapper with shebang

**Windows**:
- **Primary**: `%USERPROFILE%\AppData\Local\FDO\bin\fdo.cmd` (user-level, no admin needed)
- **Format**: Batch file (.cmd) with `@echo off`
- **PATH Update**: Use PowerShell `[Environment]::SetEnvironmentVariable()` for user PATH

**Linux**:
- **Primary**: `/usr/local/bin/fdo` (system-wide, requires sudo)
- **Fallback 1**: `~/.local/bin/fdo` (XDG Base Directory spec, systemd default)
- **Fallback 2**: `~/bin/fdo` (traditional user directory)
- **Format**: Shell script with `#!/bin/sh` (POSIX-compliant)

### Rationale

**macOS & Linux Shared Patterns**:
- `/usr/local/bin` is standard for user-installed binaries not managed by package managers
- `~/.local/bin` follows XDG Base Directory Specification, automatically in PATH on modern systems
- `~/bin` is traditional fallback, commonly added to PATH in shell profiles

**Windows Specific**:
- `%LOCALAPPDATA%` doesn't require administrator rights
- `.cmd` files are natively executable on Windows (no file associations needed)
- User-level PATH modifications don't require elevation
- Per-user PATH persists across sessions and system reboots

**Wrapper Script Patterns**:

macOS/Linux:
```bash
#!/bin/bash
exec "/path/to/FDO.app/Contents/MacOS/FDO (FlexDevOPs)" "$@"
```

Windows:
```batch
@echo off
"C:\Program Files\FDO\FDO.exe" %*
```

### Alternatives Considered

- **Symlinks instead of wrapper scripts**: 
  - Rejected: Doesn't work reliably on Windows
  - Rejected: Breaks when app moves (portable installations)
  - Rejected: Doesn't pass arguments correctly on some platforms

- **Global installation only** (`/usr/bin`, `C:\Windows\System32`):
  - Rejected: Requires admin/root for every installation
  - Rejected: Not suitable for user-level Electron apps

- **Homebrew/Chocolatey integration**:
  - Rejected: Adds external dependencies
  - Rejected: Not all users have package managers installed

### Sources

- XDG Base Directory Specification: https://specifications.freedesktop.org/basedir-spec/
- systemd file-hierarchy(7) man page
- Windows Environment Variables documentation
- npm global bin directory patterns (cross-platform reference)

---

## R3: PATH Environment Variable Update Strategies

### Decision

**macOS/Linux**: 
- **Do NOT modify PATH automatically**
- Instead: Install to directories already in PATH (`/usr/local/bin`, `~/.local/bin`)
- Rationale: Shell profile editing is fragile and shell-specific

**Windows**: 
- **DO modify user PATH** (not system PATH)
- Use PowerShell to update user environment variable persistently
- Check if directory already in PATH before adding

```javascript
// Windows PATH update
const currentPath = execSync(
  `[Environment]::GetEnvironmentVariable("Path", "User")`,
  { encoding: 'utf8', shell: 'powershell.exe' }
).trim();

if (!currentPath.includes(installDir)) {
  const newPath = currentPath + ';' + installDir;
  execSync(
    `[Environment]::SetEnvironmentVariable("Path", "${newPath}", "User")`,
    { shell: 'powershell.exe' }
  );
}
```

### Rationale

**Unix-like Systems**:
- Modern distributions automatically include `~/.local/bin` in PATH
- `/usr/local/bin` is in default PATH on all Unix systems
- Shell profile editing is error-prone (bash vs zsh vs fish vs tcsh)
- Users expect to add `~/bin` themselves if needed

**Windows**:
- GUI applications don't inherit shell PATH modifications
- User environment variables are system-wide and persistent
- PowerShell's [Environment] class provides reliable cross-session updates
- No shell profile to edit (cmd.exe, PowerShell have different configs)

**Best Practice**: 
- Prefer installation to locations already in PATH
- Only modify PATH as last resort (Windows user-level only)
- Never modify system PATH without explicit user consent

### Alternatives Considered

- **Edit shell profiles (~/.bashrc, ~/.zshrc)**:
  - Rejected: Multiple shells, many profile files
  - Rejected: Doesn't affect already-running terminals
  - Rejected: Complex to detect user's shell

- **Modify system PATH**:
  - Rejected: Requires admin/root privileges
  - Rejected: Affects all users (unexpected behavior)

- **Ask user to add to PATH manually**:
  - Rejected: Poor user experience
  - Rejected: Doesn't meet "under 30 seconds" success criterion

### Sources

- PowerShell Environment Variable documentation
- XDG Base Directory default PATH inclusion (systemd)
- Electron Builder PATH handling analysis

---

## R4: Permission Handling Approaches

### Decision

Use existing `runWithSudo` utility with user confirmation dialog for:
- macOS/Linux: Installing to `/usr/local/bin`
- Windows: Not needed for user-level installations

**Permission Checking Strategy**:
```javascript
function isWritable(targetPath) {
  try {
    fs.accessSync(path.dirname(targetPath), fs.constants.W_OK);
    return true;
  } catch (err) {
    return false;
  }
}

function selectInstallPath(platform, primaryPath, fallbackPaths) {
  // Try primary first
  if (isWritable(primaryPath)) {
    return { path: primaryPath, needsSudo: false };
  }
  
  // Try fallbacks
  for (const fallback of fallbackPaths) {
    if (isWritable(fallback)) {
      return { path: fallback, needsSudo: false };
    }
  }
  
  // All failed, use primary with sudo
  return { path: primaryPath, needsSudo: true };
}
```

### Rationale

**Existing `runWithSudo` Integration**:
- Already implemented and tested (`src/utils/runWithSudo.js`)
- Uses Electron dialog for user confirmation (matches app UX)
- Leverages `@expo/sudo-prompt` for cross-platform elevation
- Shows macOS permission dialog with app icon and custom message

**Permission Strategy**:
1. **Check before attempting**: Prevents unnecessary sudo prompts
2. **Prefer user-level locations**: Better UX (no admin needed)
3. **Fallback gracefully**: Try multiple locations before requiring elevation
4. **Explicit user confirmation**: Security best practice

**Platform-Specific Behavior**:
- **macOS**: `sudo` for `/usr/local/bin`, direct write for `~/.local/bin` and `~/bin`
- **Windows**: No elevation needed for `%LOCALAPPDATA%`, direct write
- **Linux**: `sudo` for `/usr/local/bin`, direct write for user directories

### Alternatives Considered

- **Always use sudo**:
  - Rejected: Annoying for user-level installations
  - Rejected: Fails on systems where user isn't in sudoers

- **Create directories if missing**:
  - Considered: `mkdir -p ~/.local/bin`
  - Accepted for user directories
  - Rejected for system directories (security risk)

- **Windows UAC elevation**:
  - Rejected: Not needed for user-level installations
  - Complex to implement (requires manifest changes)

### Sources

- Node.js fs.accessSync documentation
- @expo/sudo-prompt library documentation
- Existing FDO `runWithSudo.js` implementation

---

## R5: Idempotent File Operation Patterns

### Decision

Implement idempotent installation using file existence check:

```javascript
async function installCLI(targetPath, wrapperContent) {
  // Check if file already exists (idempotent check)
  if (fs.existsSync(targetPath)) {
    log.info(`CLI already exists at ${targetPath}, skipping installation`);
    return { success: true, skipped: true, path: targetPath };
  }
  
  try {
    // Create parent directory if needed
    const parentDir = path.dirname(targetPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    
    // Write wrapper script
    fs.writeFileSync(targetPath, wrapperContent, { mode: 0o755 });
    
    log.info(`CLI installed successfully to ${targetPath}`);
    return { success: true, skipped: false, path: targetPath };
    
  } catch (err) {
    log.error(`Failed to install CLI to ${targetPath}:`, err);
    return { 
      success: false, 
      error: err.message,
      attemptedPath: targetPath,
      recoveryInstructions: `Manually remove ${targetPath} and retry installation`
    };
  }
}
```

### Rationale

**Idempotent Benefits** (from clarification session):
- **Safe retry**: Users can retry failed installations without manual cleanup
- **Fast no-op**: Subsequent installations skip quickly (< 1 second check)
- **Multi-instance handling**: First FDO installation wins, others skip
- **Upgrade-friendly**: Uninstall + reinstall workflow remains clean

**File Existence Check**:
- Simple and reliable across all platforms
- Works for both wrapper scripts and batch files
- No partial state issues (file either exists or doesn't)

**Error Handling**:
- Leave partial installations intact (don't try to rollback)
- Provide detailed error messages with recovery instructions
- Log all attempts for troubleshooting

### Alternatives Considered

- **Hash-based content checking**:
  - Rejected: Unnecessary complexity for simple wrappers
  - Rejected: Doesn't handle user modifications well

- **Version tracking in metadata**:
  - Rejected: Over-engineering for CLI wrappers
  - Rejected: Requires maintaining separate version file

- **Atomic replace (write to temp, then rename)**:
  - Rejected: Conflicts with idempotent "skip if exists" behavior
  - Could be added for forced reinstall feature (future)

- **Automatic rollback on failure**:
  - Rejected: Can make debugging harder
  - Rejected: Idempotent retry is simpler and safer

### Sources

- Idempotent Operations patterns (software engineering best practices)
- npm install idempotent behavior analysis
- Unix command idempotency patterns (mkdir -p, install -m)

---

## R6: Logging Strategies for System Operations

### Decision

Use electron-log (already in project dependencies) with two-tier logging:

**Info Level** (always logged):
- Installation start with platform and target path
- Each fallback attempt ("Primary path not writable, trying fallback...")
- Final result (success, skip, or failure)
- Development environment detection

**Debug Level** (logged when debug mode enabled):
- Each permission check result
- Path validation details (exists, writable, in PATH)
- Environment detection method
- Wrapper script content generated

**Implementation Pattern**:
```javascript
import log from 'electron-log';

// Configure in main.js if needed
log.transports.file.level = 'info';
log.transports.console.level = 'debug'; // Development

// In installFDOCLI.js
log.info(`[CLI Install] Starting installation for ${platform}`);
log.debug(`[CLI Install] Application path: ${appPath} (method: ${detectionMethod})`);

if (!isWritable(primaryPath)) {
  log.info(`[CLI Install] Primary path ${primaryPath} not writable, trying fallback`);
  log.debug(`[CLI Install] Permission check failed: ${primaryPath}`, permissionError);
}

if (isDevelopmentEnvironment) {
  log.warn(`[CLI Install] Development environment detected, CLI will point to dev build`);
}

log.info(`[CLI Install] Successfully installed to ${targetPath}`);
```

### Rationale

**Two-Tier Approach** (from clarification session):
- **Info**: Provides breadcrumb trail for troubleshooting without noise
- **Debug**: Full detail when needed (developer mode, support cases)
- **Balance**: Production logs stay clean, development gets full visibility

**Structured Logging Best Practices**:
- Consistent prefix (`[CLI Install]`) for grep/filtering
- Include key context (platform, paths, methods)
- Use appropriate log levels (info, warn, error, debug)
- Structured data in debug logs for analysis

**electron-log Benefits**:
- Already integrated in FDO project
- Writes to platform-specific log files automatically
- Supports log levels and transports
- Integrates with Electron's renderer process logging

**Log File Locations** (electron-log defaults):
- macOS: `~/Library/Logs/FDO/main.log`
- Windows: `%USERPROFILE%\AppData\Roaming\FDO\logs\main.log`
- Linux: `~/.config/FDO/logs/main.log`

### Alternatives Considered

- **Console.log only**:
  - Rejected: Logs lost when app closed
  - Rejected: No log levels or filtering

- **Custom logging solution**:
  - Rejected: electron-log already meets needs
  - Rejected: Unnecessary complexity

- **Verbose logging at info level**:
  - Rejected: Creates log noise in production
  - Rejected: Makes troubleshooting harder (signal/noise ratio)

- **No logging at all**:
  - Rejected: Violates observability principle (Constitution VII)
  - Rejected: Makes debugging installation issues impossible

### Sources

- electron-log documentation: https://github.com/megahertz/electron-log
- Electron logging best practices
- Existing FDO logging patterns (App Toaster, NotificationCenter)

---

## R7: Development Environment Detection

### Decision

Detect development environment using multiple signals:

```javascript
function isDevelopmentEnvironment() {
  // Signal 1: NODE_ENV environment variable
  if (process.env.NODE_ENV === 'development') {
    return true;
  }
  
  // Signal 2: Electron executable path (dev uses electron binary)
  const execPath = process.execPath.toLowerCase();
  if (execPath.includes('electron')) {
    return true;
  }
  
  // Signal 3: App not packaged (Electron API)
  if (!app.isPackaged) {
    return true;
  }
  
  return false;
}
```

### Rationale

**Multi-Signal Approach**:
- **NODE_ENV**: Set by npm scripts (`npm start` sets development)
- **Executable path**: Development uses `electron` binary, production uses app name
- **app.isPackaged**: Electron API explicitly indicates packaged vs development

**Development Mode Behavior** (from clarification session):
- **Allow installation**: Developers can use CLI during development
- **Log warning**: Clear indication this is dev mode, not production
- **Use detected path**: Points to running development instance

**Benefits for Developers**:
- Test CLI integration during development
- Debug plugin CLI commands
- Verify cross-platform behavior before packaging

### Alternatives Considered

- **Block installation in dev mode**:
  - Rejected: Reduces developer productivity
  - Rejected: Makes testing CLI features harder

- **Use separate CLI name (fdo-dev)**:
  - Rejected: Adds complexity
  - Rejected: Users might not understand distinction

- **Only check NODE_ENV**:
  - Rejected: Not always reliably set
  - Rejected: Doesn't detect all dev scenarios

### Sources

- Electron app.isPackaged documentation
- Node.js process.env.NODE_ENV convention
- Electron development vs production detection patterns

---

## R8: Cross-Platform Path Handling

### Decision

Use Node.js `path` module consistently with platform-specific separators:

```javascript
import path from 'path';
import { homedir, platform } from 'os';

function getPlatformPaths() {
  const osType = platform();
  
  if (osType === 'darwin' || osType === 'linux') {
    return {
      primary: '/usr/local/bin/fdo',
      fallbacks: [
        path.join(homedir(), '.local', 'bin', 'fdo'),
        path.join(homedir(), 'bin', 'fdo')
      ]
    };
  } else if (osType === 'win32') {
    return {
      primary: path.join(homedir(), 'AppData', 'Local', 'FDO', 'bin', 'fdo.cmd'),
      fallbacks: []
    };
  }
}
```

### Rationale

**Path Module Benefits**:
- Handles platform-specific separators (`/` vs `\`)
- Normalizes paths automatically
- Resolves relative paths correctly
- Handles Windows drive letters

**Special Character Handling**:
- Spaces: Use quotes in wrapper scripts (`"${path}"` in bash, `"%path%"` in batch)
- Unicode: UTF-8 encoding for scripts, BOM for Windows batch files if needed
- Parentheses: Properly quote paths like `FDO (FlexDevOps).app`

**Platform Detection**:
- Use `os.platform()` not `process.platform` (more reliable)
- Check for exact strings: `'darwin'`, `'win32'`, `'linux'`
- No need to check for other platforms (Constitution: macOS, Windows, Linux only)

### Alternatives Considered

- **String concatenation**:
  - Rejected: Error-prone with separators
  - Rejected: Doesn't handle edge cases

- **Third-party path libraries**:
  - Rejected: Node.js path module sufficient
  - Rejected: Adds unnecessary dependency

### Sources

- Node.js path module documentation
- Node.js os module documentation
- Cross-platform path handling best practices

---

## Summary of Research Findings

All "NEEDS CLARIFICATION" items from technical context have been resolved:

| Item | Resolution |
|------|-----------|
| Path Detection | Electron `process.execPath` primary, `app.getAppPath()` fallback |
| Platform Patterns | Documented primary + fallback paths for each platform |
| PATH Updates | Unix: install to existing PATH dirs; Windows: modify user PATH via PowerShell |
| Permissions | Use existing `runWithSudo` utility with permission checks first |
| Idempotent Operations | Check file existence before write, skip if exists |
| Logging Strategy | Info for major steps, debug for details (electron-log) |
| Dev Environment | Multi-signal detection (NODE_ENV, execPath, isPackaged) |
| Path Handling | Node.js path module with proper quoting in wrapper scripts |

**Ready for Phase 1**: Design artifacts (data model, contracts, quickstart updates)

