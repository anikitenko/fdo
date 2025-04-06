const MonacoWebpackPlugin = require("monaco-editor-webpack-plugin");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const path = require("path");
module.exports = {
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
                use: {
                    loader: 'babel-loader',
                    options: {
                        exclude: /node_modules/,
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
    plugins: [
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
                    from: path.resolve(__dirname, "node_modules/@anikitenko/fdo-sdk/dist/@types"),
                    to: "assets/node_modules/@anikitenko/fdo-sdk",
                    /*noErrorOnMissing: true,
                    globOptions: {
                        dot: true,
                        ignore: ['**!/fdo-sdk.bundle.js', '**!/fdo-sdk.bundle.js.map']
                    }*/
                },
                {
                    from: path.resolve(__dirname, "node_modules/@babel/standalone"),
                    to: "assets/node_modules/@babel/standalone",
                },
                {
                    from: path.resolve(__dirname, "node_modules/goober"),
                    to: "assets/node_modules/goober",
                },
                {
                    from: path.resolve(__dirname, "node_modules/@types/node"),
                    to: "assets/node_modules/@types/node",
                },
                {
                    from: path.resolve(__dirname, "node_modules/@types/react"),
                    to: "assets/node_modules/@types/react",
                },
            ],
        }),
    ],
};

