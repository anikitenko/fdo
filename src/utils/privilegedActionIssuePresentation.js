const INSTALL_HINTS_BY_EXECUTABLE = Object.freeze({
    terraform: "Install Terraform and ensure one of the allowlisted executable paths exists on the host.",
    kubectl: "Install kubectl and ensure one of the allowlisted executable paths exists on the host.",
    helm: "Install Helm and ensure one of the allowlisted executable paths exists on the host.",
    docker: "Install Docker CLI and ensure one of the allowlisted executable paths exists on the host.",
    brew: "Install Homebrew and ensure the allowlisted brew path exists on the host.",
    git: "Install Git and ensure one of the allowlisted executable paths exists on the host.",
});

function uniqueList(values = []) {
    return [...new Set((Array.isArray(values) ? values : []).filter((value) => typeof value === "string" && value.trim()))];
}

function executableName(command = "") {
    const text = String(command || "").trim();
    if (!text) return "";
    const parts = text.split("/");
    return parts[parts.length - 1] || "";
}

function buildToolNotInstalledRemediation(details = {}, errorText = "") {
    const command = String(details.command || "").trim();
    const commandName = executableName(command);
    const allowlisted = uniqueList(details.allowlistedExecutables);
    const hint = INSTALL_HINTS_BY_EXECUTABLE[commandName] || "Install the requested tool and ensure the executable exists at an allowlisted host path.";
    const lines = [hint];
    if (command) {
        lines.push(`Requested executable: "${command}".`);
    }
    if (allowlisted.length > 0) {
        lines.push(`Allowlisted paths for this scope: ${allowlisted.join(", ")}.`);
    }
    if (!command && errorText) {
        lines.push("Check the host path configured by the plugin for this tool request.");
    }
    return lines.join(" ");
}

function summarizeCommand(result = {}) {
    const command = String(result.command || "").trim();
    const args = Array.isArray(result.args) ? result.args.filter((value) => typeof value === "string") : [];
    if (!command) return "";
    return [command, ...args].join(" ").trim();
}

export function extractPrivilegedActionDiagnostics(payload = {}) {
    const code = String(payload?.code || "").trim();
    const details = payload?.extraDetails || payload?.details || {};
    const isWorkflow = details && typeof details === "object" && typeof details.workflowId === "string";
    const result = details && typeof details === "object" ? details.result : null;
    const steps = Array.isArray(details?.steps) ? details.steps : [];
    const primaryCommand = String(details?.command || result?.command || "").trim();
    const primaryArgs = Array.isArray(details?.args) ? details.args : (Array.isArray(result?.args) ? result.args : []);
    const primaryCwd = String(details?.cwd || result?.cwd || "").trim();
    const allowlistedExecutables = uniqueList(details?.allowlistedExecutables);
    const clipboardText = String(details?.text || result?.text || "").trim();
    const clipboardBytesWritten = Number.isFinite(details?.bytesWritten)
        ? Number(details.bytesWritten)
        : (Number.isFinite(result?.bytesWritten) ? Number(result.bytesWritten) : null);

    return {
        code,
        workflow: isWorkflow ? {
            workflowId: String(details.workflowId || "").trim(),
            title: String(details.title || "").trim(),
            kind: String(details.kind || "").trim(),
            scope: String(details.scope || "").trim(),
            status: String(details.status || "").trim(),
            summary: details?.summary && typeof details.summary === "object" ? details.summary : null,
        } : null,
        command: primaryCommand ? {
            command: primaryCommand,
            args: primaryArgs,
            cwd: primaryCwd,
            text: summarizeCommand({command: primaryCommand, args: primaryArgs}),
            allowlistedExecutables,
        } : null,
        clipboard: (clipboardText || clipboardBytesWritten !== null) ? {
            textLength: clipboardText ? clipboardText.length : 0,
            bytesWritten: clipboardBytesWritten,
        } : null,
        steps: steps.map((step) => {
            const typedResult = step?.result && typeof step.result === "object" ? step.result : {};
            return {
                stepId: String(step?.stepId || "").trim(),
                title: String(step?.title || "").trim(),
                status: String(step?.status || "").trim(),
                code: String(step?.code || "").trim(),
                error: String(step?.error || "").trim(),
                correlationId: String(step?.correlationId || "").trim(),
                command: summarizeCommand(typedResult),
                cwd: String(typedResult?.cwd || "").trim(),
                exitCode: typedResult?.exitCode ?? null,
                durationMs: Number.isFinite(typedResult?.durationMs) ? typedResult.durationMs : null,
                dryRun: typedResult?.dryRun === true,
            };
        }).filter((step) => step.stepId || step.title || step.error || step.command),
    };
}

