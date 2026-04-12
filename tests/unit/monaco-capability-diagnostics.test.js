import {
    buildCapabilityAndDeprecationCodeActions,
    buildMetadataIconCodeActions,
    computeCapabilityAndDeprecationMarkers,
    mergeMonacoValidationMarkers,
    suggestBlueprintIcons
} from "../../src/components/editor/utils/monacoCapabilityDiagnostics";

describe("monaco capability diagnostics", () => {
    test("flags missing system.hosts.write when privileged hosts action is used", () => {
        const markers = computeCapabilityAndDeprecationMarkers({
            source: `const req = createHostsWriteActionRequest({ action: "system.hosts.write", payload: { records: [] } });`,
            grantedCapabilities: [],
        });

        expect(markers.some((marker) => marker.code === "FDO_MISSING_SYSTEM_HOSTS_WRITE")).toBe(true);
    });

    test("flags missing scope capability for filesystem mutate scope", () => {
        const markers = computeCapabilityAndDeprecationMarkers({
            source: `
                const req = createFilesystemMutateActionRequest({
                  action: "system.fs.mutate",
                  payload: { scope: "etc-hosts", operations: [] }
                });
            `,
            grantedCapabilities: ["system.hosts.write"],
        });

        expect(markers.some((marker) => marker.code === "FDO_MISSING_SCOPE_CAPABILITY")).toBe(true);
        expect(markers.some((marker) => String(marker.message).includes("system.fs.scope.etc-hosts"))).toBe(true);
    });

    test("flags missing system.process.exec and process scope capability", () => {
        const markers = computeCapabilityAndDeprecationMarkers({
            source: `
                const req = createProcessExecActionRequest({
                  action: "system.process.exec",
                  payload: { scope: "docker-cli", command: "/usr/local/bin/docker", args: ["ps"] }
                });
            `,
            grantedCapabilities: [],
        });

        expect(markers.some((marker) => marker.code === "FDO_MISSING_SYSTEM_PROCESS_EXEC")).toBe(true);
        expect(markers.some((marker) => marker.code === "FDO_MISSING_PROCESS_SCOPE_CAPABILITY")).toBe(true);
        expect(markers.some((marker) => marker.code === "FDO_LOW_LEVEL_PROCESS_REQUEST")).toBe(true);
        expect(markers.some((marker) => String(marker.message).includes("createOperatorToolCapabilityPreset"))).toBe(true);
        expect(markers.some((marker) => String(marker.message).includes("closest operator fixture"))).toBe(true);
        expect(markers.some((marker) => String(marker.message).includes("system.process.scope.docker-cli"))).toBe(true);
        expect(markers.some((marker) => String(marker.message).includes("parseMissingCapabilityError"))).toBe(true);
        expect(markers.some((marker) => String(marker.message).includes("Missing broad capability"))).toBe(true);
        expect(markers.some((marker) => String(marker.message).includes("Missing narrow scope"))).toBe(true);
    });

    test("treats generic host scopes as fallback scopes instead of curated operator families", () => {
        const markers = computeCapabilityAndDeprecationMarkers({
            source: `
                const req = createProcessExecActionRequest({
                  action: "system.process.exec",
                  payload: { scope: "system-inspect", command: "/bin/ls", args: ["-la"] }
                });
            `,
            grantedCapabilities: ["system.process.exec"],
        });

        expect(markers.some((marker) => String(marker.message).includes("host-specific fallback scope"))).toBe(true);
        expect(markers.some((marker) => String(marker.message).includes("createOperatorToolCapabilityPreset(\"system-inspect\")"))).toBe(false);
    });

    test("recommends declareCapabilities for privileged operator code paths", () => {
        const markers = computeCapabilityAndDeprecationMarkers({
            source: `
                async function runPlan() {
                  return requestOperatorTool("terraform", {
                    command: "/usr/local/bin/terraform",
                    args: ["plan"],
                  });
                }
            `,
            grantedCapabilities: ["system.process.exec"],
        });

        expect(markers.some((marker) => marker.code === "FDO_DECLARE_CAPABILITIES_RECOMMENDED")).toBe(true);
        expect(markers.some((marker) => String(marker.message).includes("declareCapabilities(): PluginCapability[]"))).toBe(true);
    });

    test("does not recommend declareCapabilities when privileged plugin already declares intent", () => {
        const markers = computeCapabilityAndDeprecationMarkers({
            source: `
                declareCapabilities(): PluginCapability[] {
                  return createOperatorToolCapabilityPreset("terraform");
                }
                async function runPlan() {
                  return requestOperatorTool("terraform", {
                    command: "/usr/local/bin/terraform",
                    args: ["plan"],
                  });
                }
            `,
            grantedCapabilities: ["system.process.exec"],
        });

        expect(markers.some((marker) => marker.code === "FDO_DECLARE_CAPABILITIES_RECOMMENDED")).toBe(false);
    });

    test("does not report process capability markers when required capabilities are granted", () => {
        const markers = computeCapabilityAndDeprecationMarkers({
            source: `
                type Result = PrivilegedActionResponse<{ ok: boolean }>;
                const req = createProcessExecActionRequest({
                  action: "system.process.exec",
                  payload: { scope: "docker-cli", command: "/usr/local/bin/docker", args: ["ps"] }
                });
                const correlationId = createPrivilegedActionCorrelationId("docker-cli");
                const backendPayload = createPrivilegedActionBackendRequest(req, { correlationIdPrefix: "docker-cli" });
                const scopedReq = createScopedProcessExecActionRequest("docker-cli", { command: "/usr/local/bin/docker", args: ["ps"] });
                const preset = getOperatorToolPreset("docker-cli");
                const presets = listOperatorToolPresets();
                const caps = createOperatorToolCapabilityPreset("docker-cli");
                const capabilityBundle = createCapabilityBundle(["system.process.exec", "system.process.scope.docker-cli"]);
                const processBundle = createProcessCapabilityBundle("docker-cli");
                const fsBundle = createFilesystemCapabilityBundle("etc-hosts");
                const described = describeCapability("system.process.exec");
                const parsed = parseMissingCapabilityError(new Error('Capability "system.process.exec" is required to run docker status. Configure PluginRegistry.configureCapabilities({ granted: ["system.process.exec"] }) in the host before plugin initialization.'));
                const presetReq = createOperatorToolActionRequest("docker-cli", { command: "/usr/local/bin/docker", args: ["ps"] });
                const cap = createProcessScopeCapability("docker-cli");
                const reqCap = requireProcessScopeCapability("docker-cli");
                const response = requestPrivilegedAction(req, { correlationIdPrefix: "docker-cli" });
                const scopedResponse = requestScopedProcessExec("docker-cli", { command: "/usr/local/bin/docker", args: ["ps"] });
                const presetResponse = requestOperatorTool("docker-cli", { command: "/usr/local/bin/docker", args: ["ps"] });
                const isOk = isPrivilegedActionSuccessResponse({ ok: true, correlationId, result: { ok: true } });
                const isErr = isPrivilegedActionErrorResponse({ ok: false, correlationId, error: "x" });
                const unwrapped = unwrapPrivilegedActionResponse({ ok: true, correlationId, result: { ok: true } });
                validateHostPrivilegedActionRequest(req);
            `,
            grantedCapabilities: ["system.process.exec", "system.process.scope.docker-cli"],
        });

        expect(markers.some((marker) => String(marker.code).startsWith("FDO_MISSING_"))).toBe(false);
    });

    test("flags missing clipboard read and write capabilities when clipboard helpers are used", () => {
        const markers = computeCapabilityAndDeprecationMarkers({
            source: `
                async function readIt() {
                  return requestClipboardRead({ reason: "Read selected secret" });
                }
                async function writeIt() {
                  return requestClipboardWrite({ text: "copied", reason: "Copy command output" });
                }
            `,
            grantedCapabilities: [],
        });

        expect(markers.some((marker) => marker.code === "FDO_MISSING_SYSTEM_CLIPBOARD_READ")).toBe(true);
        expect(markers.some((marker) => marker.code === "FDO_MISSING_SYSTEM_CLIPBOARD_WRITE")).toBe(true);
        expect(markers.some((marker) => marker.code === "FDO_MISSING_SYSTEM_HOSTS_WRITE_FOR_CLIPBOARD")).toBe(true);
    });

    test("warns when raw clipboard APIs are used instead of host-mediated helpers", () => {
        const markers = computeCapabilityAndDeprecationMarkers({
            source: `
                async function copyRaw() {
                  await navigator.clipboard.writeText("unsafe");
                }
            `,
            grantedCapabilities: [],
        });

        expect(markers.some((marker) => marker.code === "FDO_RAW_CLIPBOARD_API")).toBe(true);
    });

    test("adds deprecation markers for legacy privileged channel and deprecated action", () => {
        const markers = computeCapabilityAndDeprecationMarkers({
            source: `
                const a = "__host.privilegedAction";
                const b = "system.fs.write";
            `,
            grantedCapabilities: [],
        });

        expect(markers.some((marker) => marker.code === "FDO_DEPRECATED_PRIVILEGED_HANDLER")).toBe(true);
        expect(markers.some((marker) => marker.code === "FDO_DEPRECATED_ACTION")).toBe(true);
    });

    test("does not report capability markers when required capabilities are granted", () => {
        const markers = computeCapabilityAndDeprecationMarkers({
            source: `
                const req = createFilesystemMutateActionRequest({
                  action: "system.fs.mutate",
                  payload: { scope: "etc-hosts", operations: [] }
                });
            `,
            grantedCapabilities: ["system.hosts.write", "system.fs.scope.etc-hosts"],
        });

        expect(markers.some((marker) => String(marker.code).startsWith("FDO_MISSING_"))).toBe(false);
    });

    test("mergeMonacoValidationMarkers keeps Monaco diagnostics and appends capability diagnostics", () => {
        const base = [{ message: "TS error", code: "TS1005" }];
        const capability = [{ message: "Missing capability", code: "FDO_MISSING_SYSTEM_HOSTS_WRITE" }];
        const merged = mergeMonacoValidationMarkers(base, capability);

        expect(merged).toHaveLength(2);
        expect(merged[0].code).toBe("TS1005");
        expect(merged[1].code).toBe("FDO_MISSING_SYSTEM_HOSTS_WRITE");
    });

    test("flags invalid metadata icon and suggests BlueprintJS v6 replacements", () => {
        const markers = computeCapabilityAndDeprecationMarkers({
            source: `
                private readonly _metadata: PluginMetadata = {
                    name: "Example",
                    version: "1.0.0",
                    author: "Test",
                    description: "Demo",
                    icon: "not-a-real-icon",
                };
            `,
            grantedCapabilities: [],
        });

        const invalidMarker = markers.find((marker) => marker.code === "FDO_INVALID_METADATA_ICON");
        expect(invalidMarker).toBeTruthy();
        expect(String(invalidMarker.message)).toContain("BlueprintJS v6");
        const fixes = buildMetadataIconCodeActions({
            source: `
                private readonly _metadata: PluginMetadata = {
                    name: "Example",
                    version: "1.0.0",
                    author: "Test",
                    description: "Demo",
                    icon: "not-a-real-icon",
                };
            `,
            marker: invalidMarker,
        });
        expect(fixes.length).toBeGreaterThan(0);
        expect(String(fixes[0].title)).toContain("Use Blueprint icon");
        expect(String(fixes[0].edit.text)).toMatch(/^[a-z0-9-]+$/i);
    });

    test("flags missing metadata icon and provides add-icon quick fix", () => {
        const source = `
            private readonly _metadata: PluginMetadata = {
                name: "Example",
                version: "1.0.0",
                author: "Test",
                description: "Demo",
            };
        `;
        const markers = computeCapabilityAndDeprecationMarkers({
            source,
            grantedCapabilities: [],
        });

        const missingMarker = markers.find((marker) => marker.code === "FDO_MISSING_METADATA_ICON");
        expect(missingMarker).toBeTruthy();
        const fixes = buildMetadataIconCodeActions({source, marker: missingMarker});
        expect(fixes.length).toBeGreaterThan(0);
        expect(String(fixes[0].title)).toContain("Add metadata icon");
        expect(String(fixes[0].edit.text)).toContain('icon: "');
    });

    test("reconstructs invalid icon context when Monaco marker loses custom fdoData", () => {
        const source = `
            private readonly _metadata: PluginMetadata = {
                name: "Example",
                version: "1.0.0",
                author: "Test",
                description: "Demo",
                icon: "zzbzfbfb",
            };
        `;
        const markers = computeCapabilityAndDeprecationMarkers({
            source,
            grantedCapabilities: [],
        });
        const invalidMarker = markers.find((marker) => marker.code === "FDO_INVALID_METADATA_ICON");
        expect(invalidMarker).toBeTruthy();

        const monacoStyleMarker = {
            ...invalidMarker,
            fdoData: undefined,
        };
        const fixes = buildMetadataIconCodeActions({ source, marker: monacoStyleMarker });
        expect(fixes.length).toBeGreaterThan(0);
        expect(fixes.some((fix) => String(fix.title).includes('"cog"'))).toBe(false);
        expect(String(fixes[0].edit.text)).toMatch(/^[a-z0-9-]+$/i);
    });

    test("suggestBlueprintIcons returns Blueprint-compatible suggestions", () => {
        const suggestions = suggestBlueprintIcons("setings", 3);
        expect(suggestions.length).toBeGreaterThan(0);
        expect(suggestions.every((icon) => typeof icon === "string" && icon.length > 0)).toBe(true);
        expect(suggestions).toContain("settings");
    });

    test("suggestBlueprintIcons prefers first-letter matches when fuzzy match is weak", () => {
        const suggestions = suggestBlueprintIcons("aaaa", 5);
        expect(suggestions.length).toBeGreaterThan(0);
        expect(suggestions.every((icon) => String(icon).startsWith("a"))).toBe(true);
        expect(suggestions.includes("cog")).toBe(false);
    });

    test("suggestBlueprintIcons avoids unrelated defaults for non-matching inputs", () => {
        const suggestions = suggestBlueprintIcons("zzbzfbfb", 5);
        if (suggestions.length > 0) {
            expect(suggestions.every((icon) => String(icon).startsWith("z"))).toBe(true);
        }
        expect(suggestions.includes("cog")).toBe(false);
    });

    test("suggestBlueprintIcons uses stable curated defaults for empty input", () => {
        const suggestions = suggestBlueprintIcons("", 5);
        expect(suggestions).toEqual(["cog", "application", "code", "wrench", "widget"]);
    });

    test("builds deterministic quick fixes for deprecated privileged handler and action literals", () => {
        const source = `
            const a = "__host.privilegedAction";
            const b = "system.fs.write";
        `;
        const markers = computeCapabilityAndDeprecationMarkers({ source, grantedCapabilities: [] });
        const handlerMarker = markers.find((marker) => marker.code === "FDO_DEPRECATED_PRIVILEGED_HANDLER");
        const actionMarker = markers.find((marker) => marker.code === "FDO_DEPRECATED_ACTION");

        const handlerFixes = buildCapabilityAndDeprecationCodeActions({ source, marker: handlerMarker });
        const actionFixes = buildCapabilityAndDeprecationCodeActions({ source, marker: actionMarker });

        expect(handlerFixes.some((fix) => fix.title.includes("requestPrivilegedAction"))).toBe(true);
        expect(handlerFixes.some((fix) => String(fix.edit?.text || "").includes("requestPrivilegedAction"))).toBe(true);
        expect(actionFixes.some((fix) => fix.title.includes("system.fs.mutate"))).toBe(true);
        expect(String(handlerMarker.message)).toContain("requestOperatorTool");
        expect(String(handlerMarker.message)).toContain("requestScopedProcessExec");
    });

    test("builds capability guidance quick fix for missing capability markers", () => {
        const source = `const req = createHostsWriteActionRequest({ action: "system.hosts.write" });`;
        const markers = computeCapabilityAndDeprecationMarkers({ source, grantedCapabilities: [] });
        const missingMarker = markers.find((marker) => marker.code === "FDO_MISSING_SYSTEM_HOSTS_WRITE");

        const fixes = buildCapabilityAndDeprecationCodeActions({ source, marker: missingMarker });
        expect(fixes.some((fix) => String(fix.title).includes("Insert capability guidance"))).toBe(true);
        expect(fixes.some((fix) => String(fix.edit?.text || "").includes("Requires host capability"))).toBe(true);
    });

    test("uses draft-friendly warning diagnostics for missing capabilities on unsaved plugins", () => {
        const source = `const req = createHostsWriteActionRequest({ action: "system.hosts.write" });`;
        const markers = computeCapabilityAndDeprecationMarkers({
            source,
            grantedCapabilities: [],
            pluginPersisted: false,
        });
        const missingMarker = markers.find((marker) => marker.code === "FDO_MISSING_SYSTEM_HOSTS_WRITE");

        expect(missingMarker).toBeTruthy();
        expect(String(missingMarker.message)).toContain("Unsaved plugin requires capability");
        expect(missingMarker.severity).toBe(2);
    });

    test("suggests workflow helper when code chains multiple host-mediated process requests", () => {
        const markers = computeCapabilityAndDeprecationMarkers({
            source: `
                async function runFlow() {
                    await requestScopedProcessExec("docker-cli", { command: "/usr/local/bin/docker", args: ["ps"] });
                    await requestScopedProcessExec("docker-cli", { command: "/usr/local/bin/docker", args: ["pull", "alpine:latest"] });
                }
            `,
            grantedCapabilities: ["system.process.exec", "system.process.scope.docker-cli"],
        });

        const workflowMarker = markers.find((marker) => marker.code === "FDO_WORKFLOW_CANDIDATE");
        expect(workflowMarker).toBeTruthy();
        expect(String(workflowMarker.message)).toContain("requestScopedWorkflow");
        expect(String(workflowMarker.message)).toContain("createScopedWorkflowRequest");
    });
});
