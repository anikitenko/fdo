export class VirtualFS {
    // Static property to hold the singleton instance
    static instance = null;

    // Private constructor to prevent direct instantiation
    constructor() {
        if (!VirtualFS.instance) {
            // Initialize the 'files' property only when an instance is created
            this.files = {};  // Initialize the file storage as an empty object
            VirtualFS.instance = this;  // Store the singleton instance
        }

        // If the instance already exists, do not throw an error.
        return VirtualFS.instance;
    }

    // Method to get the file content
    getFileContent(fileName) {
        return this.files[fileName]?.getValue() ?? undefined;
    }

    getModel(fileName) {
        return this.files[fileName]
    }

    getFileName(model) {
        return Object.keys(this.files).find(key => this.files[key] === model);
    }

    setFileContent(fileName, content) {
        return this.files[fileName]?.setValue(content) ?? undefined;
    }

    // Method to create or update a file
    createFile(fileName, model) {
        this.files[fileName] = model;  // Store the file content
    }

    // Optionally, a method to list all files
    listFiles() {
        return Object.keys(this.files);
    }
}