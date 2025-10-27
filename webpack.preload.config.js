const path = require("path");

module.exports = {
    entry: './src/preload.js',
    target: 'electron-preload',
    output: {
        path: path.resolve(__dirname, 'dist/main'),
        filename: 'preload.js',
    },
    externals: {
        electron: "commonjs electron",
    },
};