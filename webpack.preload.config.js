const path = require("path");

module.exports = {
    entry: {preload: './src/preload.js', 'assistant-preload': './src/preload_assistant.js'},
    target: 'electron-preload',
    output: {
        path: path.resolve(__dirname, 'dist/main'),
        filename: '[name].js',
    },
    externals: {
        electron: "commonjs electron",
    },
};
