import {homedir, platform} from "os";
import {existsSync, mkdirSync, unlinkSync, writeFileSync} from "fs";
import {execSync} from "child_process";
import path from "path";

import {app} from "electron";
import {runWithSudo} from "./runWithSudo";
import log from "electron-log/main";

// Log prefix for CLI installation operations
const LOG_PREFIX = "[CLI Install]";

/**
 * Gets the correct path to the app icon for sudo dialogs
 * @returns {string} Path to the icon file
 */
function getIconPath() {
    // Pattern from main.js and ipc/system.js for accessing bundled assets
    if (app.isPackaged) {
        return path.join(process.resourcesPath, 'app.asar', 'dist', 'renderer', 'assets', 'icons', 'fdo_icon.icns');
    } else {
        return path.join(__dirname, '..', '..', 'dist', 'renderer', 'assets', 'icons', 'fdo_icon.icns');
    }
}

/**
 * Detects if the application is running in development mode
 * @returns {boolean} True if running in development, false if packaged
 */
function isDevelopmentEnvironment() {
    const execPath = process.execPath.toLowerCase();
    const appPath = app.getAppPath();
    
    // Debug logging
    log.debug(`${LOG_PREFIX} Dev detection - NODE_ENV: ${process.env.NODE_ENV}`);
    log.debug(`${LOG_PREFIX} Dev detection - execPath: ${process.execPath}`);
    log.debug(`${LOG_PREFIX} Dev detection - appPath: ${appPath}`);
    log.debug(`${LOG_PREFIX} Dev detection - app.isPackaged: ${app.isPackaged}`);
    
    // Signal 1: NODE_ENV environment variable
    if (process.env.NODE_ENV === 'development') {
        log.debug(`${LOG_PREFIX} Dev detection: NODE_ENV = development`);
        return true;
    }
    
    // Signal 2: Electron executable path (dev uses electron binary)
    if (execPath.includes('electron')) {
        log.debug(`${LOG_PREFIX} Dev detection: execPath contains 'electron'`);
        return true;
    }
    
    // Signal 3: App not packaged (Electron API)
    if (!app.isPackaged) {
        log.debug(`${LOG_PREFIX} Dev detection: app.isPackaged = false`);
        return true;
    }
    
    // Signal 4: Check if app path contains webpack build artifacts
    if (appPath.includes('.webpack') || appPath.includes('/dist/')) {
        log.debug(`${LOG_PREFIX} Dev detection: appPath contains webpack/dist`);
        return true;
    }
    
    // Signal 5: Check if we're in a dev directory structure
    // Dev structure: /path/to/fdo/release/... (release folder in project)
    // Prod structure: /Applications/FDO.app/...
    if (execPath.includes('/dev/') && !execPath.includes('/Applications/')) {
        log.debug(`${LOG_PREFIX} Dev detection: execPath in /dev/ directory`);
        return true;
    }
    
    log.debug(`${LOG_PREFIX} Dev detection: No dev signals found, assuming production`);
    return false;
}

/**
 * Checks if a path is writable by the current user
 * @param {string} targetPath - Path to check
 * @returns {boolean} True if writable, false otherwise
 */
function isPathWritable(targetPath) {
    try {
        const fs = require('fs');
        const parentDir = path.dirname(targetPath);
        
        // Check if parent directory exists
        if (!existsSync(parentDir)) {
            return false;
        }
        
        // Check write permission on parent directory
        fs.accessSync(parentDir, fs.constants.W_OK);
        return true;
    } catch (err) {
        return false;
    }
}

/**
 * Detects the actual FDO application installation path
 * @returns {{electronPath: string, appPath: string, method: string, isDevEnvironment: boolean}}
 */
function detectApplicationPath() {
    const isDevEnvironment = isDevelopmentEnvironment();
    const platform = process.platform;
    const appPath = app.getAppPath();
    
    // ALWAYS use the currently running process
    // This ensures the CLI points to wherever FDO is actually running from
    const electronPath = process.execPath;
    
    log.debug(`${LOG_PREFIX} Path detection - electronPath: ${electronPath}`);
    log.debug(`${LOG_PREFIX} Path detection - appPath: ${appPath}`);
    log.debug(`${LOG_PREFIX} Path detection - isDevEnvironment: ${isDevEnvironment}`);
    
    // In development, we need to invoke: electron <app-path> [args]
    // In production, we invoke: <executable> [args]
    
    if (isDevEnvironment) {
        // Development: Return both electron and app paths
        return {
            electronPath,
            appPath,
            method: 'dev: electron + appPath',
            isDevEnvironment
        };
    }
    
    // Production: Use only the packaged executable
    return {
        electronPath,
        appPath: null,
        method: 'production: packaged executable',
        isDevEnvironment
    };
}

