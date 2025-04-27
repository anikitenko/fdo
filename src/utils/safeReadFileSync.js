import fs from "node:fs";
import {shell, dialog} from "electron";

export async function safeReadFileSync(filePath, options) {
    try {
        return fs.readFileSync(filePath, options);
    } catch (err) {
        if (err.code === 'EPERM' && process.platform === 'darwin') {
            const result = await dialog.showMessageBox({
                type: 'error',
                title: 'Permission Denied',
                message: `macOS has blocked access to:\n${filePath}\n\nPlease grant permission in System Settings > Privacy & Security > Files and Folders.`,
                buttons: ['Open Settings', 'Cancel'],
                defaultId: 0
            });

            if (result.response === 0) {
                await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders');
            }

            throw new Error(`Access denied to file: ${filePath}`);
        } else {
            throw err;
        }
    }
}