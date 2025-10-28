# CLI Installation API Contract

**Feature**: `004-dynamic-cli-paths`  
**Version**: 1.0.0  
**Updated**: 2025-10-28

## Overview

This contract defines the function signatures and data structures for the dynamic CLI installation system. These functions are called from the main Electron process and handle CLI wrapper creation, installation, and removal.

---

## Public API Functions

### `installFDOCLI()`

Installs the FDO CLI wrapper to the system, using dynamic path detection and platform-appropriate locations.

**Signature**:
```javascript
async function installFDOCLI(): Promise<InstallResult>
```

**Parameters**: None

**Returns**: `Promise<InstallResult>`

```typescript
interface InstallResult {
  success: boolean;           // Whether installation succeeded
  skipped?: boolean;          // True if CLI already exists (idempotent)
  path?: string;             // Path where CLI was installed/found
  error?: string;            // Error message if failed
  needsSudo?: boolean;       // Whether sudo was required
  developmentMode?: boolean; // True if installed from dev environment
}
```

**Behavior**:
1. Detects current platform (macOS, Windows, Linux)
2. Detects FDO application path using Electron APIs
3. Validates application path exists and is executable
4. Determines appropriate CLI installation path (primary + fallbacks)
5. Checks if CLI already exists (idempotent check)
6. If exists: Returns success with `skipped: true`
7. If not exists: Creates wrapper script and installs to selected path
8. Updates PATH environment variable if needed (Windows only)
9. Returns success or detailed error

**Success Cases**:
```javascript
// New installation
{ success: true, path: "/usr/local/bin/fdo", needsSudo: true }

// Idempotent skip
{ success: true, skipped: true, path: "/usr/local/bin/fdo" }

// Development environment
{ 
  success: true, 
  path: "~/.local/bin/fdo", 
  developmentMode: true 
}

// Fallback location
{ success: true, path: "~/.local/bin/fdo", needsSudo: false }
```

**Error Cases**:
```javascript
// Application path not found
{
  success: false,
  error: "Failed to detect FDO application path: <details>"
}

// All paths not writable
{
  success: false,
  error: "No writable installation path found. Tried: /usr/local/bin/fdo, ~/.local/bin/fdo, ~/bin/fdo"
}

// Sudo cancelled by user
{
  success: false,
  error: "skip"  // Special value indicating user cancellation
}

// Write failure
{
  success: false,
  error: "Failed to write CLI wrapper to /usr/local/bin/fdo: EACCES: permission denied"
}
```

**Side Effects**:
- Creates wrapper script file at target path
- Sets executable permissions (755 on Unix-like systems)
- May create parent directory if doesn't exist (recursive)
- May update user PATH environment variable (Windows only)
- Logs installation progress at info level
- Logs detailed attempts at debug level
- May show sudo permission dialog (macOS/Linux)

**Exceptions**:
- Does not throw exceptions; all errors returned in result object
- Internal errors caught and converted to error messages

---

### `removeFDOCLI()`

Removes the FDO CLI wrapper from the system, searching multiple possible locations.

**Signature**:
```javascript
async function removeFDOCLI(): Promise<RemoveResult>
```

**Parameters**: None

**Returns**: `Promise<RemoveResult>`

```typescript
interface RemoveResult {
  success: boolean;       // Whether removal succeeded
  path?: string;         // Path where CLI was found and removed
  error?: string;        // Error message if failed
  notFound?: boolean;    // True if no CLI installation found
}
```

**Behavior**:
1. Detects current platform
2. Checks all possible CLI installation paths (primary + fallbacks + legacy)
3. If found: Removes CLI file
4. If system path (/usr/local/bin): May require sudo
5. If user path: Removes directly
6. Optionally removes directory from PATH (Windows only)
7. Returns success or error

**Success Cases**:
```javascript
// CLI removed
{ success: true, path: "/usr/local/bin/fdo" }

// CLI not found (idempotent)
{ success: true, notFound: true }
```

**Error Cases**:
```javascript
// CLI found but couldn't remove
{
  success: false,
  error: "Failed to remove CLI from /usr/local/bin/fdo: EACCES: permission denied",
  path: "/usr/local/bin/fdo"
}

// Sudo cancelled
{
  success: false,
  error: "skip"
}
```

**Side Effects**:
- Deletes CLI wrapper file
- May update user PATH environment variable (Windows only)
- Logs removal progress at info level
- May show sudo permission dialog

---

## Internal Helper Functions

### `detectApplicationPath()`

Detects where the FDO application is actually installed.

**Signature**:
```javascript
function detectApplicationPath(): ApplicationPath
```

**Returns**:
```typescript
interface ApplicationPath {
  path: string;              // Full path to application executable
  method: string;            // Detection method used
  isDevEnvironment: boolean; // Whether running from development
}
```

**Example**:
```javascript
{
  path: "/Applications/FDO (FlexDevOPs).app/Contents/MacOS/FDO (FlexDevOPs)",
  method: "process.execPath",
  isDevEnvironment: false
}
```

---

### `selectInstallPath(platform, paths)`

Selects the best CLI installation path based on write permissions.

**Signature**:
```javascript
function selectInstallPath(
  platform: 'darwin' | 'win32' | 'linux',
  paths: { primary: string, fallbacks: string[] }
): SelectedPath
```

**Returns**:
```typescript
interface SelectedPath {
  path: string;       // Selected installation path
  needsSudo: boolean; // Whether sudo required for this path
  reason: string;     // Why this path was selected
}
```

