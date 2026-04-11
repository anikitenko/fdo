import JSONORM from "./JSONORM";

export default class UserORM extends JSONORM {
    constructor(filePath) {
        super(filePath); // Call the base class
        if (!this.data.config) this.data.config = {};
        if (!this.data.config.plugins) this.data.config.plugins = [];
        if (!Array.isArray(this.data.config.sharedProcessScopes)) {
            this.data.config.sharedProcessScopes = Array.isArray(this.data.config.customProcessScopes)
                ? this.data.config.customProcessScopes
                : [];
        }
        if (!Array.isArray(this.data.config.customProcessScopes)) this.data.config.customProcessScopes = [];
        if (!Array.isArray(this.data.config.sharedFilesystemScopes)) {
            this.data.config.sharedFilesystemScopes = Array.isArray(this.data.config.customFilesystemScopes)
                ? this.data.config.customFilesystemScopes
                : [];
        }
        if (!Array.isArray(this.data.config.customFilesystemScopes)) this.data.config.customFilesystemScopes = [];
    }

    activatePlugin(id) {
        this.data.config.plugins.push(id);
        this.data.config.plugins = [...new Set(this.data.config.plugins)];
        this._save();
    }

    deactivatePlugin(id) {
        this.data.config.plugins.splice(this.data.config.plugins.indexOf(id), 1);
        this._save();
    }

    deactivateAllPlugins() {
        this.data.config.plugins = [];
        this._save();
    }

    getActivatedPlugins() {
        return this.data.config.plugins;
    }

    getSharedProcessScopes() {
        return Array.isArray(this.data.config.sharedProcessScopes)
            ? this.data.config.sharedProcessScopes
            : [];
    }

    setSharedProcessScopes(scopes = []) {
        this.data.config.sharedProcessScopes = Array.isArray(scopes) ? scopes : [];
        this._save();
        return this.getSharedProcessScopes();
    }

    getCustomProcessScopes() {
        return this.getSharedProcessScopes();
    }

    setCustomProcessScopes(scopes = []) {
        return this.setSharedProcessScopes(scopes);
    }

    getSharedFilesystemScopes() {
        return Array.isArray(this.data.config.sharedFilesystemScopes)
            ? this.data.config.sharedFilesystemScopes
            : [];
    }

    setSharedFilesystemScopes(scopes = []) {
        this.data.config.sharedFilesystemScopes = Array.isArray(scopes) ? scopes : [];
        this._save();
        return this.getSharedFilesystemScopes();
    }

    getCustomFilesystemScopes() {
        return this.getSharedFilesystemScopes();
    }

    setCustomFilesystemScopes(scopes = []) {
        return this.setSharedFilesystemScopes(scopes);
    }
}