/**
 * Gets platform-specific CLI installation paths
 * @param {string} platform - Platform type (darwin, win32, linux)
 * @returns {{primary: string, fallbacks: string[]}}
 */
function getPlatformPaths(platform) {
    const home = homedir();
    
    if (platform === 'darwin' || platform === 'linux') {
        return {
            primary: '/usr/local/bin/fdo',
            fallbacks: [
                path.join(home, '.local', 'bin', 'fdo'),
                path.join(home, 'bin', 'fdo')
            ]
        };
    } else if (platform === 'win32') {
        return {
            primary: path.join(home, 'AppData', 'Local', 'FDO', 'bin', 'fdo.cmd'),
            fallbacks: []
        };
    }
    
    return { primary: null, fallbacks: [] };
}

/**
 * Creates the appropriate wrapper script content for the platform
 * @param {string} electronPath - Path to the electron executable (or packaged app executable)
 * @param {string|null} appPath - Path to the app code (only in dev mode)
 * @param {string} platform - Platform type (darwin, win32, linux)
 * @param {boolean} isDevEnvironment - Whether running in development mode
 * @returns {string} Wrapper script content
 */
function createWrapperScript(electronPath, appPath, platform, isDevEnvironment) {
    if (platform === 'darwin' || platform === 'linux') {
        // Use #!/bin/sh for Linux (POSIX-compliant), #!/bin/bash for macOS
        const shebang = platform === 'linux' ? '#!/bin/sh' : '#!/bin/bash';
        
        if (isDevEnvironment && appPath) {
            // Development: exec electron app-path "$@" (or --help if no args)
            return `${shebang}
# If no arguments provided, show help
if [ $# -eq 0 ]; then
  exec "${electronPath}" "${appPath}" --help
else
  exec "${electronPath}" "${appPath}" "$@"
fi
`;
        } else {
            // Production: exec packaged-executable "$@" (or --help if no args)
            return `${shebang}
# If no arguments provided, show help
if [ $# -eq 0 ]; then
  exec "${electronPath}" --help
else
  exec "${electronPath}" "$@"
fi
`;
        }
    } else if (platform === 'win32') {
        if (isDevEnvironment && appPath) {
            // Development: call electron app-path %* (or --help if no args)
            return `@echo off\r\nif "%~1"=="" (\r\n  "${electronPath}" "${appPath}" --help\r\n) else (\r\n  "${electronPath}" "${appPath}" %*\r\n)\r\n`;
        } else {
            // Production: call packaged-executable %* (or --help if no args)
            return `@echo off\r\nif "%~1"=="" (\r\n  "${electronPath}" --help\r\n) else (\r\n  "${electronPath}" %*\r\n)\r\n`;
        }
    }
    
    return '';
}

/**
 * Selects the best CLI installation path based on write permissions
 * @param {string} platform - Platform type (darwin, win32, linux)
 * @param {{primary: string, fallbacks: string[]}} paths - Available paths
 * @returns {{path: string, needsSudo: boolean, reason: string}}
 */
function selectInstallPath(platform, paths) {
    // Try primary path first
    if (isPathWritable(paths.primary)) {
        log.debug(`${LOG_PREFIX} Primary path is writable: ${paths.primary}`);
        return {
            path: paths.primary,
            needsSudo: false,
            reason: 'Primary path is writable'
        };
    }
    
    log.info(`${LOG_PREFIX} Primary path ${paths.primary} not writable, trying fallbacks`);
    
    // Try fallbacks
    for (const fallback of paths.fallbacks) {
        log.debug(`${LOG_PREFIX} Checking fallback: ${fallback}`);
        if (isPathWritable(fallback)) {
            log.info(`${LOG_PREFIX} Using fallback path: ${fallback}`);
            return {
                path: fallback,
                needsSudo: false,
                reason: 'Primary path not writable, selected first writable fallback'
            };
        }
    }
    
    // All failed, use primary with sudo (for Unix-like systems)
    if (platform === 'darwin' || platform === 'linux') {
        log.info(`${LOG_PREFIX} No writable paths found, will use sudo for primary path`);
        return {
            path: paths.primary,
            needsSudo: true,
            reason: 'No writable paths found, requires elevated permissions'
        };
    }
    
    // Windows: If primary not writable and no fallbacks, it's an error
    return {
        path: paths.primary,
        needsSudo: false,
        reason: 'No writable paths available'
    };
}

