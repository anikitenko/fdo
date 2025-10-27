const {FusesPlugin} = require('@electron-forge/plugin-fuses');
const {FuseV1Options, FuseVersion} = require('@electron/fuses');

module.exports = {
    packagerConfig: {
        asar: {
            unpackDir: '.webpack/main/node_modules'
        },
        icon: './src/assets/icons/fdo_icon',
        protocols: [
            {
                name: 'FDO Opener',
                schemes: ['fdo-fiddle']
            }
        ]
    },
    rebuildConfig: {},
    makers: [
        {
            name: '@electron-forge/maker-squirrel',
            config: {},
        },
        {
            name: '@electron-forge/maker-zip',
            platforms: ['darwin', 'linux'],
        },
        {
            name: '@electron-forge/maker-deb',
            config: {
                options: {
                    icon: './src/assets/icons/fdo_icon.png',
                    maintainer: 'AleXvWaN',
                    homepage: 'https://fdo.alexvwan.me',
                    mimeType: ['x-scheme-handler/fdo-fiddle'],
                    section: "utils",
                    priority: 'standard',
                    categories: ["Utility"]
                },
            },
        },
        {
            name: '@electron-forge/maker-rpm',
            config: {
                options: {
                    icon: './src/assets/icons/fdo_icon.png',
                    license: "MIT",
                    homepage: 'https://fdo.alexvwan.me',
                    mimeType: ['x-scheme-handler/fdo-fiddle'],
                    group: "utils",
                    compressionLevel: 9,
                    categories: ["Utility"]
                },
            },
        },
        {
            name: '@electron-forge/maker-dmg',
            config: {
                background: './src/assets/preview-dmg-light.png',
                format: 'ULFO',
                icon: './src/assets/icons/fdo_icon.icns',
                iconSize: 120,
                window: {
                    size: {
                        width: 600,
                        height: 300
                    }
                }
            }
        }
    ],
    plugins: [
        {
            name: '@electron-forge/plugin-auto-unpack-natives',
            config: {},
        },
        {
            name: '@electron-forge/plugin-webpack',
            config: {
                mainConfig: './webpack.main.config.js',
                devContentSecurityPolicy: "default-src 'self' 'unsafe-eval' 'unsafe-inline' static: blob: http: https: plugin: ws: data:",
                renderer: {
                    config: './webpack.renderer.config.js',
                    entryPoints: [
                        {
                            html: './src/index.html',
                            js: './src/renderer.js',
                            name: 'main_window',
                            preload: {
                                js: './src/preload.js',
                            },
                        },
                        {
                            name: 'plugin_host',
                            html: './src/plugin_host.html',
                            js: './src/renderer_plugin_host.js',
                        },
                    ],
                },
            },
        },
        // Fuses are used to enable/disable various Electron functionality
        // at package time, before code signing the application
        new FusesPlugin({
            version: FuseVersion.V1,
            [FuseV1Options.RunAsNode]: false,
            [FuseV1Options.EnableCookieEncryption]: true,
            [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
            [FuseV1Options.EnableNodeCliInspectArguments]: false,
            [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
            [FuseV1Options.OnlyLoadAppFromAsar]: true,
        }),
    ],
};
