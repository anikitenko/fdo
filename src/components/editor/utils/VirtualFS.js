import {getIconForFile, getIconForFolder, getIconForOpenFolder} from "vscode-icons-js";
import * as monaco from "monaco-editor";
import {packageDefaultContent} from "./packageDefaultContent";

const virtualFS =  {
    DEFAULT_FILE: "/index.ts",
    files: {},
    name: "",
    fileDialog: {
        show: false, data: {}
    },
    treeObject: [{
        id: "/",
        label: "/",
        type: "folder",
        isExpanded: true,
        icon: undefined,
        hasCaret: true,
        className: "mouse-pointer",
        childNodes: [],
    }],
    listeners: undefined, // Store React state setters
    // Notify subscribers of a specific event
    notify(event, data) {
        if (this.listeners.has(event)) {
            this.listeners.get(event).forEach(callback => callback(data));
        }
    },

    // Subscribe to a specific event (e.g., "treeUpdate", "fileUpdate")
    subscribe(event, callback) {
        if (!this.listeners) this.listeners = new Map();
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event).add(callback);
        return () => this.listeners.get(event)?.delete(callback); // Unsubscribe
    },
    getFileContent(fileName) {
        return this.files[fileName]?.getValue() ?? undefined;
    },
    getModel(fileName) {
        return this.files[fileName]
    },
    getFileName(model) {
        return Object.keys(this.files).find(key => this.files[key] === model);
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
    setName(name) {
        this.name = name;
    },
    setFileContent(fileName, content) {
        return this.files[fileName]?.setValue(content) ?? undefined;
    },
    setTreeObjectItemRoot(name) {
        this.treeObject[0].id = "/" + name;
        this.treeObject[0].label = name;
        this.treeObject[0].icon = <img className={"file-tree-icon"} src={"/assets/icons/vscode/" + getIconForOpenFolder(name)} width="20" height="20" alt="icon"/>
        this.notify("treeUpdate", this.getTreeObjectSortedAsc())
    },

    setTreeObjectItemBool(id, prop) {
        if (this.__setTreeObjectItemBool(this.treeObject, id, prop))
            this.notify("treeUpdate", this.getTreeObjectSortedAsc())
        if (prop === "isSelected") {
            this.notify("fileSelected", this.getTreeObjectItemById(id))
        }
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
            this.notify("treeUpdate", this.getTreeObjectSortedAsc())
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

    removeTreeObjectItemById(id) {
        if (this.__removeTreeObjectItemById(this.treeObject, id))
            this.notify("treeUpdate", this.getTreeObjectSortedAsc())
    },

    __removeTreeObjectItemById(nodes, id) {
        if (!nodes) return false;

        for (let i = 0; i < nodes.length; i++) {
            if (nodes[i].id === id) {
                nodes.splice(i, 1); // Remove node
                return true;
            }
            if (nodes[i].childNodes) {
                if (this.__removeTreeObjectItemById(nodes[i].childNodes, id)) return true; // Recurse into children
            }
        }
        return false;
    },

    // Method to create or update a file
    createFile(fileName, model) {
        this.files[fileName] = model;
        if (this.__createTreeObjectItem(fileName))
            this.notify("treeUpdate", this.getTreeObjectSortedAsc())
        if (fileName === this.DEFAULT_FILE) {
            this.notify("fileSelected", this.getTreeObjectItemById(fileName))
        }
    },

    createEmptyFile(packageName) {
        const uri = monaco.Uri.parse(`file://Untitled`);
        let model = monaco.editor.getModel(uri);
        const defaultContent = packageDefaultContent(packageName);
        if (!model) {
            model = monaco.editor.createModel(defaultContent, "plaintext", uri);
        } else {
            model.setValue(defaultContent);
        }
        this.files["Untitled"] = model;
        return this.__createTreeObjectItemChild("Untitled", "Untitled", "file")
    },

    __createTreeObjectItemChild(id, name, type) {
        let isSelected = false;
        let className = ""
        if (name === this.DEFAULT_FILE && type === "file") {
            isSelected = true;
        }
        if (type === "folder" && id.includes("node_modules")) {
            className = "bp5-intent-warning"
        }
        return {
            id,
            label: name,
            icon: <img className={"file-tree-icon"} src={type === "folder" ? "/assets/icons/vscode/" + getIconForFolder(name) : "/assets/icons/vscode/" + getIconForFile(name)} width="20" height="20" alt="icon"/>,
            isExpanded: false,
            type: type,
            isSelected: isSelected,
            hasCaret: type === "folder",
            className: "mouse-pointer "+className,
            childNodes: type === "folder" ? [] : undefined
        }
    },
    __createTreeObjectItem(name) {
        const itemsSplit = name.split("/").filter(Boolean);
        let currentNode = this.treeObject[0];
        let currentPath = "";
        for (let i = 0; i < itemsSplit.length; i++) {
            const itemSplit = itemsSplit[i]; // Extract folder or file name
            currentPath += "/" + itemSplit; // Build the full path step by step
            const isLastItem = i === itemsSplit.length - 1;
            const type = isLastItem ? "file" : "folder";

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
        return true
    },
    __sortTreeObjectChildrenAsc(nodes) {
        if (!nodes) return [];
        return nodes
            .sort((a, b) => {
                // Folders come first
                if (a.type === "folder" && b.type !== "folder") return -1;
                if (a.type !== "folder" && b.type === "folder") return 1;
                // Sort alphabetically within their type
                return a.label.localeCompare(b.label);
            })
            .map(node => ({
                ...node,
                childNodes: this.__sortTreeObjectChildrenAsc(node.childNodes) // Recursively sort children
            }));
    },

    openFileDialog(data) {
        this.fileDialog = {
            show: true, data: data
        }
        this.notify("fileDialog", this.getFileDialog())
    },

    closeFileDialog() {
        this.fileDialog = {
            show: false, data: {}
        }
        this.notify("fileDialog", this.getFileDialog())
    },

    getFileDialog() {
        return this.fileDialog
    }
}

export default virtualFS;
