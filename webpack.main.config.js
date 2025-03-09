const CopyWebpackPlugin = require("copy-webpack-plugin");
const path = require("path");
module.exports = {
    /**
     * This is the main entry point for your application, it's the first file
     * that runs in the main process.
     */
    entry: './src/main.js',
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
            ],
        })
    ],
};