export function classifyPrivilegedActionIssue(payload = {}) {
    const code = String(payload?.code || "").trim();
    const details = payload?.extraDetails || payload?.details || {};
    const errorText = String(payload?.detailsText || payload?.details || payload?.error || "").trim();
    const missingCapabilities = uniqueList(payload?.missingCapabilities);
    const unknownProcessScopeMatch = errorText.match(/Unknown or unsupported process scope "([a-zA-Z0-9._-]+)"/i);
    const requestedScope = String(details?.scope || unknownProcessScopeMatch?.[1] || "").trim();

    if (code === "CAPABILITY_DENIED" || missingCapabilities.length > 0) {
        return {
            title: "Permission Required",
            summary: "The plugin requested a privileged action that is not currently granted.",
            remediation: missingCapabilities.length > 0
                ? "Grant the listed capability items in Manage Plugins -> Capabilities."
                : "Grant the required capability and scope in Manage Plugins -> Capabilities.",
            intent: "warning",
            showCapabilitiesButton: true,
        };
    }

    if (/\bhost privileged action\b/i.test(errorText) && /\bmust be\b/i.test(errorText)) {
        return {
            title: "Invalid Privileged Request",
            summary: "The plugin sent a malformed privileged-action request envelope.",
            remediation: "Fix plugin request shape before retrying. For envelope handlers, pass the validated request object (for example, envelope.request) to the host privileged-action bridge.",
            intent: "warning",
            showCapabilitiesButton: false,
        };
    }

    if (code === "PLUGIN_BACKEND_EMPTY_RESPONSE") {
        return {
            title: "Plugin Handler Returned No Response",
            summary: "The plugin backend handler ran but returned no response envelope.",
            remediation: "Verify the handler is registered in plugin init and returns a value. For privileged flows, return a backend envelope from createPrivilegedActionBackendRequest(...).",
            intent: "warning",
            showCapabilitiesButton: false,
        };
    }

    if (code === "PLUGIN_BACKEND_HANDLER_NOT_REGISTERED") {
        return {
            title: "Plugin Handler Not Registered",
            summary: "The requested plugin backend handler is not registered in this runtime session.",
            remediation: "Confirm plugin init executed, handler ID matches exactly, and PluginRegistry.registerHandler(...) runs before UI invocation.",
            intent: "warning",
            showCapabilitiesButton: false,
        };
    }

    if (code === "PLUGIN_BACKEND_TIMEOUT") {
        return {
            title: "Plugin Handler Timed Out",
            summary: "The plugin backend handler did not respond before timeout.",
            remediation: "Reduce handler startup latency, avoid blocking work in init/handler code, and verify plugin runtime health.",
            intent: "warning",
            showCapabilitiesButton: false,
        };
    }

    if (code === "PROCESS_SPAWN_ENOENT" || code === "STEP_PROCESS_SPAWN_ENOENT") {
        return {
            title: "Tool Not Installed",
            summary: "The host could not find the requested executable for this plugin action.",
            remediation: buildToolNotInstalledRemediation(details, errorText),
            intent: "warning",
            showCapabilitiesButton: false,
        };
    }

    if (code === "SCOPE_DENIED" && requestedScope) {
        return {
            title: "Process Scope Not Configured",
            summary: "The plugin requested a host-defined process scope that is granted but not configured on this host yet.",
            remediation: `Add scope "${requestedScope}" under Plugin-Specific Process Scopes or Shared Process Scopes, then allow the exact executable path the plugin needs.`,
            intent: "warning",
            showCapabilitiesButton: false,
        };
    }

    if (code === "SCOPE_VIOLATION" || code === "STEP_SCOPE_VIOLATION" || code === "SCOPE_DENIED") {
        return {
            title: "Blocked By Scope Policy",
            summary: "The plugin requested a command or working directory outside the selected host scope policy.",
            remediation: "Adjust the requested command, cwd, env, or timeout to fit the selected scope, or request a more appropriate host-specific scope.",
            intent: "warning",
            showCapabilitiesButton: false,
        };
    }

    if (code === "CANCELLED") {
        return {
            title: "Approval Rejected",
            summary: "The host confirmation step was declined, so the privileged action did not run.",
            remediation: "Retry the action and approve it if the requested operation is expected.",
            intent: "warning",
            showCapabilitiesButton: false,
        };
    }

    if (code === "CLIPBOARD_UNSUPPORTED") {
        return {
            title: "Clipboard Unavailable",
            summary: "The host clipboard API is not available in this runtime.",
            remediation: "Run this action in a host runtime where Electron clipboard APIs are available, or disable clipboard features for this plugin.",
            intent: "warning",
            showCapabilitiesButton: false,
        };
    }

    if (code === "CLIPBOARD_READ_FAILED" || code === "CLIPBOARD_WRITE_FAILED") {
        return {
            title: "Clipboard Operation Failed",
            summary: "The host could not complete the clipboard operation.",
            remediation: "Review plugin reason, capability grants, and host clipboard state. Retry once host clipboard access is available.",
            intent: "danger",
            showCapabilitiesButton: false,
        };
    }

    if (code === "PROCESS_EXIT_NON_ZERO" || code === "STEP_FAILED" || code === "STEP_OS_ERROR" || code === "OS_ERROR") {
        return {
            title: "Host Execution Failed",
            summary: "The privileged action reached the host but did not complete successfully.",
            remediation: "Review the command output and host policy details below to identify the failing step or executable.",
            intent: "danger",
            showCapabilitiesButton: false,
        };
    }

    return {
        title: "Privileged Action Failed",
        summary: "The plugin reported a privileged-action failure.",
        remediation: "Use the details below to identify whether the issue is missing tooling, missing permission, or a host policy restriction.",
        intent: "warning",
        showCapabilitiesButton: missingCapabilities.length > 0,
    };
}
