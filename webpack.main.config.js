const CopyWebpackPlugin = require("copy-webpack-plugin");
const webpack = require("webpack");
const path = require("path");
const fs = require("node:fs");
module.exports = {
    /**
     * This is the main entry point for your application, it's the first file
     * that runs in the main process.
     */
    entry: './src/bootstrap_main.js',
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
        ssh2: 'commonjs ssh2',
        typescript: "commonjs typescript",
        esbuild: "commonjs esbuild",
        "@cursor/sdk": "commonjs @cursor/sdk",
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
        {
            apply(compiler) {
                compiler.hooks.thisCompilation.tap('StandaloneWebExport', compilation => {
                    compilation.hooks.processAssets.tapPromise({name:'StandaloneWebExport',stage:compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL},async()=>{
                        const builderPath=require.resolve('./scripts/build-web-export-assets.cjs');
                        delete require.cache[builderPath];
                        const builder=require(builderPath);
                        const source=await builder.buildWebExportAssets(__dirname);
                        compilation.emitAsset('export-runtime/view.js',new compiler.webpack.sources.RawSource(Buffer.from(source)));
                        compilation.emitAsset('export-runtime/runtime-sources.json',new compiler.webpack.sources.RawSource(JSON.stringify(builder.webExportRuntimeSources(__dirname))));
                    });
                });
            },
        },
        {
            apply(compiler) {
                compiler.hooks.afterEmit.tap('BundledExecutablePermissions', () => {
                    const output = compiler.options.output.path;
                    const binary = path.join(output, 'node_modules/@typescript', `typescript-${process.platform}-${process.arch}`, 'lib/tsc');
                    if (process.platform !== 'win32' && fs.existsSync(binary)) fs.chmodSync(binary, 0o755);
                    require('./scripts/fix-bundled-binary-permissions.js').fixGitPermissions(output);
                });
            },
        },
        // Google Gen AI includes ws for its optional Live API. Use ws's own
        // JavaScript fallbacks instead of packaging optional native addons.
        new webpack.IgnorePlugin({resourceRegExp: /^(bufferutil|utf-8-validate)$/, contextRegExp: /node_modules[/\\]ws[/\\]/}),
        new CopyWebpackPlugin({
            patterns: [
                {from:path.resolve(__dirname,'node_modules/dugite/git'),to:'git'},
                ...['ssh2', 'asn1', 'safer-buffer', 'bcrypt-pbkdf', 'tweetnacl'].map(name => ({
                    from: path.resolve(__dirname, 'node_modules', name), to: 'node_modules/' + name,
                    globOptions: {ignore: ['**/test/**', '**/test.js', '**/build/**', '**/*.node']},
                })),
                {from: 'src/utils/hostServices/gitSshHelper.cjs', to: 'gitSshHelper.cjs'},
                {from: 'src/utils/persistence/notificationWorker.cjs', to: 'notificationWorker.cjs'},
                {from: 'src/utils/persistence/notificationDatabase.cjs', to: 'notificationDatabase.cjs'},
                {from: 'src/utils/persistence/observabilityWorker.cjs', to: 'observabilityWorker.cjs'},
                {from: 'src/utils/persistence/observabilityDatabase.cjs', to: 'observabilityDatabase.cjs'},
                {from: 'src/utils/persistence/chatWorker.cjs', to: 'chatWorker.cjs'},
                {from: 'src/utils/persistence/chatDatabase.cjs', to: 'chatDatabase.cjs'},
                // Keep the SDK's lazy local-runtime chunks intact, together with
                // its platform helpers and direct runtime dependencies.
                ...['@cursor', '@bufbuild/protobuf', '@connectrpc/connect', '@connectrpc/connect-web', '@statsig/js-client', 'zod'].map(name => ({
                    from: path.resolve(__dirname, 'node_modules', name), to: 'node_modules/' + name,
                })),
                ...['typescript', '@typescript', '@types/node', 'undici-types'].map(name => ({
                    from: path.resolve(__dirname, 'node_modules', name), to: 'node_modules/' + name,
                })),
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
                    globOptions: {
                        ignore: ["node_modules/@anikitenko/fdo-sdk/node_modules/**"] // Exclude only nested node_modules
                    }
                },
                {
                    from: path.resolve(__dirname, "node_modules/@openai"),
                    to: "node_modules/@openai",
                    noErrorOnMissing: true,
                    globOptions: {
                        ignore: ["node_modules/@openai/**/node_modules/**"],
                    },
                },
                {
                    from: path.resolve(__dirname, "src/workers/codexAuthWorker.js"),
                    to: "workers/codexAuthWorker.js",
                },
                {
                    from: path.resolve(__dirname, "src/workers/geminiAuthWorker.js"),
                    to: "workers/geminiAuthWorker.js",
                },
            ],
        }),
        new webpack.IgnorePlugin({
            resourceRegExp: /^@img\/sharp-libvips-dev/,
        }),
        new webpack.IgnorePlugin({
            resourceRegExp: /^@img\/sharp-wasm32/,
        }),
    ],
};
