const CopyWebpackPlugin = require("copy-webpack-plugin");
const path = require("path");
module.exports = {
    /**
     * This is the main entry point for your application, it's the first file
     * that runs in the main process.
     */
    entry: './src/main.js',
    target: 'electron-main',
    output: {
        path: path.resolve(__dirname, 'dist/main'),
        filename: 'index.js',
    },
    // Put your normal webpack config below here
    module: {
        rules: [
            {
                // We're specifying native_modules in the test because the asset relocator loader generates a
                // "fake" .node file which is really a cjs file.
                test: /native_modules[/\\].+\.node$/,
                use: 'node-loader',
            },
            {
                test: /[/\\]node_modules[/\\].+\.(m?js|node)$/,
                parser: {amd: false},
                use: {
                    loader: '@vercel/webpack-asset-relocator-loader',
                    options: {
                        outputAssetBase: 'native_modules',
                    },
                },
            },
        ],
    },
    externals: {
        esbuild: "commonjs esbuild",
        "@anikitenko/fdo-sdk": "commonjs @anikitenko/fdo-sdk",
    },
    optimization: {
        minimize: false, // Main process doesn't need minification (adds startup overhead)
        moduleIds: 'deterministic',
    },
    node: {
        global: true,
        __dirname: false,
        __filename: false,
    },
    plugins: [
        new CopyWebpackPlugin({
            patterns: [
                {
                    from: path.resolve(__dirname, "node_modules/esbuild"),
                    to: "node_modules/esbuild",
                },
                {
                    from: path.resolve(__dirname, "node_modules/@esbuild"),
                    to: "node_modules/@esbuild",
                },
                {
                    from: path.resolve(__dirname, "node_modules/@anikitenko/fdo-sdk"),
                    to: "node_modules/@anikitenko/fdo-sdk",
                },
            ],
        })
    ],
};
