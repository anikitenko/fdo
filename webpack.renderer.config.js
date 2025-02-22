const MonacoWebpackPlugin = require("monaco-editor-webpack-plugin");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const path = require("path");
module.exports = {
  module: {
    rules: [
      {
        test: /\.css$/,
        use: [{ loader: 'style-loader' }, { loader: 'css-loader' }],
      },
      {
        test: /\.jsx?$/,
        use: {
          loader: 'babel-loader',
          options: {
            exclude: /node_modules/,
            presets:  [
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
      }
    ],
  },
  plugins: [
    new MonacoWebpackPlugin({
      languages: ["css", "dockerfile", "html", "ini", "javascript", "markdown", "mysql", "perl", "pgsql", "typescript", "json"]
    }),
    new CopyWebpackPlugin({
      patterns: [
        {
          from: path.resolve(__dirname, "node_modules/@anikitenko"),
          to: "node_modules/@anikitenko",
        },
      ],
    }),
  ],
};

