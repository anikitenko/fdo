# Data Model: Dynamic CLI Path Resolution

**Feature**: `004-dynamic-cli-paths`  
**Status**: Design  
**Updated**: 2025-10-28 (Post-Research)

## Key Entities

### 1. Application Installation

Represents the location where FDO is actually installed.

**Attributes**:
- **Path** (string, absolute): The full path to the FDO application
- **Executable Name** (string): Platform-specific executable name
- **Installation Type** (enum): `system-wide` | `user-level` | `portable`
- **Detection Method** (string): How the path was determined (e.g., "app.getAppPath()", "registry", "environment variable")

**Relationships**:
- Has one CLI Installation Target

---

### 2. CLI Installation Target

Represents the location where the CLI wrapper will be installed.

**Attributes**:
- **Primary Path** (string, absolute): Platform-appropriate default location
- **Fallback Paths** (array of strings): Alternative locations if primary fails
- **Write Permissions** (boolean): Whether the target location is writable
- **In System PATH** (boolean): Whether the location is in the system PATH

**Relationships**:
- Belongs to one Application Installation
- Has many Path Validation Results

---

### 3. Path Validation Result

Represents the outcome of attempting to use a specific path.

**Attributes**:
- **Path** (string, absolute): The path being validated
- **Exists** (boolean): Whether the path exists on the filesystem
- **Writable** (boolean): Whether the current user can write to the path
- **In PATH** (boolean): Whether the path is in the system PATH
- **Error Message** (string, optional): If validation failed, why it failed
- **Validation Timestamp** (datetime): When the validation occurred

**Relationships**:
- Belongs to one CLI Installation Target

---

## Platform-Specific Variations

### macOS
- **Primary Path**: `/usr/local/bin/fdo`
- **Fallback Paths**: `~/bin/fdo`, `~/.local/bin/fdo`
- **Detection Method**: `app.getAppPath()` for application bundle path

### Windows
- **Primary Path**: `%USERPROFILE%\AppData\Local\FDO\bin\fdo.cmd`
- **Fallback Paths**: Current directory if AppData not writable
- **Detection Method**: `process.execPath`, Windows Registry, environment variables

### Linux
- **Primary Path**: `/usr/local/bin/fdo`
- **Fallback Paths**: `~/.local/bin/fdo`, `~/bin/fdo`
- **Detection Method**: `app.getAppPath()`, `which` command, symlink resolution

---

## State Transitions

### CLI Installation States
1. **Not Installed** → User requests installation
2. **Detecting Paths** → Validating application and target paths
3. **Path Validated** → Paths are confirmed writable
4. **Installing** → Creating CLI wrapper
5. **Installed** → CLI is functional
6. **Installation Failed** → Error occurred (with detailed message)

### CLI Uninstallation States
1. **Installed** → User requests uninstallation
2. **Locating CLI** → Searching for CLI in known locations
3. **CLI Located** → Found CLI installation
4. **Uninstalling** → Removing CLI wrapper
5. **Not Installed** → CLI successfully removed
6. **Uninstallation Failed** → Error occurred (CLI not found or not removable)

---

## Data Flow

1. **Installation Request**
   - User triggers CLI installation
   - System detects FDO application path using runtime APIs
   - System validates detected path (exists, executable)

2. **Target Selection**
   - System determines primary CLI installation path based on platform
   - System checks write permissions for primary path
   - If primary not writable, iterate through fallback paths
   - Select first writable path in system PATH (preferred) or first writable path

3. **Wrapper Creation**
   - Generate platform-specific wrapper script with detected application path
   - Write wrapper to selected target path
   - Set appropriate permissions (executable for Unix-like systems)
   - Update PATH environment variable if necessary

4. **Validation**
   - Attempt to execute `fdo --version` (or similar)
   - Confirm CLI responds correctly
   - Report success or failure with details

---

## Example Data Instances

### macOS Custom Installation
```
Application Installation:
  Path: "/Users/john/Applications/FDO.app/Contents/MacOS/FDO (FlexDevOPs)"
  Executable Name: "FDO (FlexDevOPs)"
  Installation Type: user-level
  Detection Method: "app.getAppPath()"

CLI Installation Target:
  Primary Path: "/usr/local/bin/fdo"
  Fallback Paths: ["/Users/john/bin/fdo", "/Users/john/.local/bin/fdo"]
  Write Permissions: false (for primary)
  In System PATH: true (for primary)

Path Validation Result (Primary):
  Path: "/usr/local/bin/fdo"
  Exists: true
  Writable: false
  In PATH: true
  Error Message: "Permission denied: /usr/local/bin requires admin access"

Path Validation Result (Fallback 1):
  Path: "/Users/john/bin/fdo"
  Exists: true
  Writable: true
  In PATH: true
  Error Message: null
  → Selected for installation
```

### Windows Default Installation
```
Application Installation:
  Path: "C:\\Program Files\\FDO\\FDO.exe"
  Executable Name: "FDO.exe"
  Installation Type: system-wide
  Detection Method: "process.execPath"

CLI Installation Target:
  Primary Path: "C:\\Users\\jane\\AppData\\Local\\FDO\\bin\\fdo.cmd"
  Fallback Paths: []
  Write Permissions: true
  In System PATH: false

Path Validation Result:
  Path: "C:\\Users\\jane\\AppData\\Local\\FDO\\bin\\fdo.cmd"
  Exists: false (will be created)
  Writable: true
  In PATH: false (will be added)
  Error Message: null
  → Selected for installation
```

---

## Notes

- This is a conceptual data model for understanding the feature. Actual implementation may use different data structures.
- Path validation should be performed atomically to avoid race conditions
- All paths should be normalized to absolute paths to avoid ambiguity
- Platform-specific path separators and conventions must be respected

