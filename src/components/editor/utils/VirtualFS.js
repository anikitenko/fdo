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

const defaultTreeObject = {
    id: "/",
    label: "/",
    type: "folder",
    isExpanded: true,
    icon: undefined,
    hasCaret: true,
    className: styles["mouse-pointer"],
    childNodes: [],
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
    treeObject: [defaultTreeObject],
    notifications: {
        queue: [],
        processing: false,
        listeners: undefined,
        _pendingTreeLoading: null,
        _rafScheduled: false,
        subscribe(event, callback) {
            if (!this.listeners) this.listeners = new Map();
            if (!this.listeners.has(event)) {
                this.listeners.set(event, new Set());
            }
            this.listeners.get(event).add(callback);
            return () => this.listeners.get(event)?.delete(callback); // Unsubscribe
        },
        addToQueue(eventType, data) {
            // Coalesce treeLoading notifications to one per frame
            if (eventType === "treeLoading") {
                this._pendingTreeLoading = data;
                if (!this._rafScheduled) {
                    this._rafScheduled = true;
                    const self = this; // Capture context explicitly
                    requestAnimationFrame(() => {
                        self.__dispatch("treeLoading", self._pendingTreeLoading);
                        self._pendingTreeLoading = null;
                        self._rafScheduled = false;
                    });
                }
                return;
            }

            this.queue.push({eventType, data});
            if (!this.processing) {
                Promise.resolve().then(() => this.__startProcessing());
            }
        },
        async __startProcessing() {
            if (this.processing) return; // Prevent multiple instances

            this.processing = true;
            while (this.queue.length > 0) {
                const {eventType, data} = this.queue.shift();
                this.__dispatch(eventType, data); // Fire the event
                //console.log(`Notified: ${eventType} ->`, data);
                await this.__delay(50); // Ensure sequential execution
            }
            this.processing = false;
        },
        __dispatch(event, data) {
            if (this.listeners.has(event)) {
                this.listeners.get(event).forEach(callback => callback(data));
            }
        },
        __delay(ms) {
            return new Promise((resolve) => setTimeout(resolve, ms));
        }
    },
    build: {
        init: false,
        parent: Object,
        inProgress: false,
        progress: 0,
        plugin: {
            content: null,
        },
        message: {
            error: false,
            message: ""
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
        addMessage(message, error = false) {
            this.message = {error: error, message: message}
            if (error) {
                this.inProgress = false
            }
            this.parent.notifications.addToQueue("buildOutputUpdate", this.status())
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
        parent: Object,
        logger: null,
        loading: false,
        _loadingCount: 0,
        _operationInProgress: false, // Lock to prevent concurrent operations
        getLoading() {
            return this.loading
        },
        setLoading() {
            this._loadingCount += 1;
            if (this._loadingCount === 1) {
                this.loading = true;
                this.parent.notifications.addToQueue("treeLoading", true);
            }
        },
        stopLoading() {
            this.loading = false
            this.parent.notifications.addToQueue("treeLoading", false)
        },
        create(prevVersion = "", tabs = []) {
            this.setLoading();

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
                    state: null
                });
            });

            const date = new Date().toISOString();
            this.versions[latest] = {
                tabs: tabs,
                content: content,
                version: latest,
                prev: prevVersion,
                date: date
            };
            this.version_latest = latest;
            this.version_current = latest;

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
                const backupData = structuredClone(fs);
                localStorage.setItem(this.parent.sandboxName, LZString.compress(JSON.stringify(backupData)));
            }
            this.parent.notifications.addToQueue("treeVersionsUpdate", this.__list());

            this.stopLoading();
            return { version: latest, date: date, prev: prevVersion };
        },
        /**
         * Check browser storage quota before snapshot operations
         * Warns users at 80% usage, blocks at 95%
         * @returns {Promise<boolean>} True if operation can proceed, false if quota critical
         */
        async checkStorageQuota() {
            try {
                if ('storage' in navigator && 'estimate' in navigator.storage) {
                    const {usage, quota} = await navigator.storage.estimate();
                    const usagePercent = (usage / quota) * 100;
                    
                    if (this.logger) {
                        this.logger.logStart('quotaCheck', {
                            usage: Math.round(usage / 1024 / 1024),
                            quota: Math.round(quota / 1024 / 1024),
                            percent: usagePercent
                        });
                    }
                    
                    if (usagePercent >= 80) {
                        this.parent.notifications.addToQueue('storageWarning', {
                            usage: Math.round(usage / 1024 / 1024),
                            quota: Math.round(quota / 1024 / 1024),
                            percent: Math.round(usagePercent),
                            severity: usagePercent >= 95 ? 'critical' : 'warning'
                        });
                    }
                    
                    return usagePercent < 95;
                }
                return true; // Assume OK if API unavailable
            } catch (error) {
                if (this.logger) {
                    this.logger.logError('quotaCheck', error);
                }
                return true; // Don't block on check failure
            }
        },
        /**
         * Safely dispose a Monaco model with validation and cleanup
         * Prevents "model already disposed" errors and orphaned markers
         * @param {string} path - File path of the model to dispose
         */
        async safeDisposeModel(path) {
            try {
                const uri = monaco.Uri.file(path);
                const model = monaco.editor.getModel(uri);
                
                if (model && !model.isDisposed()) {
                    // Clear markers for TypeScript/JSX files
                    if (path.endsWith('.ts') || path.endsWith('.tsx') || path.endsWith('.js') || path.endsWith('.jsx')) {
                        monaco.editor.setModelMarkers(model, 'typescript', []);
                    }
                    
                    // Clear extra libs
                    monaco.languages.typescript.typescriptDefaults.addExtraLib('', path);
                    
                    // Dispose the model
                    model.dispose();
                    
                    if (this.logger) {
                        this.logger.logModelDisposal(path);
                    }
                }
                
                // Clean up internal tracking
                if (this.parent.files[path]) {
                    delete this.parent.files[path];
                    this.parent.notifications.addToQueue('fileRemoved', path);
                }
                
            } catch (error) {
                // Log but don't throw - continue with restoration
                if (this.logger) {
                    this.logger.logError('modelDisposal', error, { path });
                }
            }
        },
        /**
         * Persist snapshot data to localStorage with QuotaExceededError handling
         * @param {string} version - Snapshot version ID
         * @param {Object} snapshotData - Snapshot data to persist
         * @throws {AtomicOperationError} If storage quota is exceeded
         */
        async persistSnapshot(version, snapshotData) {
            try {
                const sandboxFs = localStorage.getItem(this.parent.sandboxName);
                let fsData;
                
                if (sandboxFs) {
                    // Update existing storage
                    fsData = JSON.parse(LZString.decompress(sandboxFs));
                    fsData.versions[version] = _.cloneDeep(snapshotData);
                    fsData.version_latest = version;
                    fsData.version_current = version;
                } else {
                    // Create new storage
                    fsData = {
                        versions: { [version]: _.cloneDeep(snapshotData) },
                        version_latest: version,
                        version_current: version
                    };
                }
                
                // Compress and save
                const compressed = LZString.compress(JSON.stringify(fsData));
                localStorage.setItem(this.parent.sandboxName, compressed);
                
            } catch (error) {
                // Check if quota exceeded
                if (error.name === 'QuotaExceededError' || error.code === 22) {
                    if (this.logger) {
                        this.logger.logError('persistSnapshot', error, {
                            version,
                            failurePoint: 'localStorage',
                            reason: 'Storage quota exceeded'
                        });
                    }
                    throw new AtomicOperationError(
                        'Storage quota exceeded. Cannot save snapshot.',
                        error
                    );
                }
                
                // Other errors
                if (this.logger) {
                    this.logger.logError('persistSnapshot', error, {
                        version,
                        failurePoint: 'localStorage'
                    });
                }
                throw new AtomicOperationError(
                    'Failed to persist snapshot to storage',
                    error
                );
            }
        },
        async create(prevVersion = "", tabs = []) {
            while (this._operationInProgress) {
                await new Promise(resolve => setTimeout(resolve, 25));
            }
            
            this._operationInProgress = true;
            const operationId = Math.random().toString(36).substring(7);
            console.log(`[VirtualFS.create] ========== START OPERATION ${operationId} ==========`);
            const startTime = Date.now();
            let backup = null;
            let latest = null;
            
            try {
                this.setLoading();
                
                // Check storage quota before proceeding
                const hasQuota = await this.checkStorageQuota();
                if (!hasQuota) {
                    throw new AtomicOperationError(
                        'Storage quota exceeded (>95%). Cannot create snapshot.',
                        new Error('Storage quota check failed')
                    );
                }
                
                // Capture current state for rollback
                backup = this.captureCurrentState();
                
                // Generate snapshot ID and timestamp
                latest = (Math.random() + 1).toString(36).substring(2);
                const date = new Date().toISOString();
                
                // Log operation start
                if (this.logger) {
                    this.logger.logStart('create', {
                        version: latest,
                        prevVersion,
                        tabCount: tabs.length
                    });
                }
                
                // Initialize progress tracker
                const progress = new ProgressTracker(
                    'create',
                    this.parent.notifications,
                    SNAPSHOT_STAGES.create
                );
                
                // STAGE 1: CAPTURING (40%)
                progress.startStage('CAPTURING');
                const content = [];
                const models = this.parent.listModels();
                const totalModels = models.length;
                
                models.forEach((model, index) => {
                    const modelUri = model.uri.toString(true).replace("file://", "");
                    
                    // Skip node_modules and dist folders
                    if (modelUri.includes("/node_modules/") || modelUri.includes("/dist/")) {
                        return;
                    }
                    
                    content.push({
                        id: modelUri,
                        content: model.getValue(),
                        state: null
                    });
                    
                    // Update progress within CAPTURING stage
                    if (index % 5 === 0 || index === totalModels - 1) {
                        progress.updateProgress(
                            ((index + 1) / totalModels) * 100,
                            { filesProcessed: index + 1, totalFiles: totalModels }
                        );
                    }
                });
                
                const fileCount = content.length;
                
                // STAGE 2: COMPRESSING (20%)
                progress.startStage('COMPRESSING', { fileCount });
                
                // Update in-memory state
                this.versions[latest] = {
                    tabs: tabs,
                    content: content,
                    version: latest,
                    prev: prevVersion,
                    date: date
                };
                this.version_latest = latest;
                this.version_current = latest;
                
                progress.updateProgress(100);
                
                // STAGE 3: VALIDATING (10%)
                progress.startStage('VALIDATING');
                
                // Validate snapshot data
                if (!this.versions[latest] || !Array.isArray(this.versions[latest].content)) {
                    throw new Error('Invalid snapshot data structure');
                }
                
                progress.updateProgress(100);
                
                // STAGE 4: SAVING (30%)
                progress.startStage('SAVING', { fileCount });
                
                // Persist to localStorage using the new method
                await this.persistSnapshot(latest, this.versions[latest]);
                
                progress.updateProgress(100);
                
                // Notify version list update
                this.parent.notifications.addToQueue("treeVersionsUpdate", this.__list());
                
                // Complete progress
                progress.complete({ version: latest, fileCount, duration: Date.now() - startTime });
                
                // Log completion
                if (this.logger) {
                    this.logger.logComplete('create', {
                        version: latest,
                        fileCount,
                        duration: Date.now() - startTime,
                        prevVersion
                    });
                }
                
                this.stopLoading();
                console.log(`[VirtualFS.create] ========== END OPERATION ${operationId} ==========`);
                this._operationInProgress = false;
                return { version: latest, date: date, prev: prevVersion };
                
            } catch (error) {
                // Log error
                if (this.logger) {
                    this.logger.logError('create', error, {
                        version: latest,
                        fileCount: this.parent.listModels().length,
                        failurePoint: error.message.includes('quota') ? 'storage' : 'unknown'
                    });
                }
                
                // Attempt rollback
                if (backup) {
                    await this.rollback(backup);
                }
                
                // Emit error notification
                this.parent.notifications.addToQueue('snapshotError', {
                    operation: 'create',
                    message: error.message || 'Failed to create snapshot',
                    version: latest
                });
                
                this.stopLoading();
                this._operationInProgress = false;
                
                throw error;
            }
        },
        _deferredTsOptions: null,
        _deferredNotifications: null,
        _suppressUINotifications: false, // Only suppress tree/file UI updates, not progress
        
        // NOTE: This method is only used for initial load now
        // Version switches handle notifications directly in CodeDeployActions
        emitDeferredNotifications() {
            if (this._deferredNotifications) {
                console.log('[VirtualFS] Emitting deferred notifications (initial load only)...');
                
                this.parent.notifications.addToQueue("treeUpdate", this._deferredNotifications.treeUpdate);
                
                if (this._deferredNotifications.fileSelected) {
                    this.parent.notifications.addToQueue("fileSelected", this._deferredNotifications.fileSelected);
                }
                
                this._deferredNotifications = null;
                console.log('[VirtualFS] Deferred notifications emitted');
            }
        },
        
        enableTypeScriptDiagnostics() {
            if (this._deferredTsOptions) {
                console.log('[VirtualFS] Re-enabling TypeScript diagnostics NOW...');
                monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions(this._deferredTsOptions);
                monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
                    ...monaco.languages.typescript.typescriptDefaults.getCompilerOptions()
                });
                this._deferredTsOptions = null;
                console.log('[VirtualFS] TypeScript diagnostics fully enabled');
            }
        },
        
        async set(version, options = {}) {
            while (this._operationInProgress) {
                await new Promise(resolve => setTimeout(resolve, 25));
            }
            
            this._operationInProgress = true;
            const operationId = Math.random().toString(36).substring(7);
            console.log(`[VirtualFS.set] ========== START OPERATION ${operationId} ==========`);
            const startTime = Date.now();
            let backup = null;
            
            // Track if this is initial load vs user-initiated switch
            const isInitialLoad = options.userInitiated === false;
            
            try {
                // Only show loading for user-initiated switches, NOT for initial load
                if (!isInitialLoad && !this.loading) {
                    this.setLoading();
                }
                
                // ALWAYS suppress notifications during restoration to prevent freeze
                this._suppressUINotifications = true;
                console.log(`[VirtualFS] UI notifications SUPPRESSED during restoration (${isInitialLoad ? 'initial load' : 'version switch'})`);
                
                // Validate version exists
                if (!this.versions[version]) {
                    throw new Error(`Invalid version ID: ${version}`);
                }
                
                // Capture current state for rollback
                backup = this.captureCurrentState();
                
                // Check storage quota and get metrics
                let storageInfo = { usage: null, quota: null, percent: null };
                try {
                    if ('storage' in navigator && 'estimate' in navigator.storage) {
                        const estimate = await navigator.storage.estimate();
                        console.log('[VirtualFS] Storage estimate raw:', estimate);
                        
                        if (estimate && estimate.usage !== undefined && estimate.quota !== undefined) {
                            const usageMB = Math.round(estimate.usage / (1024 * 1024));
                            const quotaMB = Math.round(estimate.quota / (1024 * 1024));
                            const percent = estimate.quota > 0 ? Math.round((estimate.usage / estimate.quota) * 100) : 0;
                            // Only include if we have actual usage data
                            storageInfo = { 
                                usage: usageMB || null,  // null if 0
                                quota: quotaMB || null,   // null if 0  
                                percent: percent || null  // null if 0
                            };
                        } else {
                            console.warn('[VirtualFS] Storage estimate missing usage/quota:', estimate);
                        }
                    }
                } catch (e) {
                    console.warn('[VirtualFS] Could not check storage quota:', e);
                }
                
                // Log operation start
                if (this.logger) {
                    this.logger.logStart('restore', {
                        version,
                        fromVersion: this.version_current,
                        fileCount: this.versions[version].content.length,
                        ...storageInfo
                    });
                }
                
                // Initialize progress tracker - don't suppress progress notifications!
                const progress = new ProgressTracker(
                    'restore',
                    this.parent.notifications,
                    SNAPSHOT_STAGES.restore
                );
                
                // STAGE 1: LOADING (10%)
                progress.startStage('LOADING', { version });
                const snapshotData = this.versions[version];
                const fileCount = snapshotData.content.length;
                progress.updateProgress(100, { fileCount });
                
                // STAGE 2: CLEANING (20%)
                progress.startStage('CLEANING', { fileCount });
                
                // Use safeDisposeModel for proper cleanup
                const filesToDispose = Object.keys(this.parent.files);
                const totalToDispose = filesToDispose.length;
                let disposedCount = 0;
                
                for (const key of filesToDispose) {
                    await this.safeDisposeModel(key);
                    disposedCount++;
                    
                    // Update progress within CLEANING stage
                    if (disposedCount % 5 === 0 || disposedCount === totalToDispose) {
                        progress.updateProgress(
                            (disposedCount / totalToDispose) * 100,
                            { disposed: disposedCount, total: totalToDispose }
                        );
                    }
                }
                
                // Validate all models disposed successfully
                const remainingFiles = Object.keys(this.parent.files);
                if (remainingFiles.length > 0) {
                    if (this.logger) {
                        this.logger.logError('restore', new Error('Cleanup incomplete'), {
                            version,
                            remainingFiles: remainingFiles.length,
                            failurePoint: 'cleanup'
                        });
                    }
                    throw new Error(`Failed to dispose ${remainingFiles.length} model(s)`);
                }
                
                // STAGE 3: RESTORING (50%)
                progress.startStage('RESTORING', { fileCount });
                
                // Reset tree
                this.parent.treeObject = [defaultTreeObject];
                this.parent.setTreeObjectItemRoot(this.parent.pluginName);
                
                // Disable TypeScript diagnostics during restoration for better performance
                const tsOptions = monaco.languages.typescript.typescriptDefaults.getDiagnosticsOptions();
                monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
                    noSemanticValidation: true,
                    noSyntaxValidation: true,
                    noSuggestionDiagnostics: true
                });
                
                console.log(`[VirtualFS] Starting restoration of ${fileCount} files...`);
                
                // Restore files one at a time with frame yields to prevent UI freeze
                let restoredCount = 0;
                
                for (const file of snapshotData.content) {
                    const startTime = performance.now();
                    const uri = monaco.Uri.file(`${file.id}`);
                    const fileContent = file.content;
                    
                    // Add TypeScript extra lib
                    monaco.languages.typescript.typescriptDefaults.addExtraLib(fileContent, file.id);
                    
                    // Create or update model
                    let model = monaco.editor.getModel(uri);
                    if (!model) {
                        model = monaco.editor.createModel(fileContent, getLanguage(file.id), uri);
                    } else {
                        model.setValue(fileContent);
                    }
                    
                    // Register file
                    this.parent.files[file.id] = {
                        model: model,
                        state: file.state
                    };
                    this.parent.createFile(file.id, model);
                    
                    restoredCount++;
                    const fileTime = performance.now() - startTime;
                    
                    console.log(`[VirtualFS] Restored ${restoredCount}/${fileCount}: ${file.id} (${fileTime.toFixed(1)}ms)`);
                    
                    // Update progress every file
                    progress.updateProgress(
                        (restoredCount / fileCount) * 100,
                        { restored: restoredCount, total: fileCount }
                    );
                    
                    // Yield to browser after EVERY file to let progress update
                    if (restoredCount < fileCount) {
                        await new Promise(resolve => setTimeout(resolve, 0));
                    }
                }
                
                console.log(`[VirtualFS] All ${fileCount} files restored, deferring TypeScript setup...`);
                
                // STAGE 4: UPDATING (20%)
                progress.startStage('UPDATING');
                
                // Update version tracking
                this.version_current = version;
                
                // Persist to localStorage
                const sandboxFs = localStorage.getItem(this.parent.sandboxName);
                if (sandboxFs) {
                    const unpacked = JSON.parse(LZString.decompress(sandboxFs));
                    unpacked.version_current = version;
                    localStorage.setItem(this.parent.sandboxName, LZString.compress(JSON.stringify(unpacked)));
                }
                
                progress.updateProgress(50);
                
                // ALWAYS defer heavy notifications (treeUpdate, fileSelected) to prevent freeze
                // Only emit treeVersionsUpdate immediately so dropdown populates
                this._deferredNotifications = {
                    treeUpdate: this.parent.getTreeObjectSortedAsc(),
                    fileSelected: this.parent.getTreeObjectItemSelected(),
                    treeVersionsUpdate: this.__list()
                };
                
                // Emit treeVersionsUpdate immediately (lightweight, just updates dropdown)
                this.parent.notifications.addToQueue("treeVersionsUpdate", this.__list());
                console.log('[VirtualFS] treeVersionsUpdate emitted, heavy notifications deferred');
                
                progress.updateProgress(100);
                
                // Complete progress
                progress.complete({ 
                    version, 
                    fileCount, 
                    duration: Date.now() - startTime 
                });
                
                // Log completion
                if (this.logger) {
                    this.logger.logComplete('restore', {
                        version,
                        fileCount,
                        duration: Date.now() - startTime,
                        fromVersion: backup.version_current
                    });
                }
                
                // ALWAYS defer TypeScript diagnostics and node modules to prevent freeze
                this._suppressUINotifications = false;
                console.log('[VirtualFS] UI notifications RE-ENABLED');
                
                this._deferredTsOptions = tsOptions;
                console.log('[VirtualFS] TypeScript diagnostics deferred until after rendering...');
                
                // Setup node modules after a delay (heavy operation)
                setTimeout(() => {
                    console.log('[VirtualFS] Setting up node modules...');
                    this.setupNodeModules();
                    console.log('[VirtualFS] Node modules ready');
                }, 100);
                
                if (isInitialLoad) {
                    // IMPORTANT: During initial load, we NEVER called setLoading(),
                    // so we should NOT call stopLoading() either to avoid unnecessary notifications
                    
                    // Space out UI updates across multiple frames
                    console.log('[VirtualFS] Opening tabs (initial load)...');
                    if (snapshotData.tabs && snapshotData.tabs.length > 0) {
                        this.parent.tabs.addMultiple(snapshotData.tabs);
                    }
                    
                    // Frame 1: Emit tree/file notifications AFTER tabs have been added
                    requestAnimationFrame(() => {
                        if (this._deferredNotifications) {
                            console.log('[VirtualFS] Emitting notifications (initial load)...');
                            this.parent.notifications.addToQueue("treeUpdate", this._deferredNotifications.treeUpdate);
                            if (this._deferredNotifications.fileSelected) {
                                this.parent.notifications.addToQueue("fileSelected", this._deferredNotifications.fileSelected);
                            }
                            this._deferredNotifications = null;
                        }
                        console.log('[VirtualFS] Initial load complete');
                    });
                    
                    // Enable TypeScript diagnostics after everything settles
                    setTimeout(() => {
                        this.enableTypeScriptDiagnostics();
                    }, 150);

              // Ensure a file is selected and visible in editor (default to index.ts)
              setTimeout(() => {
                try {
                  const selected = this.parent.getTreeObjectItemSelected();
                  if (!selected) {
                    const defaultId = this.parent.DEFAULT_FILE_MAIN;
                    const exists = this.parent.getTreeObjectItemById(defaultId);
                    if (exists) {
                      this.parent.setTreeObjectItemBool(defaultId, 'isSelected');
                    }
                  }
                } catch (_) {}
              }, 0);
                } else {
                    // For version switch, turn OFF skeleton and let CodeDeployActions handle tab restoration
                    this.stopLoading();

                    const activeTabId = this.parent.tabs.getActiveTabId() || this.parent.DEFAULT_FILE_MAIN;
                    if (typeof window !== 'undefined') {
                        window.__fdo_active_file_path = activeTabId || null;
                    }

                    try {
                        if (monaco?.editor && typeof monaco.editor.getEditors === 'function') {
                            const editors = monaco.editor.getEditors();
                            const activeModel = activeTabId ? this.parent.getModel(activeTabId) : null;
                            if (activeModel) {
                                editors.forEach((editorInstance) => {
                                    if (editorInstance?.getModel?.() !== activeModel) {
                                        editorInstance?.setModel?.(activeModel);
                                    }
                                    editorInstance?.layout?.();
                                });
                            }
                        }
                    } catch (refreshError) {
                        console.error('[VirtualFS] Failed to refresh active editor after restore:', refreshError);
                    }

                    // Ensure index.ts is selected and visible in editor after switch
                    // Use requestAnimationFrame to run after React updates complete
                    requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                            try {
                                const defaultId = this.parent.DEFAULT_FILE_MAIN;
                                const defaultNode = this.parent.getTreeObjectItemById(defaultId);
                                
                                if (defaultNode && this.parent.modelIdDefined(defaultId)) {
                                    // Always ensure index.ts is selected after version switch
                                    this.parent.setTreeObjectItemBool(defaultId, 'isSelected');
                                    console.log(`[VirtualFS] Ensured ${defaultId} selected after version switch`);
                                } else {
                                    console.warn('[VirtualFS] Could not find or select default file after switch');
                                }
                            } catch (e) {
                                console.error('[VirtualFS] Failed to auto-select file after switch:', e);
                            }
                        });
                    });
                }
                
                console.log(`[VirtualFS.set] ========== END OPERATION ${operationId} ==========`);
                this._operationInProgress = false;
                return {
                    tabs: snapshotData.tabs,
                };
                
            } catch (error) {
                // Log error
                if (this.logger) {
                    this.logger.logError('restore', error, {
                        version,
                        fileCount: this.versions[version]?.content.length || 0,
                        failurePoint: error.message.includes('Invalid version') ? 'validation' : 
                                     error.message.includes('dispose') ? 'cleanup' : 'unknown'
                    });
                }
                
                // Attempt rollback
                if (backup) {
                    await this.rollback(backup);
                }
                
                // Emit error notification
                this.parent.notifications.addToQueue('snapshotError', {
                    operation: 'restore',
                    message: error.message || 'Failed to restore snapshot',
                    version
                });
                
                // Re-enable UI notifications before stopping loading
                this._suppressUINotifications = false;
                this.stopLoading();
                this._operationInProgress = false;
                
                // Re-throw for caller to handle
                throw error;
            }
        },
        /**
         * Delete a snapshot version from storage
         * Prevents deletion of current version and updates version_latest if needed
         * @param {string} version - Version ID to delete
         * @throws {Error} If version is current, doesn't exist, or is the only version
         */
        async deleteSnapshot(version) {
            const startTime = Date.now();
            
            try {
                // Log operation start
                if (this.logger) {
                    this.logger.logStart('delete', {
                        version,
                        totalVersions: Object.keys(this.versions).length
                    });
                }
                
                // Validate version exists
                if (!this.versions[version]) {
                    throw new Error(`Cannot delete: Version '${version}' does not exist`);
                }
                
                // Prevent deletion of current version
                if (this.version_current === version) {
                    throw new Error(`Cannot delete current version '${version}'. Switch to another version first.`);
                }
                
                // Prevent deletion of last version
                if (Object.keys(this.versions).length === 1) {
                    throw new Error('Cannot delete the only remaining version');
                }
                
                // Delete from in-memory versions
                delete this.versions[version];
                
                // Update version_latest if we deleted the latest version
                if (this.version_latest === version) {
                    // Find the most recent remaining version
                    const remainingVersions = Object.values(this.versions);
                    const sortedVersions = remainingVersions.sort((a, b) => 
                        new Date(b.date) - new Date(a.date)
                    );
                    this.version_latest = sortedVersions[0].version;
                    
                    if (this.logger) {
                        this.logger.logStart('delete', {
                            message: 'Updated version_latest',
                            oldLatest: version,
                            newLatest: this.version_latest
                        });
                    }
                }
                
                // Persist to localStorage
                const sandboxFs = localStorage.getItem(this.parent.sandboxName);
                if (sandboxFs) {
                    const unpacked = JSON.parse(LZString.decompress(sandboxFs));
                    delete unpacked.versions[version];
                    
                    // Update version_latest in storage if needed
                    if (unpacked.version_latest === version) {
                        unpacked.version_latest = this.version_latest;
                    }
                    
                    localStorage.setItem(this.parent.sandboxName, LZString.compress(JSON.stringify(unpacked)));
                }
                
                // Emit UI update
                this.parent.notifications.addToQueue("treeVersionsUpdate", this.__list());
                
                // Log completion
                if (this.logger) {
                    this.logger.logComplete('delete', {
                        version,
                        duration: Date.now() - startTime,
                        remainingVersions: Object.keys(this.versions).length
                    });
                }
                
                return {
                    success: true,
                    version,
                    remainingVersions: Object.keys(this.versions).length
                };
                
            } catch (error) {
                // Log error
                if (this.logger) {
                    this.logger.logError('delete', error, {
                        version,
                        failurePoint: error.message.includes('current') ? 'validation' : 
                                     error.message.includes('exist') ? 'notFound' : 'unknown'
                    });
                }
                
                // Emit error notification
                this.parent.notifications.addToQueue('snapshotError', {
                    operation: 'delete',
                    message: error.message || 'Failed to delete snapshot',
                    version
                });
                
                // Re-throw for caller to handle
                throw error;
            }
        },
        /**
         * Setup multi-window synchronization via storage events
         * Listens for changes in other windows and updates local state
         */
        setupMultiWindowSync() {
            if (typeof window === 'undefined') return;
            
            const handleStorageEvent = (event) => {
                // Only handle changes to our sandbox
                if (event.key !== this.parent.sandboxName || !event.newValue) return;
                
                try {
                    const externalData = JSON.parse(LZString.decompress(event.newValue));
                    
                    if (this.logger) {
                        this.logger.logStart('multiWindowSync', {
                            action: 'externalChange',
                            versions: Object.keys(externalData.versions).length
                        });
                    }
                    
                    // Update local state from external changes
                    this.versions = externalData.versions;
                    this.version_latest = externalData.version_latest;
                    
                    // Check if our current version was deleted
                    if (!this.versions[this.version_current]) {
                        if (this.logger) {
                            this.logger.logStart('multiWindowSync', {
                                action: 'currentVersionDeleted',
                                oldVersion: this.version_current,
                                newVersion: this.version_latest
                            });
                        }
                        
                        // Current version was deleted in another window
                        // Update pointer but don't auto-restore (user decision)
                        this.version_current = this.version_latest;
                        
                        this.parent.notifications.addToQueue('snapshotWarning', {
                            message: 'Current version was deleted in another window. Version list updated.',
                            severity: 'warning'
                        });
                    }
                    
                    // Update version list UI
                    this.parent.notifications.addToQueue("treeVersionsUpdate", this.__list());
                    
                    if (this.logger) {
                        this.logger.logComplete('multiWindowSync', {
                            action: 'externalChange',
                            versions: Object.keys(this.versions).length,
                            currentVersion: this.version_current
                        });
                    }
                    
                } catch (error) {
                    if (this.logger) {
                        this.logger.logError('multiWindowSync', error, {
                            failurePoint: 'parseExternalData'
                        });
                    }
                }
            };
            
            // Register storage event listener
            window.addEventListener('storage', handleStorageEvent);
            
            // Store reference for cleanup (if needed later)
            this._storageEventHandler = handleStorageEvent;
            
            if (this.logger) {
                this.logger.logComplete('multiWindowSync', {
                    action: 'setup',
                    message: 'Multi-window sync initialized'
                });
            }
        },
        setupNodeModules() {
            const cssType = 'declare module "*.css" {\n' +
                '    const styles: { [className: string]: Record<string, string> };\n'+
                '    export default styles;\n' +
                '}'
            monaco.languages.typescript.typescriptDefaults.addExtraLib(cssType, `/node_modules/@types/css.d.ts`)
            createVirtualFile(`/node_modules/@types/css.d.ts`, cssType)
            // NOTE: We do NOT emit treeLoading notifications here because:
            // 1. This is a background operation (loading type definitions)
            // 2. It happens during initial load - showing skeleton would be bad UX
            // 3. Users don't need visual feedback for this internal operation
            window.electron.system.getModuleFiles().then((resultFiles) => {
                for (const file of resultFiles.files) {
                    let plaintext = false
                    if (file.path.startsWith("@babel/") || file.path.startsWith("goober/")) {
                        continue
                    }

                    monaco.languages.typescript.typescriptDefaults.addExtraLib(file.content, `/node_modules/${file.path}`)

                    if (file.path.endsWith('.bundle.js') || file.path.endsWith('.js.map') || file.path.endsWith('.min.js')) {
                        plaintext = true
                    }
                    createVirtualFile(`/node_modules/${file.path}`, file.content, undefined, false, plaintext)
                }
            })
            window.electron.system.getFdoSdkTypes().then((resultFiles) => {
                for (const file of resultFiles.files) {
                    monaco.languages.typescript.typescriptDefaults.addExtraLib(file.content, `/node_modules/@anikitenko/fdo-sdk/${file.path}`)
                    createVirtualFile(`/node_modules/@anikitenko/fdo-sdk/${file.path}`, file.content)
                }
            })
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
            return versions
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
                this.add(item, tab?.active, true)
            }
            this.parent.notifications.addToQueue("fileTabs", this.get())
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
    setInitWorkspace(name, sandbox) {
        this.pluginName = name
        this.sandboxName = sandbox
        this.initWorkspace = true
        // Initialize logger with sandbox name
        this.fs.logger = new SnapshotLogger(sandbox)
        this.setTreeObjectItemRoot(name)
        this.fs.setupNodeModules()
    },
        async restoreSandbox() {
            try {
                const sandboxData = JSON.parse(LZString.decompress(localStorage.getItem(this.sandboxName)));
                console.log('[VirtualFS] Restoring sandbox from localStorage:', {
                    versions: Object.keys(sandboxData.versions || {}),
                    version_latest: sandboxData.version_latest,
                    version_current: sandboxData.version_current
                });
                _.merge(this.fs, sandboxData)
                
                // Initial load - NO skeleton, just restore silently
                console.log('[VirtualFS] Starting initial load...');
                await this.fs.set(this.fs.version_current, { userInitiated: false })
                this.restoreTreeObjectItemsIcon(this.treeObject)
                console.log('[VirtualFS] Sandbox restored successfully');
            } catch (error) {
                console.error('[VirtualFS] Failed to restore sandbox:', error);
                throw error;
            }
        },
    getQuickInputWidgetTop() {
        return this.quickInputWidgetTop
    },
    setQuickInputWidgetTop(loc) {
        this.quickInputWidgetTop = loc
    },
    getFileContent(fileName) {
        return this.files[fileName]?.model?.getValue() ?? undefined;
    },
    getModel(fileName) {
        return this.files[fileName]?.model
    },
    getModelState(fileName) {
        return this.files[fileName]?.state
    },
    getFileName(model) {
        return Object.keys(this.files).find(key => this.files[key].model === model);
    },
    getLatestContent() {
        return Object.fromEntries(
            Object.keys(this.files).map(key => [key, this.files[key].model.getValue()])
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
        return this.files[fileName]?.model?.setValue(content) ?? undefined;
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
            if (typeof window !== 'undefined') {
                window.__fdo_active_file_path = id;
            }
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
        if (this.files[filePath]) {
            if (this.files[filePath].model) {
                this.files[filePath].model = model
            } else {
                this.files[filePath] = {
                    model: model,
                    state: {}
                }
            }
        } else {
            this.files[filePath] = {
                model: model,
                state: {}
            }
        }
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
    createFile(fileName, model) {
        this.updateModel(fileName, model)
        if (this.__createTreeObjectItem(fileName)) {
            // Only emit treeUpdate if notifications aren't suppressed
            if (!this.fs._suppressUINotifications) {
                this.notifications.addToQueue("treeUpdate", this.getTreeObjectSortedAsc())
            }
        }
        if (fileName === this.DEFAULT_FILE_MAIN) {
            // Only emit fileSelected if notifications aren't suppressed
            if (!this.fs._suppressUINotifications) {
                this.notifications.addToQueue("fileSelected", this.getTreeObjectItemById(fileName))
            }
        }
    },

    createFolder(name) {
        if (this.__createTreeObjectItem(name, true)) {
            // Only emit treeUpdate if notifications aren't suppressed
            if (!this.fs._suppressUINotifications) {
                this.notifications.addToQueue("treeUpdate", this.getTreeObjectSortedAsc())
            }
        }
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

    __createTreeObjectItemChild(id, name, type) {
        let isSelected = false;
        let className = ""
        if (id === this.DEFAULT_FILE_MAIN) {
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
    __createTreeObjectItem(name, isFolder = false) {
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
                existingChild = this.__createTreeObjectItemChild(currentPath, itemSplit, type);

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
                monaco.languages.typescript.typescriptDefaults.addExtraLib("", key);
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
        monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
            ...monaco.languages.typescript.typescriptDefaults.getCompilerOptions()
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
        monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
            ...monaco.languages.typescript.typescriptDefaults.getCompilerOptions()
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
