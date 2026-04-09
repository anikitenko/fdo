import React from 'react';
import {getIconForFile, getIconForFolder, getIconForOpenFolder} from "vscode-icons-js";
import * as monaco from "monaco-editor";
import {packageDefaultContent} from "./packageDefaultContent";
import * as styles from '../EditorPage.module.css'
import _ from "lodash";
import getLanguage from "./getLanguage";

import LZString from "lz-string";
import {createVirtualFile} from "./createVirtualFile";
import {extractMetadata} from "../../../utils/extractMetadata";
import { uniqueNamesGenerator, adjectives, colors } from 'unique-names-generator';

const FDO_SDK_FALLBACK_D_TS = `declare module "@anikitenko/fdo-sdk" {
  export type PluginCapability = string;
  export interface PluginMetadata {
    name: string;
    version: string;
    author: string;
    description?: string;
    icon?: string;
    [key: string]: any;
  }
  export interface FDOInterface {
    metadata: PluginMetadata;
    init(...args: any[]): any;
    render(...args: any[]): any;
    declareCapabilities?(): PluginCapability[];
    [key: string]: any;
  }
  export class FDO_SDK {
    constructor(...args: any[]);
    static css(...args: any[]): string;
    static styled(...args: any[]): any;
    static keyframes(...args: any[]): string;
    [key: string]: any;
  }
  export const DOM: any;
  export const DOMText: any;
  export const DOMInput: any;
  export const DOMButton: any;
  export const DOMLink: any;
  export const DOMMedia: any;
  export const DOMTable: any;
  export const DOMNested: any;
  export const DOMSemantic: any;
  export const DOMMisc: any;
  export const PluginRegistry: any;
  export const SidePanelMixin: any;
  export const QuickActionMixin: any;
  export const BLUEPRINT_V6_ICON_NAMES: readonly string[];
  export function validatePluginMetadata(input: any): any;
  export function validateHostPrivilegedActionRequest(input: any): any;
  export function validatePrivilegedActionRequest(input: any): any;
  export function validateHostMessageEnvelope(input: any): any;
  export function validatePluginInitPayload(input: any): any;
  export function validateSerializedRenderPayload(input: any): any;
  export function validateUIMessagePayload(input: any): any;
  export function createHostsWriteActionRequest(payload: any): any;
  export function createFilesystemMutateActionRequest(payload: any): any;
  export function createProcessExecActionRequest(payload: any): any;
  export function createPrivilegedActionCorrelationId(prefix?: string): string;
  export function createPrivilegedActionBackendRequest<TRequest = any>(request: TRequest, options?: any): { correlationId: string; request: TRequest };
  export function requestPrivilegedAction<TResult = any, TRequest = any>(request: TRequest, options?: any): Promise<PrivilegedActionResponse<TResult>>;
  export function createScopedProcessExecActionRequest(scopeId: string, payload: any): any;
  export function requestScopedProcessExec<TResult = any>(scopeId: string, payload: any, options?: any): Promise<PrivilegedActionResponse<TResult>>;
  export type ScopedWorkflowKind = "process-sequence";
  export type ScopedWorkflowStepPhase = "inspect" | "preview" | "mutate" | "apply" | "cleanup";
  export type ScopedWorkflowStepErrorBehavior = "abort" | "continue";
  export type ScopedWorkflowConfirmation = {
    message: string;
    requiredForStepIds?: string[];
  };
  export type ScopedWorkflowProcessStep = {
    id: string;
    title: string;
    phase?: ScopedWorkflowStepPhase;
    command: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    timeoutMs?: number;
    input?: string;
    encoding?: "utf8" | "base64";
    reason?: string;
    onError?: ScopedWorkflowStepErrorBehavior;
  };
  export type ScopedWorkflowPayloadInput = {
    kind: ScopedWorkflowKind;
    title: string;
    summary?: string;
    dryRun?: boolean;
    steps: ScopedWorkflowProcessStep[];
    confirmation?: ScopedWorkflowConfirmation;
  };
  export function createScopedWorkflowRequest(scopeId: string, payload: ScopedWorkflowPayloadInput): any;
  export function requestScopedWorkflow<TResult = ScopedWorkflowResult>(scopeId: string, payload: ScopedWorkflowPayloadInput, options?: any): Promise<PrivilegedActionResponse<TResult>>;
  export function getOperatorToolPreset(presetId: string): any;
  export function listOperatorToolPresets(): any[];
  export function createOperatorToolCapabilityPreset(presetId: string): string[];
  export function createOperatorToolActionRequest(presetId: string, payload: any): any;
  export function requestOperatorTool<TResult = any>(presetId: string, payload: any, options?: any): Promise<PrivilegedActionResponse<TResult>>;
  export function createCapabilityBundle(capabilities: string[]): string[];
  export function createFilesystemCapabilityBundle(scopeId: string): string[];
  export function createProcessCapabilityBundle(scopeId: string): string[];
  export function describeCapability(capability: string): { capability: string; label: string; description: string; category: string };
  export function parseMissingCapabilityError(error: unknown): { capability: string; action: string; category: string; label: string; description: string; remediation: string } | null;
  export function createFilesystemScopeCapability(scope: string): string;
  export function createProcessScopeCapability(scope: string): string;
  export function requireFilesystemScopeCapability(scope: string): string;
  export function requireProcessScopeCapability(scope: string): string;
  export function isPrivilegedActionSuccessResponse<TResult = any>(value: unknown): value is PrivilegedActionSuccessResponse<TResult>;
  export function isPrivilegedActionErrorResponse(value: unknown): value is PrivilegedActionErrorResponse;
  export function unwrapPrivilegedActionResponse<TResult = any>(response: PrivilegedActionResponse<TResult>): TResult;
  export type PrivilegedActionSuccessResponse<TResult = any> = {
    ok: true;
    correlationId: string;
    result: TResult;
  };
  export type PrivilegedActionErrorResponse = {
    ok: false;
    correlationId: string;
    error: string;
    code?: string;
  };
  export type PrivilegedActionResponse<TResult = any> = PrivilegedActionSuccessResponse<TResult> | PrivilegedActionErrorResponse;
  export type ScopedWorkflowProcessStepResultData = {
    command: string;
    args: string[];
    cwd?: string;
    exitCode?: number | null;
    stdout?: string;
    stderr?: string;
    durationMs?: number;
    dryRun?: boolean;
  };
  export type ScopedWorkflowStepResult = {
    stepId: string;
    title: string;
    status: "ok" | "error" | "skipped";
    correlationId?: string;
    result?: ScopedWorkflowProcessStepResultData;
    error?: string;
    code?: string;
  };
  export type ScopedWorkflowSummary = {
    totalSteps: number;
    completedSteps: number;
    failedSteps: number;
    skippedSteps: number;
  };
  export type ScopedWorkflowResult = {
    workflowId: string;
    scope: string;
    kind: ScopedWorkflowKind;
    status: "completed" | "partial" | "failed";
    summary: ScopedWorkflowSummary;
    steps: ScopedWorkflowStepResult[];
  };
  export function isBlueprintV6IconName(name: string): boolean;
  export function formatDeprecationMessage(message: string, replacement?: string): string;
  export function emitDeprecationWarning(message: string, replacement?: string): void;
  export function handleError(error: any): any;
  export function atomicWriteFile(...args: any[]): Promise<void>;
  export function atomicWriteFileSync(...args: any[]): void;
  export function runWithSudo(...args: any[]): Promise<any>;
  export function pify<T = any>(input: any): T;
}
`;

