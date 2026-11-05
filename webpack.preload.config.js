const path = require("path");
const {WebpackDependencyInventory} = require('./scripts/legal/webpack-inventory.cjs');

module.exports = {
    entry: {preload: './src/preload.js', 'assistant-preload': './src/preload_assistant.js'},
    target: 'electron-preload',
    plugins: [new WebpackDependencyInventory('preload')],
    output: {
        path: path.resolve(__dirname, 'dist/main'),
        filename: '[name].js',
    },
    externals: {
        electron: "commonjs electron",
    },
};
