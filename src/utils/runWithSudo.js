import {dialog} from "electron";
import sudo from "@expo/sudo-prompt";
import pify from "pify";

/**
 * Runs a shell command with sudo privileges.
 */
export async function runWithSudo(
    command,
    options
) {
    const confirmed = await dialog.showMessageBox({
        type: "warning",
        buttons: ["Cancel", "Proceed"],
        defaultId: 1,
        cancelId: 0,
        title: "Permission Required",
        message: options.confirmMessage ?? "This operation requires privileged access.",
        detail: `The FDO is requesting elevated permissions.\n\nDo you want to proceed?`,
        noLink: true,
    });

    if (confirmed.response !== 1) {
        return "skip"
    }

    const execAsync = pify(sudo.exec);
    return execAsync(command, {
        name: `FDO`,
        icns: options.icns,
        env: options.env,
    });
}
