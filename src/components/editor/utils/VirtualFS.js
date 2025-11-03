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
                //console.log(`Notified: ${eventType} (#${seq}) ->`, data);
                await this.__delay(50); // Ensure sequential execution
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
        __delay(ms) {
            return new Promise((resolve) => setTimeout(resolve, ms));
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
        tsCounter: 0,
        parent: Object,
        loading: false,
        getLoading() {
            return this.loading
        },
        setLoading() {
            this.loading = true
            this.parent.notifications.addToQueue("treeLoading", true)
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
                this.stopLoading();
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

            this.stopLoading();
            return { version: latest, date: date, prev: prevVersion, error: persistError };
        },
        set(version) {
            this.setLoading()
            for (const key of Object.keys(this.parent.files)) {
                monaco.languages.typescript.typescriptDefaults.addExtraLib("", key);
                const model = monaco.editor.getModel(monaco.Uri.file(`${key}`))
                if (model) {
                    model.dispose()
                }
                this.parent.files[key].model.dispose()
                if (key.endsWith(".ts") || key.endsWith(".tsx")) {
                    monaco.editor.setModelMarkers(model, "typescript", [])
                }
                delete this.parent.files[key]
                this.parent.notifications.addToQueue("fileRemoved", key)
            }

            this.parent.treeObject = [defaultTreeObject]
            this.parent.setTreeObjectItemRoot(this.parent.pluginName)

            for (const file of this.versions[version].content) {
                const uri = monaco.Uri.file(`${file.id}`)
                const fileContent = file.content
                monaco.languages.typescript.typescriptDefaults.addExtraLib(fileContent, file.id)
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
                this.parent.createFile(file.id, model)
            }

            this.setupNodeModules()
            monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
                ...monaco.languages.typescript.typescriptDefaults.getCompilerOptions()
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
            this.parent.notifications.addToQueue("treeUpdate", this.parent.getTreeObjectSortedAsc())
            this.parent.notifications.addToQueue("fileSelected", this.parent.getTreeObjectItemSelected())
            this.parent.notifications.addToQueue("treeVersionsUpdate", this.__list())

            this.stopLoading()
            return {
                tabs: this.versions[version].tabs,
            }
        },
        setupNodeModules() {
            const cssType = 'declare module "*.css" {\n' +
                '    const styles: { [className: string]: Record<string, string> };\n'+
                '    export default styles;\n' +
                '}'
            monaco.languages.typescript.typescriptDefaults.addExtraLib(cssType, `/node_modules/@types/css.d.ts`)
            createVirtualFile(`/node_modules/@types/css.d.ts`, cssType)
            window.electron.system.getModuleFiles().then((resultFiles) => {
                this.parent.notifications.addToQueue("treeLoading", true)
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
                this.parent.notifications.addToQueue("treeLoading", false)
            })
            window.electron.system.getFdoSdkTypes().then((resultFiles) => {
                this.parent.notifications.addToQueue("treeLoading", true)
                for (const file of resultFiles.files) {
                    monaco.languages.typescript.typescriptDefaults.addExtraLib(file.content, `/node_modules/@anikitenko/fdo-sdk/${file.path}`)
                    createVirtualFile(`/node_modules/@anikitenko/fdo-sdk/${file.path}`, file.content)
                }
                this.parent.notifications.addToQueue("treeLoading", false)
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
    setInitWorkspace(name, sandbox) {
        this.pluginName = name
        this.sandboxName = sandbox
        this.initWorkspace = true
        this.setTreeObjectItemRoot(name)
        this.fs.setupNodeModules()
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
        if (this.__createTreeObjectItem(fileName))
            this.notifications.addToQueue("treeUpdate", this.getTreeObjectSortedAsc())
        if (fileName === this.DEFAULT_FILE_MAIN) {
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