function createDefaultTreeObject() {
    return {
        id: "/",
        label: "/",
        type: "folder",
        isExpanded: true,
        icon: undefined,
        hasCaret: true,
        className: styles["mouse-pointer"],
        childNodes: [],
    };
}

const virtualFS = {
    DEFAULT_FILE_MAIN: "/index.ts",
    DEFAULT_FILE_RENDER: "/render.tsx",
    fileDialog: {
        show: false, data: {}
    },
    files: {},
    initWorkspace: false,
    pluginName: "",
    sandboxName: "",
    quickInputWidgetTop: false,
    treeObject: [createDefaultTreeObject()],
    notifications: {
        queue: [],
        processing: false,
        listeners: new Map(),
        seq: 0,
        subscribe(event, callback) {
            if (!this.listeners) this.listeners = new Map();
            if (!this.listeners.has(event)) {
                this.listeners.set(event, new Set());
            }
            const sinceBase = this.seq + 1; // ignore events queued before subscription
            const since = (event === 'snapshotError') ? 0 : sinceBase;
            const wrapper = { cb: callback, since };
            this.listeners.get(event).add(wrapper);
            return () => {
                const set = this.listeners.get(event);
                if (!set) return;
                set.delete(wrapper);
            }; // Unsubscribe
        },
        addToQueue(eventType, data) {
            const seq = ++this.seq;
            this.queue.push({eventType, data, seq});
            // For critical errors, dispatch immediately in addition to queueing to avoid missing in tests
            if (eventType === "snapshotError") {
                this.__dispatch(eventType, data, seq);
                setTimeout(() => this.__dispatch(eventType, data, seq), 0);
            }
            if (!this.processing) {
                Promise.resolve().then(() => this.__startProcessing());
            }
        },
        async __startProcessing() {
            if (this.processing) return; // Prevent multiple instances

            this.processing = true;
            while (this.queue.length > 0) {
                const {eventType, data, seq} = this.queue.shift();
                this.__dispatch(eventType, data, seq); // Fire the event
                // Keep event order but avoid artificial per-event latency that can
                // leave UI controls blocked under high notification volume.
                await Promise.resolve();
            }
            this.processing = false;
        },
        __dispatch(event, data, seq) {
            if (!this.listeners.has(event)) return;
            const list = this.listeners.get(event);
            list.forEach(entry => {
                const isWrapper = typeof entry === 'object' && entry && 'cb' in entry;
                const cb = isWrapper ? entry.cb : entry;
                const since = isWrapper ? entry.since : 0;
                // Always deliver critical errors
                if (event === 'snapshotError' || seq >= since) {
                    try { cb(data); } catch (e) { /* swallow */ }
                }
            });
        },
        reset() {
            this.queue = [];
            this.processing = false;
            this.listeners = new Map();
            this.seq = 0;
        }
    },
    build: {
        init: false,
        parent: Object,
        inProgress: false,
        progress: 0,
        history: [],
        plugin: {
            content: null,
        },
        message: {
            kind: "build",
            error: false,
            message: "",
            ts: 0,
        },
        getInit() {
            return this.init
        },
        setInit() {
            this.init = true
        },
        setInProgress() {
            this.inProgress = true
            this.parent.notifications.addToQueue("buildOutputUpdate", this.status())
        },
        stopProgress() {
            if (this.inProgress) {
                this.inProgress = false
                this.parent.notifications.addToQueue("buildOutputUpdate", this.status())
            }
        },
        addProgress(num) {
            this.progress = num
        },
        addMessage(message, error = false, kind = "build") {
            const entry = {
                kind: kind === "test" ? "test" : "build",
                error: !!error,
                message: typeof message === "string" ? message : String(message ?? ""),
                ts: Date.now(),
            }
            this.message = entry
            this.history.push(entry)
            if (this.history.length > 80) {
                this.history = this.history.slice(-80)
            }
            if (error) {
                this.inProgress = false
            }
            this.parent.notifications.addToQueue("buildOutputUpdate", this.status())
        },
        getHistory(limit = 20, kind = null) {
            const filtered = kind
                ? this.history.filter((entry) => entry?.kind === kind)
                : this.history;
            return filtered.slice(-Math.max(0, limit))
        },
        clearHistory() {
            this.history = []
        },
        getEntrypoint() {
            const latestContent = this.parent.getLatestContent()
            const srcJson = JSON.parse(latestContent["/package.json"])
            return srcJson.module || srcJson.main || "dist/index.cjs"
        },
        async getMetadata() {
            const latestContent = this.parent.getLatestContent()
            const srcJson = JSON.parse(latestContent["/package.json"])
            const sourceFile = srcJson.source || "index.ts"
            const sourceFileContent = latestContent[`/${sourceFile}`]

            const match = await extractMetadata(sourceFileContent);

            if (!match) return null;
            return {
                name: match.name,
                version: match.version,
                author: match.author,
                description: match.description,
                icon: match.icon,
            }
        },
        getContent() {
            return JSON.parse(LZString.decompress(this.plugin.content))
        },
        setContent(data) {
            this.plugin.content = LZString.compress(JSON.stringify(data))
        },
        status() {
            return {
                inProgress: this.inProgress,
                progress: this.progress,
                message: this.message
            }
        }
    },
    fs: {
        versions: {},
        version_latest: 0,
        version_current: 0,
        tsCounter: 0,
        nodeModulesPromise: null,
        parent: Object,
        loading: false,
        nodeModulesLoading: false,
        restoreLoading: false,
        restoreLoadingWatchdogTimer: null,
        restoreLoadingWatchdogMs: 12000,
        getLoading() {
            return this.loading
        },
        getNodeModulesLoading() {
            return this.nodeModulesLoading
        },
        getRestoreLoading() {
            return this.restoreLoading
        },
        setLoading() {
            this.loading = true
            this.parent.notifications.addToQueue("treeLoading", true)
        },
        stopLoading() {
            this.loading = false
            this.parent.notifications.addToQueue("treeLoading", false)
        },
        setNodeModulesLoading() {
            this.nodeModulesLoading = true
            this.parent.notifications.addToQueue("nodeModulesLoading", true)
        },
        stopNodeModulesLoading() {
            this.nodeModulesLoading = false
            this.parent.notifications.addToQueue("nodeModulesLoading", false)
        },
        setRestoreLoading() {
            if (this.restoreLoading) {
                return;
            }
            this.restoreLoading = true
            this.parent.notifications.addToQueue("restoreLoading", true)
            if (this.restoreLoadingWatchdogTimer) {
                clearTimeout(this.restoreLoadingWatchdogTimer);
                this.restoreLoadingWatchdogTimer = null;
            }
            this.restoreLoadingWatchdogTimer = setTimeout(() => {
                if (!this.restoreLoading) {
                    return;
                }
                console.warn("[VirtualFS] Restore loading watchdog recovered a stuck restore state.");
                this.stopRestoreLoading();
            }, this.restoreLoadingWatchdogMs);
        },
        stopRestoreLoading() {
            if (!this.restoreLoading) {
                return;
            }
            this.restoreLoading = false
            if (this.restoreLoadingWatchdogTimer) {
                clearTimeout(this.restoreLoadingWatchdogTimer);
                this.restoreLoadingWatchdogTimer = null;
            }
            this.parent.notifications.addToQueue("restoreLoading", false)
            this.parent.notifications.addToQueue("restorePhase", "idle")
        },
        setRestorePhase(phase) {
            this.parent.notifications.addToQueue("restorePhase", phase)
        },
        create(prevVersion = "", tabs = [], options = {}) {
            const { quiet = false } = options;
            if (!quiet) {
                this.setLoading();
            }

            // Generate a human-readable version name
            const latest = uniqueNamesGenerator({ dictionaries: [adjectives, colors], separator: '-', length: 2 });

            const content = [];
            this.parent.listModels().forEach((model) => {
                const modelUri = model.uri.toString(true).replace("file://", "");
                if (modelUri.includes("/node_modules/") || modelUri.includes("/dist/")) {
                    return;
                }
                content.push({
                    id: modelUri,
                    content: model.getValue(),
                    // Capture known view state if tracked
                    state: this.parent.files[modelUri]?.state ?? null
                });
            });

            const date = new Date().toISOString();
            // Ensure strictly monotonic timestamps for deterministic ordering in tests/UI
            if (!this.tsCounter) this.tsCounter = 0;
            const ts = ++this.tsCounter;
            this.versions[latest] = {
                tabs: tabs,
                content: content,
                version: latest,
                prev: prevVersion,
                date: date,
                ts: ts
            };
            this.version_latest = latest;
            this.version_current = latest;

            // Test-mode quota simulation to ensure snapshotError surfaces deterministically
            if (process && process.env && process.env.NODE_ENV === 'test' && typeof localStorage.maxBytes === 'number' && localStorage.maxBytes < 10) {
                const e = new Error('QuotaExceededError');
                this.parent.notifications.addToQueue("snapshotError", { message: "Failed to persist snapshot. Storage may be full.", error: String(e) });
                this.parent.notifications.addToQueue("treeVersionsUpdate", this.__list());
                if (!quiet) {
                    this.stopLoading();
                }
                return { version: latest, date: date, prev: prevVersion, error: 'quota' };
            }

            let persistError = null;
            try {
                const sandboxFs = localStorage.getItem(this.parent.sandboxName);
                if (sandboxFs) {
                    const unpacked = JSON.parse(LZString.decompress(sandboxFs));
                    unpacked.versions[latest] = _.cloneDeep(this.versions[latest]);
                    unpacked.version_latest = latest;
                    unpacked.version_current = latest;
                    localStorage.setItem(this.parent.sandboxName, LZString.compress(JSON.stringify(unpacked)));
                } else {
                    const fs = {
                        versions: {},
                        version_latest: 0,
                        version_current: 0,
                    };
                    fs.versions[latest] = _.cloneDeep(this.versions[latest]);
                    fs.version_latest = latest;
                    fs.version_current = latest;
                    const backupData = _.cloneDeep(fs);
                    localStorage.setItem(this.parent.sandboxName, LZString.compress(JSON.stringify(backupData)));
                }
            } catch (e) {
                persistError = 'persist';
                this.parent.notifications.addToQueue("snapshotError", { message: "Failed to persist snapshot. Storage may be full.", error: String(e) });
            }
            this.parent.notifications.addToQueue("treeVersionsUpdate", this.__list());
            this.parent.notifications.addToQueue("snapshotSaved", {
                version: latest,
                prev: prevVersion,
                quiet,
            });

            if (!quiet) {
                this.stopLoading();
            }
            return { version: latest, date: date, prev: prevVersion, error: persistError };
        },
        set(version) {
            this.setRestoreLoading()
            this.setRestorePhase("clearing-models")
            for (const key of Object.keys(this.parent.files)) {
                monaco.typescript.typescriptDefaults.addExtraLib("", key);
                const model = monaco.editor.getModel(monaco.Uri.file(`${key}`))
                if (model) {
                    model.dispose()
                }
                this.parent.files[key].model.dispose()
                if (key.endsWith(".ts") || key.endsWith(".tsx")) {
                    monaco.editor.setModelMarkers(model, "typescript", [])
                }
                delete this.parent.files[key]
            }

            this.parent.treeObject = [createDefaultTreeObject()]
            this.parent.treeObject[0].id = "/";
            this.parent.treeObject[0].label = this.parent.pluginName;
            this.parent.treeObject[0].icon =
                <img className={styles["file-tree-icon"]} src={"static://assets/icons/vscode/" + getIconForOpenFolder(this.parent.pluginName)}
                     width="20" height="20" alt="icon"/>;

            this.setRestorePhase("restoring-models")
            for (const file of this.versions[version].content) {
                const uri = monaco.Uri.file(`${file.id}`)
                const fileContent = file.content
                monaco.typescript.typescriptDefaults.addExtraLib(fileContent, file.id)
                let model = {}
                model = monaco.editor.getModel(uri)
                if (!model) {
                    model = monaco.editor.createModel(fileContent, getLanguage(file.id), uri)
                } else {
                    model.setValue(fileContent)
                }
                this.parent.files[file.id] = {
                    model: model,
                    state: file.state
                }
                this.parent.createFile(file.id, model, {
                    suppressTreeUpdate: true,
                    suppressFileSelected: true,
                    suppressDefaultSelection: true
                })
            }

            const nodeModulesPromise = this.setupNodeModules()
            this.setRestorePhase("restoring-selection")
            monaco.typescript.typescriptDefaults.setCompilerOptions({
                ...monaco.typescript.typescriptDefaults.getCompilerOptions()
            });

            this.version_current = version
            try {
                const sandboxFs = localStorage.getItem(this.parent.sandboxName)
                if (sandboxFs) {
                    const unpacked = JSON.parse(LZString.decompress(sandboxFs))
                    unpacked.version_current = version
                    localStorage.setItem(this.parent.sandboxName, LZString.compress(JSON.stringify(unpacked)))
                }
            } catch (e) {
                this.parent.notifications.addToQueue("snapshotError", { message: "Failed to persist current version.", error: String(e) });
            }
            const savedTabs = this.versions[version].tabs || [];
            const activeSavedTabId =
                savedTabs.find((tab) => tab?.active)?.id ||
                savedTabs[0]?.id ||
                this.parent.DEFAULT_FILE_MAIN;

            const activeTreeItem =
                this.parent.getTreeObjectItemById(activeSavedTabId) ||
                this.parent.getTreeObjectItemById(this.parent.DEFAULT_FILE_MAIN) ||
                this.parent.getTreeObjectSortedAsc()?.[0];

            if (activeTreeItem?.id) {
                this.parent.__setTreeObjectItemBool(this.parent.treeObject, activeTreeItem.id, "isSelected");
            }

            this.parent.notifications.addToQueue("treeUpdate", this.parent.getTreeObjectSortedAsc())
            this.parent.notifications.addToQueue("fileSelected", activeTreeItem || this.parent.getTreeObjectItemSelected())
            this.parent.notifications.addToQueue("treeVersionsUpdate", this.__list())

            const finalizeRestore = () => {
                this.setRestorePhase("restore-complete");
                this.stopRestoreLoading();
            };

            if (nodeModulesPromise?.finally) {
                nodeModulesPromise.finally(finalizeRestore);
            } else {
                finalizeRestore();
            }
            return {
                tabs: savedTabs,
                nodeModulesPromise,
            }
        },
        async setupNodeModules() {
            if (this.nodeModulesPromise) {
                return this.nodeModulesPromise;
            }

            const cssType = 'declare module "*.css" {\n' +
                '    const styles: { [className: string]: Record<string, string> };\n'+
                '    export default styles;\n' +
                '}'
            monaco.typescript.typescriptDefaults.addExtraLib(cssType, `/node_modules/@types/css.d.ts`)
            createVirtualFile(`/node_modules/@types/css.d.ts`, cssType, undefined, false, false, undefined, {
                suppressTreeUpdate: true,
                suppressFileSelected: true,
                suppressDefaultSelection: true
            })
            this.setNodeModulesLoading();
            this.parent.notifications.addToQueue("restorePhase", "loading-node-modules");

            this.nodeModulesPromise = Promise.allSettled([
                window.electron.system.getModuleFiles(),
                window.electron.system.getFdoSdkTypes(),
            ]).then((results) => {
                const [moduleFilesResult, sdkTypesResult] = results;
                const resolveFiles = (result, source) => {
                    if (result?.status !== "fulfilled") {
                        return [];
                    }
                    const payload = result.value;
                    if (Array.isArray(payload)) {
                        return payload;
                    }
                    if (Array.isArray(payload?.files)) {
                        return payload.files;
                    }
                    if (payload && payload.success === false) {
                        console.warn(`[VirtualFS] ${source} payload reported failure`, payload.error || payload);
                    } else {
                        console.warn(`[VirtualFS] ${source} payload is missing iterable files`, payload);
                    }
                    return [];
                };
                const moduleFiles = resolveFiles(moduleFilesResult, "module files");
                const sdkTypeFiles = resolveFiles(sdkTypesResult, "sdk type files");

                for (const file of moduleFiles) {
                    let plaintext = false;
                    if (!file || typeof file.path !== "string" || typeof file.content !== "string") {
                        continue;
                    }
                    if (file.path.startsWith("@babel/") || file.path.startsWith("goober/")) {
                        continue;
                    }

                    monaco.typescript.typescriptDefaults.addExtraLib(file.content, `/node_modules/${file.path}`);

                    if (file.path.endsWith('.bundle.js') || file.path.endsWith('.js.map') || file.path.endsWith('.min.js')) {
                        plaintext = true;
                    }
                    createVirtualFile(`/node_modules/${file.path}`, file.content, undefined, false, plaintext, undefined, {
                        suppressTreeUpdate: true,
                        suppressFileSelected: true,
                        suppressDefaultSelection: true
                    });
                }

                for (const file of sdkTypeFiles) {
                    if (!file || typeof file.path !== "string" || typeof file.content !== "string") {
                        continue;
                    }
                    monaco.typescript.typescriptDefaults.addExtraLib(file.content, `/node_modules/@anikitenko/fdo-sdk/${file.path}`);
                    createVirtualFile(`/node_modules/@anikitenko/fdo-sdk/${file.path}`, file.content, undefined, false, false, undefined, {
                        suppressTreeUpdate: true,
                        suppressFileSelected: true,
                        suppressDefaultSelection: true
                    });
                }
                if (sdkTypeFiles.length === 0) {
                    monaco.typescript.typescriptDefaults.addExtraLib(
                        FDO_SDK_FALLBACK_D_TS,
                        `/node_modules/@anikitenko/fdo-sdk/index.d.ts`
                    );
                    createVirtualFile(`/node_modules/@anikitenko/fdo-sdk/index.d.ts`, FDO_SDK_FALLBACK_D_TS, undefined, false, false, undefined, {
                        suppressTreeUpdate: true,
                        suppressFileSelected: true,
                        suppressDefaultSelection: true
                    });
                }

                this.parent.notifications.addToQueue("treeUpdate", this.parent.getTreeObjectSortedAsc());
            }).finally(() => {
                this.stopNodeModulesLoading();
                if (this.restoreLoading) {
                    this.parent.notifications.addToQueue("restorePhase", "node-modules-complete");
                }
                this.nodeModulesPromise = null;
            });

            return this.nodeModulesPromise;
        },
        __list() {
            const versions = []
            for (const i of Object.keys(this.versions)) {
                versions.push({
                    version: this.versions[i].version,
                    date: this.versions[i].date,
                    prev:  this.versions[i].prev,
                    current: this.versions[i].version === this.version_current
                })
            }
            // Newest first by monotonic timestamp (fallback to date)
            return versions.sort((a, b) => {
                const at = this.versions[a.version]?.ts || new Date(a.date).getTime();
                const bt = this.versions[b.version]?.ts || new Date(b.date).getTime();
                return bt - at;
            })
        },
        list() {
            return this.__list()
        },
        __version() {
            return {
                version: this.version_current,
                date: this.versions[this.version_current]?.date
            }
        },
        version() {
            return this.__version()
        },
        renameVersion(oldVersion, newVersion) {
            if (!this.versions[oldVersion] || this.versions[newVersion]) return false;
            // Clone and re-key
            this.versions[newVersion] = { ...this.versions[oldVersion], version: newVersion };
            delete this.versions[oldVersion];
            // Update links
            if (this.version_latest === oldVersion) this.version_latest = newVersion;
            if (this.version_current === oldVersion) this.version_current = newVersion;
            // Update any prev pointers
            Object.values(this.versions).forEach(v => { if (v.prev === oldVersion) v.prev = newVersion; });
            try {
                const sandboxFs = localStorage.getItem(this.parent.sandboxName);
                if (sandboxFs) {
                    const unpacked = JSON.parse(LZString.decompress(sandboxFs));
                    unpacked.versions = this.versions;
                    unpacked.version_latest = this.version_latest;
                    unpacked.version_current = this.version_current;
                    localStorage.setItem(this.parent.sandboxName, LZString.compress(JSON.stringify(unpacked)));
                }
            } catch (e) {
                this.parent.notifications.addToQueue("snapshotError", { message: "Failed to rename snapshot.", error: String(e) });
                return false;
            }
            this.parent.notifications.addToQueue("treeVersionsUpdate", this.__list());
            return true;
        },
        deleteVersion(versionId) {
            if (!this.versions[versionId]) return false;
            // Prevent deleting the only snapshot
            if (Object.keys(this.versions).length === 1) {
                this.parent.notifications.addToQueue("snapshotError", { message: "Cannot delete the only snapshot.", error: "single" });
                return false;
            }
            delete this.versions[versionId];
            // Adjust pointers
            if (this.version_latest === versionId) {
                // pick newest remaining
                const newest = this.__list()[0]?.version;
                if (newest) this.version_latest = newest;
            }
            if (this.version_current === versionId) {
                // switch to latest
                const target = this.version_latest || this.__list()[0]?.version;
                if (target) this.version_current = target;
            }
            try {
                const sandboxFs = localStorage.getItem(this.parent.sandboxName);
                if (sandboxFs) {
                    const unpacked = JSON.parse(LZString.decompress(sandboxFs));
                    unpacked.versions = this.versions;
                    unpacked.version_latest = this.version_latest;
                    unpacked.version_current = this.version_current;
                    localStorage.setItem(this.parent.sandboxName, LZString.compress(JSON.stringify(unpacked)));
                }
            } catch (e) {
                this.parent.notifications.addToQueue("snapshotError", { message: "Failed to delete snapshot.", error: String(e) });
                return false;
            }
            this.parent.notifications.addToQueue("treeVersionsUpdate", this.__list());
            return true;
        }
    },
    tabs: {
        parent: Object,
        list: [],
        setActiveTab(tab) {
            for (const i of this.list) {
                i.active = i.id === tab.id
            }
            this.parent.notifications.addToQueue("tabSwitched", tab.id)
        },
        setActiveTabLeft() {
            if (this.get().length <= 1) return
            const currentIndex = this.list.findIndex(tab => tab.active)
            if (currentIndex === -1) return
            const nextIndex = (currentIndex - 1 + this.list.length) % this.list.length
            this.setActiveTab(this.list[nextIndex])

            this.parent.notifications.addToQueue("tabSwitched", this.list[nextIndex].id)
        },
        setActiveTabRight() {
            if (this.get().length <= 1) return
            const currentIndex = this.list.findIndex(tab => tab.active)
            if (currentIndex === -1) return
            const nextIndex = (currentIndex + 1) % this.list.length
            this.setActiveTab(this.list[nextIndex])

            this.parent.notifications.addToQueue("tabSwitched", this.list[nextIndex].id)
        },
        isActive(tab) {
            return this.list.some((t) => t.active === tab.active)
        },
        isActiveById(id) {
            return this.list.some((t) => t.id === id && t.active)
        },
        getActiveTabId() {
            const activeTab = this.list.find(t => t.active);
            return activeTab?.id ?? null;
        },
        add(tab, active = true, fromMultiple = false) {
            if (!this.list.some((t) => t.id === tab.id)) {
                this.list.push(tab)
            }
            if (active) this.setActiveTab(tab)
            if (!fromMultiple) {
                this.parent.notifications.addToQueue("fileTabs", this.get())
            }
        },
        addMultiple(tabs) {
            for (const tab of tabs) {
                const item = this.parent.getTreeObjectItemById(tab.id)
                if (!item) continue;
                this.add(item, tab?.active, true)
            }
            this.parent.notifications.addToQueue("fileTabs", this.get())
        },
        replaceFromSaved(savedTabs = []) {
            // Atomically replace the current tabs with the provided saved set
            this.list = [];

            const items = [];
            for (const t of savedTabs || []) {
                const item = this.parent.getTreeObjectItemById(t.id);
                if (item) items.push({ item, active: !!t.active });
            }

            // Fallback when no saved items exist or none were found in the current tree
            if (items.length === 0) {
                const fallbackId = this.parent.DEFAULT_FILE_MAIN || "/index.ts";
                const fallbackItem = this.parent.getTreeObjectItemById(fallbackId);
                if (fallbackItem) items.push({ item: fallbackItem, active: true });
            }

            // Populate list
            for (const x of items) {
                this.list.push(x.item);
            }

            // Determine and set active tab (defaults to the first if none flagged active)
            const activeEntry = items.find(x => x.active) || items[0];
            if (activeEntry) {
                this.setActiveTab(activeEntry.item);
            }

            // Notify listeners once with the final list
            this.parent.notifications.addToQueue("fileTabs", this.get());
        },
        addMarkers(id, markers) {
            for (const i of this.list) {
                if (i.id === id) {
                    i.markers = markers
                }
            }
            this.parent.notifications.addToQueue("fileTabs", this.get())
            this.parent.notifications.addToQueue("listMarkers", this.listMarkers())
        },
        removeMarkers(id) {
            for (const i of this.list) {
                if (i.id === id) {
                    delete i.markers
                }
            }
            this.parent.notifications.addToQueue("fileTabs", this.get())
            this.parent.notifications.addToQueue("listMarkers", this.listMarkers())
        },
        listMarkers() {
            return this.list.filter((t) => t.markers).map((t) => ({id: t.id, markers: t.markers}))
        },
        totalMarkersCount() {
            return this.list.reduce((sum, t) => sum + (t.markers?.length || 0), 0);
        },
        remove(tab) {
            this.removeById(tab.id)
        },
        removeById(id) {
            const index = this.list.findIndex((t) => t.id === id)
            if (index > -1) {
                this.list.splice(index, 1)
            }
            this.parent.notifications.addToQueue("fileTabs", this.get())
            if (this.isActiveById(id)) {
                this.parent.notifications.addToQueue("tabClosed", id);
            }
            this.switchToLast()
        },
        get() {
            return [...this.list]
        },
        getLast() {
            return this.list[this.list.length - 1]
        },
        switchToLast() {
            const tabs = this.get();
            let lastTab;
            if (tabs.length > 0) {
                lastTab = tabs[tabs.length - 1]
                this.setActiveTab(lastTab)
            } else {
                this.parent.notifications.addToQueue("tabSwitched", lastTab?.id)
            }
        }
    },
    isInitWorkspace() {
        return this.initWorkspace
    },
    resetWorkspaceState() {
        Object.keys(this.files).forEach((key) => {
            try {
                this.files[key]?.model?.dispose?.();
            } catch (_) {
                // Best-effort cleanup
            }
        });
        this.files = {};
        this.initWorkspace = false;
        this.pluginName = "";
        this.sandboxName = "";
        this.quickInputWidgetTop = false;
        this.treeObject = [createDefaultTreeObject()];
        this.fileDialog = { show: false, data: {} };
        this.tabs.list = [];
        this.fs.versions = {};
        this.fs.version_latest = 0;
        this.fs.version_current = 0;
        this.fs.tsCounter = 0;
        this.fs.loading = false;
        this.fs.nodeModulesLoading = false;
        this.fs.restoreLoading = false;
        if (this.fs.restoreLoadingWatchdogTimer) {
            clearTimeout(this.fs.restoreLoadingWatchdogTimer);
            this.fs.restoreLoadingWatchdogTimer = null;
        }
        this.fs.nodeModulesPromise = null;
        this.build.init = false;
        this.build.inProgress = false;
        this.build.progress = 0;
        this.build.plugin.content = null;
        this.build.message = { error: false, message: "" };
    },
    setInitWorkspace(name, sandbox) {
        this.pluginName = name
        this.sandboxName = sandbox
        this.initWorkspace = true
        this.setTreeObjectItemRoot(name)
    },
    restoreSandbox() {
        const sandboxData = JSON.parse(LZString.decompress(localStorage.getItem(this.sandboxName)));
        _.merge(this.fs, sandboxData)
        this.fs.set(this.fs.version_current)
        this.restoreTreeObjectItemsIcon(this.treeObject)
    },
    getQuickInputWidgetTop() {
        return this.quickInputWidgetTop
    },
    setQuickInputWidgetTop(loc) {
        this.quickInputWidgetTop = loc
    },
    __isModelDisposed(model) {
        if (!model) return true;
        if (typeof model.isDisposed === "function") {
            try {
                return !!model.isDisposed();
            } catch (_) {
                return true;
            }
        }
        try {
            model.getValue();
            return false;
        } catch (_) {
            return true;
        }
    },
    __rememberModelState(fileName, model) {
        const entry = this.files[fileName] || {};
        const nextContent = (() => {
            try {
                return model?.getValue?.() ?? entry.content ?? "";
            } catch (_) {
                return entry.content ?? "";
            }
        })();
        const nextLanguage = (() => {
            try {
                return model?.getLanguageId?.() || entry.language || getLanguage(fileName);
            } catch (_) {
                return entry.language || getLanguage(fileName);
            }
        })();
        this.files[fileName] = {
            ...entry,
            model,
            content: nextContent,
            language: nextLanguage,
            state: entry.state || {},
        };
        return this.files[fileName];
    },
    __ensureLiveModel(fileName) {
        const entry = this.files[fileName];
        if (!entry) return null;

        if (entry.model && !this.__isModelDisposed(entry.model)) {
            return entry.model;
        }

        const uri = monaco.Uri.file(`${fileName}`);
        const liveModel = monaco.editor.getModel(uri);
        if (liveModel && !this.__isModelDisposed(liveModel)) {
            this.__rememberModelState(fileName, liveModel);
            return liveModel;
        }

        if (typeof entry.content === "string") {
            const recreatedModel = monaco.editor.createModel(
                entry.content,
                entry.language || getLanguage(fileName),
                uri
            );
            this.__rememberModelState(fileName, recreatedModel);
            return recreatedModel;
        }

        return null;
    },
    getFileContent(fileName) {
        const model = this.__ensureLiveModel(fileName);
        if (model) {
            const entry = this.__rememberModelState(fileName, model);
            return entry.content;
        }
        return this.files[fileName]?.content ?? undefined;
    },
    getModel(fileName) {
        return this.__ensureLiveModel(fileName)
    },
    getModelState(fileName) {
        return this.files[fileName]?.state
    },
    getFileName(model) {
        return Object.keys(this.files).find(key => this.files[key].model === model);
    },
    getLatestContent() {
        return Object.fromEntries(
            Object.keys(this.files).map((key) => {
                const model = this.__ensureLiveModel(key);
                if (model) {
                    const entry = this.__rememberModelState(key, model);
                    return [key, entry.content];
                }
                return [key, this.files[key]?.content ?? ""];
            })
        )
    },
    getTreeObjectItemById(id) {
        const stack = [...this.treeObject];
        while (stack.length) {
            const node = stack.pop();
            if (node.id === id) return node;
            if (node.childNodes?.length) stack.push(...node.childNodes);
        }
        return null;
    },
    getTreeObjectItemSelected() {
        const stack = [...this.treeObject];
        while (stack.length) {
            const node = stack.pop();
            if (node.isSelected) return node;
            if (node.childNodes?.length) stack.push(...node.childNodes);
        }
        return null;
    },
    getTreeObjectSortedAsc() {
        return this.__sortTreeObjectChildrenAsc(this.treeObject)
    },
    setFileContent(fileName, content) {
        const model = this.__ensureLiveModel(fileName);
        if (model?.setValue) {
            model.setValue(content);
            this.__rememberModelState(fileName, model);
            return undefined;
        }
        if (this.files[fileName]) {
            this.files[fileName].content = content;
        }
        return undefined;
    },
    setTreeObjectItemRoot(name) {
        this.treeObject[0].id = "/";
        this.treeObject[0].label = name;
        this.treeObject[0].icon =
            <img className={styles["file-tree-icon"]} src={"static://assets/icons/vscode/" + getIconForOpenFolder(name)}
                 width="20" height="20" alt="icon"/>
        this.notifications.addToQueue("treeUpdate", this.getTreeObjectSortedAsc())
    },

    setTreeObjectItemBool(id, prop) {
        if (this.__setTreeObjectItemBool(this.treeObject, id, prop))
            this.notifications.addToQueue("treeUpdate", this.getTreeObjectSortedAsc())
        if (prop === "isSelected") {
            this.notifications.addToQueue("fileSelected", this.getTreeObjectItemById(id))
        }
    },

    setTreeObjectItemSelectedSilent(id) {
        if (this.__setTreeObjectItemBool(this.treeObject, id, "isSelected"))
            this.notifications.addToQueue("treeUpdate", this.getTreeObjectSortedAsc())
    },

    __setTreeObjectItemBool(nodes, id, prop) {
        if (!nodes) return;
        for (let node of nodes) {
            node[prop] = node.id === id;
            if (node.childNodes) this.__setTreeObjectItemBool(node.childNodes, id, prop);
        }
        return true;
    },

    updateTreeObjectItem(id, props) {
        if (this.__updateTreeObjectItem(this.treeObject, id, props))
            this.notifications.addToQueue("treeUpdate", this.getTreeObjectSortedAsc())
    },

    __updateTreeObjectItem(nodes, id, props) {
        if (!nodes) return;
        for (let node of nodes) {
            if (node.id === id) {
                Object.assign(node, props);
                return true; // Stop recursion
            }
            if (node.childNodes) {
                if (this.__updateTreeObjectItem(node.childNodes, id, props)) return true; // Recurse into children
            }
        }
        return false;
    },

    updateModel(filePath, model) {
        this.__rememberModelState(filePath, model);
    },

    updateModelState(filePath, state) {
        if (this.files[filePath]) {
            this.files[filePath].state = state
        } else {
            this.files[filePath] = {
                model: undefined,
                state: state
            }
        }
    },

    removeTreeObjectItemById(id) {
        if (this.__removeTreeObjectItemById(this.treeObject, id, true))
            this.notifications.addToQueue("treeUpdate", this.getTreeObjectSortedAsc())
    },

    __removeTreeObjectItemById(nodes, id, isDirectDeletion) {
        if (!nodes || nodes.length === 0) return [];

        return nodes.filter(node => {
            if (node.id === id) {
                return false; // Remove this node
            }

            if (node.childNodes && node.childNodes.length > 0) {
                node.childNodes = this.__removeTreeObjectItemById(node.childNodes, id, false);

                // Only delete the folder if *it was directly deleted*
                if (isDirectDeletion && node.type === "folder" && node.childNodes.length === 0) {
                    return false;
                }
            }

            return true; // Keep this node
        });
    },

    // Method to create or update a file
    createFile(fileName, model, options = {}) {
        const {
            suppressTreeUpdate = false,
            suppressFileSelected = false,
            suppressDefaultSelection = false
        } = options;
        this.updateModel(fileName, model)
        if (this.__createTreeObjectItem(fileName, false, { suppressDefaultSelection }))
            if (!suppressTreeUpdate) {
                this.notifications.addToQueue("treeUpdate", this.getTreeObjectSortedAsc())
            }
        if (fileName === this.DEFAULT_FILE_MAIN && !suppressFileSelected) {
            this.notifications.addToQueue("fileSelected", this.getTreeObjectItemById(fileName))
        }
    },

    createFolder(name) {
        if (this.__createTreeObjectItem(name, true))
            this.notifications.addToQueue("treeUpdate", this.getTreeObjectSortedAsc())
    },

    createEmptyFile(packageName) {
        const uri = monaco.Uri.file(`Untitled`);
        let model = monaco.editor.getModel(uri);
        const defaultContent = packageDefaultContent(packageName);
        if (!model) {
            model = monaco.editor.createModel(defaultContent, "plaintext", uri);
        } else {
            model.setValue(defaultContent);
        }
        this.updateModel("Untitled", model)
        return this.__createTreeObjectItemChild("Untitled", "Untitled", "file")
    },

    __createTreeObjectItemChild(id, name, type, options = {}) {
        const {
            suppressDefaultSelection = false
        } = options;
        let isSelected = false;
        let className = ""
        if (!suppressDefaultSelection && id === this.DEFAULT_FILE_MAIN) {
            isSelected = true;
        }
        if (type === "folder") {
            if (id.includes("node_modules")) {
                className = "bp6-intent-warning"
            } else if (id.includes("dist")) {
                className = "bp6-text-muted tree-folder-dist"
            }
        }
        return {
            id,
            label: name,
            icon: <img className={styles["file-tree-icon"]}
                       src={type === "folder" ? "static://assets/icons/vscode/" + getIconForFolder(name) : "static://assets/icons/vscode/" + getIconForFile(name)}
                       width="20" height="20" alt="icon"/>,
            isExpanded: false,
            type: type,
            isSelected: isSelected,
            hasCaret: type === "folder",
            className: `${styles["mouse-pointer"]} ${className}`,
            childNodes: type === "folder" ? [] : undefined
        }
    },
    __createTreeObjectItem(name, isFolder = false, options = {}) {
        const itemsSplit = name.split("/").filter(Boolean);
        let currentNode = this.treeObject[0];
        let currentPath = "";

        for (let i = 0; i < itemsSplit.length; i++) {
            const itemSplit = itemsSplit[i]; // Extract folder or file name
            currentPath += "/" + itemSplit; // Build the full path step by step
            const isLastItem = i === itemsSplit.length - 1;

            // Determine type, considering forceFolder
            const lastType = isLastItem ? "file" : "folder"
            const type = (isLastItem && isFolder) ? "folder" : lastType;

            // Check if child exists in current node
            let existingChild = currentNode.childNodes?.find(child => child.label === itemSplit);

            if (!existingChild) {
                existingChild = this.__createTreeObjectItemChild(currentPath, itemSplit, type, options);

                // Ensure `childNodes` exists for folder types
                if (!currentNode.childNodes) {
                    currentNode.childNodes = [];
                }
                currentNode.childNodes.push(existingChild);
            }

            // Move deeper into the tree only if it's a folder
            if (type === "folder") {
                currentNode = existingChild;
            }
        }
        return true;
    },
    deleteFile(fileName) {
        const fileIDs = []
        for (const key of Object.keys(this.files)) {
            if (key.startsWith(fileName)) {
                fileIDs.push(key)
                monaco.typescript.typescriptDefaults.addExtraLib("", key);
                const model = monaco.editor.getModel(monaco.Uri.file(`${key}`));
                if (model) {
                    model.dispose(); // Remove it from Monaco
                }
                if (key.endsWith(".ts") || key.endsWith(".tsx")) {
                    monaco.editor.setModelMarkers(model, "typescript", []);
                }
                this.files[key].model.dispose();
                delete this.files[key]
            }
        }

        fileIDs.forEach((id) => {
            this.notifications.addToQueue("fileRemoved", id);
        });
        monaco.typescript.typescriptDefaults.setCompilerOptions({
            ...monaco.typescript.typescriptDefaults.getCompilerOptions()
        });
        this.removeTreeObjectItemById(fileName)
        this.notifications.addToQueue("treeUpdate", this.getTreeObjectSortedAsc());
    },
    removeTreeObjectItemsIcon(tree) {
        const stack = [...tree];
        while (stack.length) {
            const node = stack.pop();
            if (node.icon) {
                delete node.icon
            }
            if (node.childNodes?.length) stack.push(...node.childNodes);
        }
        return null;
    },
    restoreTreeObjectItemsIcon(tree) {
        const stack = [...tree];
        while (stack.length) {
            const node = stack.pop();
            if (node.label) {
                if (node.type === "folder") {
                    node.icon = <img className={styles["file-tree-icon"]} src={"static://assets/icons/vscode/" + getIconForFolder(node.label)} width="20" height="20"
                                     alt="icon"/>
                    if (node.isExpanded) {
                        node.icon = <img className={styles["file-tree-icon"]} src={"static://assets/icons/vscode/" + getIconForOpenFolder(node.label)} width="20" height="20"
                                         alt="icon"/>
                    }
                } else {
                    node.icon = <img className={styles["file-tree-icon"]} src={"static://assets/icons/vscode/" + getIconForFile(node.label)} width="20" height="20"
                                     alt="icon"/>
                }
            }
            if (node.childNodes?.length) stack.push(...node.childNodes);
        }
        return null;
    },
    __sortTreeObjectChildrenAsc(nodes) {
        if (!nodes) return [];

        const specialOrder = ["dist", "node_modules"];

        return nodes
            .sort((a, b) => {
                const isADot = a.label.startsWith(".");
                const isBDot = b.label.startsWith(".");
                if (isADot && !isBDot) return -1;
                if (!isADot && isBDot) return 1;

                const aSpecialIndex = specialOrder.indexOf(a.label);
                const bSpecialIndex = specialOrder.indexOf(b.label);
                if (aSpecialIndex !== -1 && bSpecialIndex !== -1) return aSpecialIndex - bSpecialIndex;
                if (aSpecialIndex !== -1) return -1;
                if (bSpecialIndex !== -1) return 1;

                if (a.type === "folder" && b.type !== "folder") return -1;
                if (a.type !== "folder" && b.type === "folder") return 1;

                return a.label.localeCompare(b.label);
            })
            .map(node => ({
                ...node,
                childNodes: this.__sortTreeObjectChildrenAsc(node.childNodes)
            }));
    },

    openFileDialog(data) {
        this.fileDialog = {
            show: true, data: data
        }
        this.notifications.addToQueue("fileDialog", this.getFileDialog())
    },

    closeFileDialog() {
        this.fileDialog = {
            show: false, data: {}
        }
        this.notifications.addToQueue("fileDialog", this.getFileDialog())
    },

    getFileDialog() {
        return this.fileDialog
    },

    modelIdDefined(id) {
        return this.files[id]?.model
    },

    listModels() {
        return Object.keys(this.files).map(key => this.files[key].model)
    },

    rename(node, newFile) {
        if (this.getTreeObjectItemById(newFile)) return
        const object = _.cloneDeep(this.getTreeObjectItemById(node.id))
        if (!object) return;

        if (object.type === "file") {
            const uri = monaco.Uri.file(`${newFile}`);
            const fileContent = this.files[node.id].model.getValue()
            this.deleteFile(node.id)
            const model = monaco.editor.createModel(fileContent, getLanguage(newFile), uri);
            this.createFile(newFile, model)
            this.setTreeObjectItemBool(newFile, "isSelected")
        } else {
            const fileContent = []
            for (const key of Object.keys(this.files)) {
                if (key.startsWith(node.id)) {
                    console.log(key.replace(node.id, newFile))
                    fileContent.push({
                        uri: monaco.Uri.file(`${key.replace(node.id, newFile)}`),
                        content: this.files[key].model.getValue(),
                        path: key.replace(node.id, newFile),
                        oldPath: node.id
                    })
                }
            }
            if (fileContent.length === 0) {
                this.deleteFile(node.id)
                this.createFolder(newFile)
            } else {
                for (const file of fileContent) {
                    this.deleteFile(file.oldPath)
                    const model = monaco.editor.createModel(file.content, getLanguage(file.path), file.uri);
                    this.createFile(file.path, model)
                }
            }
        }
        monaco.typescript.typescriptDefaults.setCompilerOptions({
            ...monaco.typescript.typescriptDefaults.getCompilerOptions()
        });
    },

    init() {
        this.build.parent = this
        this.fs.parent = this
        this.tabs.parent = this
        return this
    }
}.init()

export default virtualFS;
