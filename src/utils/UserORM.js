import JSONORM from "./JSONORM";

export default class UserORM extends JSONORM {
    constructor(filePath) {
        super(filePath); // Call the base class
        if (!this.data.config) this.data.config = {};
        if (!this.data.config.plugins) this.data.config.plugins = [];
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
}