**Example**:
```javascript
{
  path: "~/.local/bin/fdo",
  needsSudo: false,
  reason: "Primary path not writable, selected first writable fallback"
}
```

---

### `createWrapperScript(appPath, platform)`

Generates the appropriate wrapper script content for the platform.

**Signature**:
```javascript
function createWrapperScript(
  appPath: string,
  platform: 'darwin' | 'win32' | 'linux'
): string
```

**Returns**: String containing the wrapper script content

**Example Output (macOS/Linux)**:
```bash
#!/bin/bash
exec "/Applications/FDO (FlexDevOPs).app/Contents/MacOS/FDO (FlexDevOPs)" "$@"
```

**Example Output (Windows)**:
```batch
@echo off
"C:\Program Files\FDO\FDO.exe" %*
```

---

### `isPathWritable(targetPath)`

Checks if a path is writable by the current user.

**Signature**:
```javascript
function isPathWritable(targetPath: string): boolean
```

**Returns**: `true` if the parent directory of `targetPath` is writable, `false` otherwise

**Behavior**:
- Uses `fs.accessSync()` with `fs.constants.W_OK`
- Checks parent directory (since file may not exist yet)
- Returns `false` if parent directory doesn't exist

---

### `isDevelopmentEnvironment()`

Detects if the application is running in development mode.

**Signature**:
```javascript
function isDevelopmentEnvironment(): boolean
```

**Returns**: `true` if running in development, `false` if packaged production

**Detection Signals**:
- `process.env.NODE_ENV === 'development'`
- `process.execPath` contains `'electron'`
- `app.isPackaged === false`

---

## Logging Events

### Info-Level Events

Logged to help troubleshoot installation issues:

```javascript
// Installation start
"[CLI Install] Starting installation for darwin"

// Path detection
"[CLI Install] Application detected at: <path>"

// Fallback attempts
"[CLI Install] Primary path /usr/local/bin/fdo not writable, trying fallback"

// Idempotent skip
"[CLI Install] CLI already exists at <path>, skipping installation"

// Development mode
"[CLI Install] Development environment detected, CLI will point to dev build"

// Success
"[CLI Install] Successfully installed to <path>"

// Removal
"[CLI Uninstall] Removed CLI from <path>"
```

### Debug-Level Events

Logged for detailed troubleshooting:

```javascript
// Detection details
"[CLI Install] Detection method: process.execPath"
"[CLI Install] App packaged: false"
"[CLI Install] NODE_ENV: development"

// Permission checks
"[CLI Install] Checking write permission for /usr/local/bin"
"[CLI Install] Path not writable: <error details>"

// Wrapper content
"[CLI Install] Generated wrapper script:\n<script content>"

// PATH operations
"[CLI Install] Current user PATH: <path>"
"[CLI Install] Adding to PATH: <directory>"
```

### Warning-Level Events

```javascript
// Development mode
"[CLI Install] Development environment detected, CLI will point to dev build"

// Fallback used
"[CLI Install] Using fallback path instead of primary"
```

### Error-Level Events

```javascript
// Detection failure
"[CLI Install] Failed to detect application path: <error>"

// Installation failure
"[CLI Install] Failed to install CLI to <path>: <error>"

// Permission denied
"[CLI Install] Permission denied for <path>, requires admin access"
```

---

## Error Messages

All error messages must follow this format for consistency and actionability:

### Format

```
Failed to <action> <target>: <technical reason>

Recovery: <specific steps user can take>
```

### Examples

```
Failed to install FDO CLI to /usr/local/bin/fdo: EACCES: permission denied

Recovery: Run installation again and approve the permission dialog, or install to user directory by creating ~/.local/bin first.
```

```
Failed to detect FDO application path: Application executable not found

Recovery: Ensure FDO is properly installed. If running from development, ensure NODE_ENV is set.
```

```
No writable installation path found. Tried: /usr/local/bin/fdo, ~/.local/bin/fdo, ~/bin/fdo

Recovery: Create ~/.local/bin directory with: mkdir -p ~/.local/bin
Then retry CLI installation.
```

---

## Platform-Specific Contracts

### macOS

**Primary Path**: `/usr/local/bin/fdo`  
**Fallback Paths**: `~/.local/bin/fdo`, `~/bin/fdo`  
**Wrapper Format**: Bash script with `#!/bin/bash` shebang  
**Permissions**: 755 (rwxr-xr-x)  
**Sudo Required**: For `/usr/local/bin` only

### Windows

**Primary Path**: `%USERPROFILE%\AppData\Local\FDO\bin\fdo.cmd`  
**Fallback Paths**: None  
**Wrapper Format**: Batch file with `@echo off`  
**Permissions**: Not applicable (Windows ACLs)  
**Sudo Required**: Never (user-level installation)  
**PATH Update**: Yes, via PowerShell user environment variable

### Linux

**Primary Path**: `/usr/local/bin/fdo`  
**Fallback Paths**: `~/.local/bin/fdo`, `~/bin/fdo`  
**Wrapper Format**: POSIX shell script with `#!/bin/sh` shebang  
**Permissions**: 755 (rwxr-xr-x)  
**Sudo Required**: For `/usr/local/bin` only

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2025-10-28 | Initial contract based on research findings |

---

## Notes

- All functions are asynchronous to support sudo dialogs and file I/O
- No exceptions thrown; all errors returned in result objects
- Idempotent behavior is core to the design
- Logging is structured for easy parsing and filtering
- Development environment support is first-class
- Error messages always include recovery instructions