export async function installFDOCLI() {
    const osType = platform();
    
    // T008-T009: Dynamic path detection
    log.info(`${LOG_PREFIX} Starting installation for ${osType}`);
    
    const appInfo = detectApplicationPath();
    const electronPath = appInfo.electronPath;
    const appPath = appInfo.appPath; // null in production, set in development
    
    log.info(`${LOG_PREFIX} Electron executable: ${electronPath}`);
    if (appPath) {
        log.info(`${LOG_PREFIX} App path: ${appPath}`);
    }
    log.debug(`${LOG_PREFIX} Detection method: ${appInfo.method}`);
    log.debug(`${LOG_PREFIX} Development environment: ${appInfo.isDevEnvironment}`);
    
    // T018: Development environment warning
    if (appInfo.isDevEnvironment) {
        log.warn(`${LOG_PREFIX} Development environment detected, CLI will point to dev build`);
    }
    
    // T030: Get platform-specific paths and select best one
    const paths = getPlatformPaths(osType);
    
    if (!paths.primary) {
        const errorMsg = `Unsupported platform: ${osType}. Please install manually.`;
        log.error(`${LOG_PREFIX} ${errorMsg}`);
        return {success: false, error: errorMsg};
    }
    
    // T031-T034: Check permissions and select install path with fallbacks
    const selectedPath = selectInstallPath(osType, paths);
    const target = selectedPath.path;
    const needsSudo = selectedPath.needsSudo;
    
    log.info(`${LOG_PREFIX} Selected installation path: ${target}`);
    log.debug(`${LOG_PREFIX} Selection reason: ${selectedPath.reason}`);
    log.debug(`${LOG_PREFIX} Requires sudo: ${needsSudo}`);
    
    // T010: Idempotent check - skip if file already exists
    if (existsSync(target)) {
        log.info(`${LOG_PREFIX} CLI already exists at ${target}, skipping installation`);
        return {success: true, skipped: true, path: target};
    }
    
    // T036: Create parent directory if needed
    const parentDir = path.dirname(target);
    if (!existsSync(parentDir)) {
        try {
            mkdirSync(parentDir, {recursive: true});
            log.info(`${LOG_PREFIX} Created directory: ${parentDir}`);
        } catch (err) {
            const errorMsg = `Failed to create directory ${parentDir}: ${err.message}

Recovery: Create the directory manually with: mkdir -p ${parentDir}`;
            log.error(`${LOG_PREFIX} ${errorMsg}`);
            return {success: false, error: errorMsg};
        }
    }
    
    // T013, T015, T017: Create platform-specific wrapper script
    const wrapperScript = createWrapperScript(electronPath, appPath, osType, appInfo.isDevEnvironment);
    
    if (osType === "darwin" || osType === "linux") {
        try {
            // Write wrapper script directly if no sudo needed, otherwise use install command with sudo
            if (!needsSudo) {
                // User-writable path - write directly without sudo
                log.debug(`${LOG_PREFIX} Writing directly to user-writable path: ${target}`);
                writeFileSync(target, wrapperScript, {mode: 0o755});
                log.info(`${LOG_PREFIX} Successfully installed to ${target}`);
                return {success: true, path: target, developmentMode: appInfo.isDevEnvironment};
            } else {
                // System path - requires sudo
                const tmpWrapperPath = path.join(app.getPath("temp"), "fdo-wrapper.sh");
                writeFileSync(tmpWrapperPath, wrapperScript, {mode: 0o755});
                log.debug(`${LOG_PREFIX} Created temporary wrapper at ${tmpWrapperPath}`);
                
                const command = `install -m 755 "${tmpWrapperPath}" "${target}"`;
                const result = await runWithSudo(command, {
                    name: "FDO",
                    icns: getIconPath(),
                    confirmMessage: `FDO CLI will be installed to ${target}`,
                });
                
                if (result && result === "skip") {
                    log.info(`${LOG_PREFIX} Installation cancelled by user`);
                    return {success: false, error: "skip"};
                }
                
                log.info(`${LOG_PREFIX} Successfully installed to ${target}`);
                return {success: true, path: target, developmentMode: appInfo.isDevEnvironment};
            }
            
        } catch (err) {
            // T019, T035: Detailed error messages with all attempted paths
            const attemptedPaths = [paths.primary, ...paths.fallbacks].join(', ');
            const errorMsg = `Failed to install FDO CLI to ${target}: ${err.message}

Attempted paths: ${attemptedPaths}

Recovery: Run installation again and approve the permission dialog, or install to user directory by creating ~/.local/bin first.`;
            log.error(`${LOG_PREFIX} ${errorMsg}`);
            return {success: false, error: errorMsg};
        }
        
    } else if (osType === "win32") {
        const installDir = path.dirname(target);
        
        try {
            // Create parent directory if needed
            if (!existsSync(installDir)) {
                mkdirSync(installDir, {recursive: true});
                log.debug(`${LOG_PREFIX} Created directory: ${installDir}`);
            }
            
            // Write wrapper script
            writeFileSync(target, wrapperScript, {encoding: "utf8"});
            log.debug(`${LOG_PREFIX} Created wrapper script at ${target}`);
            
            // Add to PATH if not already there
            try {
                const currentPath = execSync(
                    `[Environment]::GetEnvironmentVariable("Path", "User")`,
                    {encoding: "utf8", shell: "powershell.exe"}
                ).trim();
                
                if (!currentPath.includes(installDir)) {
                    const newPath = currentPath + ';' + installDir;
                    execSync(
                        `[Environment]::SetEnvironmentVariable("Path", "${newPath}", "User")`,
                        {shell: "powershell.exe"}
                    );
                    log.info(`${LOG_PREFIX} Added ${installDir} to user PATH`);
                } else {
                    log.debug(`${LOG_PREFIX} ${installDir} already in PATH`);
                }
            } catch (pathErr) {
                log.warn(`${LOG_PREFIX} Failed to update PATH: ${pathErr.message}`);
                // Don't fail installation if PATH update fails
            }
            
            log.info(`${LOG_PREFIX} Successfully installed to ${target}`);
            return {success: true, path: target, developmentMode: appInfo.isDevEnvironment};
            
        } catch (err) {
            // T019, T035: Detailed error messages with recovery instructions
            const attemptedPaths = [paths.primary, ...paths.fallbacks].filter(p => p).join(', ');
            const errorMsg = `Failed to install FDO CLI to ${target}: ${err.message}

Attempted paths: ${attemptedPaths}

Recovery: Ensure you have write permissions to ${installDir}. You may need to run FDO as administrator or create the directory manually.`;
            log.error(`${LOG_PREFIX} ${errorMsg}`);
            return {success: false, error: errorMsg};
        }
    }
    
    // Shouldn't reach here, but just in case
    return {success: false, error: `Unsupported platform: ${osType}`};
}

