# Quick Start: Dynamic CLI Path Resolution

**Feature**: `004-dynamic-cli-paths`  
**Status**: Implementation Ready  
**Updated**: 2025-10-28

## Overview

This feature removes hardcoded paths from the FDO CLI installer, enabling it to work correctly regardless of where the FDO application is installed. The CLI installer now dynamically detects the application's actual location using Electron runtime APIs and creates appropriate wrappers for macOS, Windows, and Linux.

## Current Problem

The existing CLI installer (`src/utils/installFDOCLI.js`) uses hardcoded paths:
- macOS: `/Applications/FDO (FlexDevOPs).app/...`
- Windows: `C:\Program Files\FDO\FDO.exe`
- Linux: `/opt/fdo/FDO`

These fail when users install FDO to custom locations, portable drives, or development environments.

## What This Feature Delivers

1. **Dynamic path detection** - Automatically finds where FDO is installed
2. **Flexible installation locations** - Works with custom directories
3. **Smart fallbacks** - Uses alternative paths when defaults aren't writable
4. **Better error messages** - Shows what paths were tried and why they failed
5. **Clean uninstallation** - Finds and removes CLI regardless of location

## Key User Stories

- **P1**: Install CLI from custom application location
- **P2**: Install CLI with non-standard system paths
- **P2**: Uninstall CLI from any location
- **P3**: Portable FDO installation support

## Next Steps

1. **Review Specification**: Read [spec.md](spec.md) for complete requirements
2. **Validate Requirements**: Check [checklists/requirements.md](checklists/requirements.md)
3. **Planning**: Use `/speckit.plan` to create implementation plan
4. **Implementation**: Follow the generated plan

## Testing Approach

Test across scenarios:
- Default installation paths (backward compatibility)
- Custom installation directories
- Paths with spaces and special characters
- Limited permission environments
- Multiple FDO installations

## Success Metrics

- 100% success rate for non-default installations
- Installation completes in under 30 seconds
- Zero hardcoded path failures reported by users

---

## Implementation Approach

### Path Detection Strategy

**Use Electron APIs** (not hardcoded paths):
```javascript
const appPath = process.execPath; // e.g., "/Applications/FDO.app/Contents/MacOS/FDO"
```

**Fallback chain** for robust detection:
1. `process.execPath` - actual executable path
2. `app.getAppPath()` - application source directory
3. Validate: check file exists and is executable

### Installation Paths

**macOS**:
- Primary: `/usr/local/bin/fdo` (system-wide)
- Fallback 1: `~/.local/bin/fdo` (XDG standard)
- Fallback 2: `~/bin/fdo` (traditional)

**Windows**:
- Primary: `%USERPROFILE%\AppData\Local\FDO\bin\fdo.cmd`
- Updates user PATH via PowerShell

**Linux**:
- Primary: `/usr/local/bin/fdo` (system-wide)
- Fallback 1: `~/.local/bin/fdo` (XDG standard)
- Fallback 2: `~/bin/fdo` (traditional)

### Key Behaviors

**Idempotent Installation**:
```javascript
if (fs.existsSync(targetPath)) {
  return { success: true, skipped: true, path: targetPath };
}
```

**Permission Handling**:
- Check write permissions before attempting
- Use user-level paths when possible (no sudo needed)
- Request sudo only when necessary (via existing `runWithSudo`)

**Error Handling**:
- Leave partial installations intact (don't auto-rollback)
- Provide detailed error messages with recovery instructions
- Log all attempts for troubleshooting

**Development Support**:
- Detect dev environment (NODE_ENV, app.isPackaged, execPath)
- Allow installation with warning log
- Enables testing CLI during development

### Logging

**Info Level** (always logged):
- Installation start/complete
- Path detection results
- Fallback attempts
- Final outcome

**Debug Level** (when enabled):
- Permission check details
- Wrapper script content
- Environment detection
- All validation steps

---

## Quick Reference

### Current Implementation Issues

```javascript
// OLD: Hardcoded path (fails for custom installs)
const appPath = "/Applications/FDO (FlexDevOPs).app/...";
```

### New Implementation

```javascript
// NEW: Dynamic detection
const appPath = process.execPath;
// Returns actual installation location
```

### Testing Checklist

- [ ] Default installation path (backward compatibility)
- [ ] Custom installation directory
- [ ] Path with spaces and special characters
- [ ] Development environment
- [ ] Limited permissions (user-level fallback)
- [ ] Multiple FDO installations (idempotent)
- [ ] Retry after failure (idempotent recovery)

---

## Files Modified

**Primary**: `src/utils/installFDOCLI.js`
- Remove hardcoded paths
- Add dynamic detection
- Implement fallback logic
- Add idempotent checks
- Improve error messages

**Supporting**: None required (uses existing utilities)

---

## Dependencies

- **Electron APIs**: `app.getAppPath()`, `process.execPath`, `app.isPackaged`
- **Node.js**: `fs`, `path`, `os`, `child_process`
- **Existing**: `runWithSudo` utility for elevation
- **Logging**: `electron-log` (already in project)

