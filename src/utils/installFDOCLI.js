import {homedir, platform} from "os";
import {existsSync, mkdirSync, unlinkSync, writeFileSync} from "fs";
import {execSync} from "child_process";
import path from "path";

import {app} from "electron";
import {runWithSudo} from "./runWithSudo";

export async function installFDOCLI() {
    const osType = platform();
    const binName = "fdo";

    if (osType === "darwin") {
        const appPath = "/Applications/FDO (FlexDevOPs).app/Contents/MacOS/FDO (FlexDevOPs)";
        const target = `/usr/local/bin/${binName}`;
        const wrapperScript = `#!/bin/bash
exec "${appPath}" "$@"
`;
        const tmpWrapperPath = path.join(app.getPath("temp"), "fdo-wrapper.sh");
        writeFileSync(tmpWrapperPath, wrapperScript, {mode: 0o755});

        const command = `
    install -m 755 "${tmpWrapperPath}" "${target}"
  `.trim();
        try {
            const result = await runWithSudo(command, {
                    name: "FDO",
                    icns: path.join(app.getAppPath(), '.webpack', 'renderer', 'assets', "icons", "fdo_icon.icns"),
                    confirmMessage: "FDO CLI will be installed to " + target,
                },
            );
            if (result && result === "skip") {
                return {success: false, error: "skip"};
            }
            return {success: true};
        } catch (err) {
            return {success: false, error: "Failed to install fdo CLI using osascript: " + err.message};
        }

    } else if (osType === "win32") {
        const installDir = path.join(homedir(), "AppData", "Local", "FDO", "bin");
        const targetCmd = path.join(installDir, `${binName}.cmd`);
        const fdoExePath = `"C:\\Program Files\\FDO\\FDO.exe"`; // Adjust if different

        try {
            if (!existsSync(installDir)) mkdirSync(installDir, {recursive: true});

            writeFileSync(
                targetCmd,
                `@echo off\r\n${fdoExePath} %*\r\n`,
                {encoding: "utf8"}
            );

            // Add to PATH if not already there
            execSync(
                `[Environment]::SetEnvironmentVariable("Path", "$($Env:Path);${installDir}", "User")`,
                {shell: "powershell.exe"}
            );
            return {success: true};
        } catch (err) {
            return {success: false, error: "Failed to install fdo CLI on Windows: " + err.message};
        }

    } else if (osType === "linux") {
        const source = "/opt/fdo/FDO"; // Adjust as needed
        const target = `/usr/local/bin/${binName}`;

        const command = `ln -sf "${source}" "${target}"`;
        try {
            const result = await runWithSudo(command, {
                    name: "FDO",
                    icns: path.join(app.getAppPath(), '.webpack', 'renderer', 'assets', "icons", "fdo_icon.icns"),
                    confirmMessage: "FDO CLI will be installed to " + target,
                },
            );
            if (result && result === "skip") {
                return {success: false, error: "skip"};
            }
            return {success: true};
        } catch (err) {
            return {success: false, error: "Failed to install fdo CLI on Linux: " + err.message};
        }

    } else {
        return {success: false, error: "Unsupported platform: " + osType + ". Please install manually."};
    }
}

export async function removeFDOCLI() {
    const osType = platform();
    const binName = "fdo";

    if (osType === "darwin" || osType === "linux") {
        const target = `/usr/local/bin/${binName}`;
        const command = `rm -f "${target}"`;

        try {
            const result = await runWithSudo(command, {
                    name: "FDO",
                    icns: path.join(app.getAppPath(), '.webpack', 'renderer', 'assets', "icons", "fdo_icon.icns"),
                    confirmMessage: "FDO CLI will be removed from " + target,
                },
            );
            if (result && result === "skip") {
                return {success: false, error: "skip"};
            }
            return {success: true};
        } catch (err) {
            return {success: false, error: "Failed to install fdo CLI using osascript: " + err.message};
        }

    } else if (osType === "win32") {
        const installDir = path.join(homedir(), "AppData", "Local", "FDO", "bin");
        const cmdFile = path.join(installDir, `${binName}.cmd`);

        try {
            if (existsSync(cmdFile)) {
                unlinkSync(cmdFile);
            } else {
                return {success: false, error: "No CLI shim found at " + cmdFile};
            }

            // Optionally remove from PATH if you want to clean up further
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
                return {success: true};
            }

        } catch (err) {
            return {success: false, error: "Failed to remove CLI shim on Windows: " + err.message};
        }

    } else {
        return {success: false, error: "Unsupported platform: " + osType + ". Please remove manually."};
    }
}