export async function removeFDOCLI() {
    const osType = platform();
    const binName = "fdo";
    
    log.info(`${LOG_PREFIX} Starting uninstallation for ${osType}`);
    
    if (osType === "darwin" || osType === "linux") {
        // T045-T047: Check all possible CLI paths (current + legacy + fallbacks)
        const paths = getPlatformPaths(osType);
        const allPossiblePaths = [
            paths.primary,
            ...paths.fallbacks,
            // Legacy hardcoded paths
            `/usr/local/bin/${binName}`,
            path.join(homedir(), '.local', 'bin', binName),
            path.join(homedir(), 'bin', binName),
            '/opt/fdo/FDO'  // Legacy Linux path
        ];
        
        // Remove duplicates
        const uniquePaths = [...new Set(allPossiblePaths)];
        
        // Find which path actually has the CLI
        let foundPath = null;
        for (const checkPath of uniquePaths) {
            log.debug(`${LOG_PREFIX} Checking for CLI at: ${checkPath}`);
            if (existsSync(checkPath)) {
                foundPath = checkPath;
                log.info(`${LOG_PREFIX} Found CLI at: ${checkPath}`);
                break;
            }
        }
        
        // T048: Idempotent - if not found, report success
        if (!foundPath) {
            log.info(`${LOG_PREFIX} No CLI installation found (already uninstalled)`);
            return {success: true, notFound: true};
        }
        
        // T049: Info-level logging
        log.info(`${LOG_PREFIX} Removing CLI from: ${foundPath}`);
        
        try {
            // Check if we need sudo based on write permissions
            const needsSudoForRemoval = !isPathWritable(foundPath);
            
            if (!needsSudoForRemoval) {
                // User-writable path - remove directly without sudo
                log.debug(`${LOG_PREFIX} Removing directly from user-writable path`);
                unlinkSync(foundPath);
                log.info(`${LOG_PREFIX} Successfully removed CLI from ${foundPath}`);
                return {success: true, path: foundPath};
            } else {
                // System path - requires sudo
                log.debug(`${LOG_PREFIX} Removing from system path, requires sudo`);
                const command = `rm -f "${foundPath}"`;
                const result = await runWithSudo(command, {
                    name: "FDO",
                    icns: getIconPath(),
                    confirmMessage: `FDO CLI will be removed from ${foundPath}`,
                });
                
                if (result && result === "skip") {
                    log.info(`${LOG_PREFIX} Uninstallation cancelled by user`);
                    return {success: false, error: "skip"};
                }
                
                log.info(`${LOG_PREFIX} Successfully removed CLI from ${foundPath}`);
                return {success: true, path: foundPath};
            }
            
        } catch (err) {
            // T050: Clear error messages
            const errorMsg = `Failed to remove CLI from ${foundPath}: ${err.message}

Recovery: Remove the file manually with: ${isPathWritable(foundPath) ? `rm ${foundPath}` : `sudo rm ${foundPath}`}`;
            log.error(`${LOG_PREFIX} ${errorMsg}`);
            return {success: false, error: errorMsg, path: foundPath};
        }
        
    } else if (osType === "win32") {
        // T045-T047: Check current and legacy paths
        const paths = getPlatformPaths(osType);
        const allPossiblePaths = [
            paths.primary,
            // Legacy hardcoded path
            path.join(homedir(), "AppData", "Local", "FDO", "bin", `${binName}.cmd`),
            `C:\\Program Files\\FDO\\${binName}.cmd`
        ];
        
        const uniquePaths = [...new Set(allPossiblePaths)];
        
        let foundPath = null;
        for (const checkPath of uniquePaths) {
            log.debug(`${LOG_PREFIX} Checking for CLI at: ${checkPath}`);
            if (existsSync(checkPath)) {
                foundPath = checkPath;
                log.info(`${LOG_PREFIX} Found CLI at: ${checkPath}`);
                break;
            }
        }
        
        // T048: Idempotent - if not found, report success
        if (!foundPath) {
            log.info(`${LOG_PREFIX} No CLI installation found (already uninstalled)`);
            return {success: true, notFound: true};
        }
        
        const installDir = path.dirname(foundPath);
        
        try {
            // T049: Info-level logging
            log.info(`${LOG_PREFIX} Removing CLI from: ${foundPath}`);
            unlinkSync(foundPath);
            log.debug(`${LOG_PREFIX} Deleted file: ${foundPath}`);
            
            // T051: Remove from PATH if present
            try {
                const currentPath = execSync(
                    `[Environment]::GetEnvironmentVariable("Path", "User")`,
                    {encoding: "utf8", shell: "powershell.exe"}
                ).trim();
                
                if (currentPath.includes(installDir)) {
                    const newPath = currentPath
                        .split(";")
                        .filter((p) => p !== installDir)
                        .join(";");
                    
                    execSync(
                        `[Environment]::SetEnvironmentVariable("Path", "${newPath}", "User")`,
                        {shell: "powershell.exe"}
                    );
                    log.info(`${LOG_PREFIX} Removed ${installDir} from user PATH`);
                } else {
                    log.debug(`${LOG_PREFIX} ${installDir} not in PATH`);
                }
            } catch (pathErr) {
                log.warn(`${LOG_PREFIX} Failed to update PATH: ${pathErr.message}`);
                // Don't fail uninstall if PATH update fails
            }
            
            log.info(`${LOG_PREFIX} Successfully removed CLI from ${foundPath}`);
            return {success: true, path: foundPath};
            
        } catch (err) {
            // T050: Clear error messages
            const errorMsg = `Failed to remove CLI from ${foundPath}: ${err.message}

Recovery: Delete the file manually or run FDO as administrator.`;
            log.error(`${LOG_PREFIX} ${errorMsg}`);
            return {success: false, error: errorMsg, path: foundPath};
        }
        
    } else {
        const errorMsg = `Unsupported platform: ${osType}. Please remove manually.`;
        log.error(`${LOG_PREFIX} ${errorMsg}`);
        return {success: false, error: errorMsg};
    }
}
