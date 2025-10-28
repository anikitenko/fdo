const MonacoWebpackPlugin = require("monaco-editor-webpack-plugin");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const webpack = require("webpack");
const path = require("path");

module.exports = {
    entry: {
        main_window: ['./src/polyfills.js', './src/renderer.js'],
        plugin_host: ['./src/polyfills.js', './src/renderer_plugin_host.js']
    },
    output: {
        path: path.resolve(__dirname, 'dist/renderer'),
        filename: '[name].[contenthash].js',
        chunkFilename: '[name].[contenthash].js',
        publicPath: './',
        clean: true
    },
    target: 'web',
    node: {
        global: true,
        __dirname: false,
        __filename: false,
    },
    resolve: {
        fallback: {
            "path": require.resolve("path-browserify"),
            "process": require.resolve("process/browser.js"),
            "buffer": require.resolve("buffer"),
            "crypto": false,
            "fs": false,
            "stream": false,
            "http": false,
            "https": false,
            "zlib": false,
            "url": false
        },
        extensions: ['.js', '.jsx', '.json', '.mjs'],
        alias: {
            'process/browser': require.resolve('process/browser.js')
        }
    },
    module: {
        rules: [
            {
                test: /\.module\.css$/,  // Ensure only .module.css files use CSS modules
                use: [
                    "style-loader",
                    {
                        loader: "css-loader",
                        options: {
                            modules: {
                                localIdentName: "[name]__[local]__[hash:base64:5]", // Generate unique class names
                            },
                            importLoaders: 1,
                        },
                    },
                ],
            },
            {
                test: /\.css$/,  // Keep this for global styles
                exclude: /\.module\.css$/, // Exclude modules from normal CSS
                use: ["style-loader", "css-loader"],
            },
            {
                test: /\.jsx?$/,
                exclude: /node_modules/,
                use: {
                    loader: 'babel-loader',
                    options: {
                        presets: [
                            ["@babel/preset-react", {
                                "runtime": "automatic"
                            }],
                        ]
                    }
                }
            },
            {
                test: /\.scss$/i,
                use: [
                    // Creates `style` nodes from JS strings
                    "style-loader",
                    // Translates CSS into CommonJS
                    "css-loader",
                    // Compiles Sass to CSS
                    "sass-loader",
                ],
            },
            {
                test: /\.ttf$/,
                type: 'asset/resource'
            },
            {
                test: /\.svg$/,
                type: "asset/resource",
            }
        ],
    },
    optimization: {
        splitChunks: {
            chunks: 'all',
            cacheGroups: {
                // Vendor bundle for large npm packages
                vendor: {
                    test: /[\\/]node_modules[\\/]/,
                    name: 'vendors',
                    priority: 10,
                    reuseExistingChunk: true,
                },
                // Blueprint UI components (large)
                blueprint: {
                    test: /[\\/]node_modules[\\/]@blueprintjs[\\/]/,
                    name: 'blueprint',
                    priority: 20,
                    reuseExistingChunk: true,
                },
                // React core (commonly used)
                react: {
                    test: /[\\/]node_modules[\\/](react|react-dom|react-router-dom)[\\/]/,
                    name: 'react-vendor',
                    priority: 30,
                    chunks: 'all',
                    minChunks: 1,
                    enforce: true, // Always create this chunk
                    reuseExistingChunk: true,
                },
                // Common code used across 2+ chunks
                common: {
                    minChunks: 2,
                    priority: 5,
                    reuseExistingChunk: true,
                    enforce: true,
                },
            },
        },
        runtimeChunk: 'single',
        moduleIds: 'deterministic', // Better long-term caching
    },
    plugins: [
        new webpack.DefinePlugin({
            'global': 'globalThis',
            'global.TYPED_ARRAY_SUPPORT': true,
            'process.browser': true,
        }),
        new webpack.ProvidePlugin({
            Buffer: ['buffer', 'Buffer'],
            process: 'process/browser.js',
            global: 'globalThis',
        }),
        new HtmlWebpackPlugin({
            template: './src/index.html',
            filename: 'index.html',
            title: 'FlexDevOps (FDO)',
            chunks: ['main_window']  // Only include main_window entry point
        }),
        new HtmlWebpackPlugin({
            template: './src/plugin_host.html',
            filename: 'plugin_host.html',
            title: 'Plugin',
            chunks: ['plugin_host']  // Only include plugin_host entry point
        }),
        new MonacoWebpackPlugin({
            languages: ["css", "html", "javascript", "markdown", "typescript", "json"]
        }),
        new CopyWebpackPlugin({
            patterns: [
                {
                    from: path.resolve(__dirname, "src/assets"),
                    to: "assets",
                },
                {
                    from: path.resolve(__dirname, "node_modules/@babel/standalone"),
                    to: "assets/vendor/@babel/standalone",
                },
                {
                    from: path.resolve(__dirname, "node_modules/goober"),
                    to: "assets/vendor/goober",
                    globOptions: {
                        ignore: [
                            "**/__tests__/**",
                            "**/*.test.js",
                            "**/*.spec.js"
                        ]
                    }
                },
            ],
        }),
    ],
};

