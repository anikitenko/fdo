import EventEmitter from "events";
import * as fs from "node:fs";

export default class JSONORM extends EventEmitter {
    constructor(filePath) {
        super();
        this.filePath = filePath;
        this.data = this._load(); // Load data into memory
    }

    // Load JSON from file
    _load() {
        if (fs.existsSync(this.filePath)) {
            try {
                const content = fs.readFileSync(this.filePath, 'utf-8');
                return JSON.parse(content);
            } catch (error) {
                console.error("Error reading JSON file:", error);
                return {}; // Return empty object if error
            }
        }
        return {}; // Return empty object if file doesn't exist
    }

    // Save JSON to file
    _save() {
        try {
            fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 4), 'utf-8');
            this.emit('update', this.data);
        } catch (error) {
            console.error("Error saving JSON file:", error);
        }
    }

    // Get all records
    getAll() {
        return this.data;
    }

    // Get a specific record by key
    get(key) {
        return this.data[key] || null;
    }

    // Add or update a record
    set(key, value) {
        this.data[key] = value;
        this._save(); // Persist changes
    }

    // Delete a record
    delete(key) {
        if (this.data[key]) {
            delete this.data[key];
            this._save(); // Persist changes
        }
    }

    // Clear all records
    clear() {
        this.data = {};
        this._save(); // Persist changes
    }
}
