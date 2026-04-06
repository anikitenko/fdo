import {app, dialog, ipcMain} from "electron";
import ValidatePlugin from "../components/plugin/ValidatePlugin";
import {rmSync, chmodSync, existsSync, statSync} from "node:fs";
import {readFile, readdir, stat} from 'node:fs/promises';
import Module from 'node:module';
import PluginORM from "../utils/PluginORM";
import {PLUGINS_DIR, PLUGINS_REGISTRY_FILE, USER_CONFIG_FILE} from "../main.js";
import generatePluginName from "../components/editor/utils/generatePluginName";
import path from "node:path";
import UserORM from "../utils/UserORM";
import PluginManager from "../utils/PluginManager";
import {PluginChannels} from "./channels";
import ensureAndWrite from "../utils/ensureAndWrite";
import {EsbuildVirtualFsPlugin} from "../utils/esbuild/plugins/virtual-fs";
import {Certs} from "../utils/certs";
import {syncPluginDir} from "../utils/syncPluginDir";
import {NotificationCenter} from "../utils/NotificationCenter";
import {editorWindow} from "../utils/editorWindow";
import {getIgnoreInstance} from "../utils/getIgnoreInstance";
import {getAllFilesWithIgnorance} from "../utils/getAllFilesWithIgnorance";
import * as stream from "node:stream";

import {v4 as uuidv4} from 'uuid';

import archiver from "archiver"
import {extractMetadata} from "../utils/extractMetadata";
import {normalizeAndValidatePluginMetadata} from "../utils/pluginMetadataContract";
import {runPluginWorkspaceTests} from "../utils/pluginTestRunner";
import {buildPluginInitPayload, resolveHostGrantedCapabilities} from "../utils/pluginRuntimeSecurity";
import {
    executeHostPrivilegedAction,
    HOST_PRIVILEGED_HANDLER,
    HOST_PRIVILEGED_ACTION_SYSTEM_PROCESS_EXEC,
} from "../utils/hostPrivilegedActions";
import {HOST_FS_SCOPE_REGISTRY} from "../utils/privilegedFsScopeRegistry";
import {HOST_PROCESS_SCOPE_REGISTRY} from "../utils/privilegedProcessScopeRegistry";

function buildHostPluginMessage(message, content = undefined) {
    const envelope = { message };
    if (content !== undefined) {
        envelope.content = content;
    }
    return {
        ...envelope,
        data: envelope,
    };
}

export async function buildUsingEsbuild(virtualData) {
    const isDev = !app.isPackaged;
    
    // Construct the path to unpacked node_modules
    const nodePath = isDev 
        ? path.join(app.getAppPath(), "dist", "main", "node_modules")
        : path.join(process.resourcesPath, "app.asar.unpacked", "dist", "main", "node_modules");
    
    const esbuildBinary = path.join(nodePath, "@esbuild", process.platform + "-" + process.arch, "bin", "esbuild");
    
    // Packaged installs under locations like /opt may be root-owned, so chmod must stay best-effort.
    try {
        if (existsSync(esbuildBinary)) {
            const mode = statSync(esbuildBinary).mode & 0o777;
            if ((mode & 0o111) !== 0o111) {
                chmodSync(esbuildBinary, 0o755);
            }
        }
    } catch {
        // Packaging should have already fixed executable permissions.
    }

    // Ensure esbuild uses the correct binary
    process.env.ESBUILD_BINARY_PATH = esbuildBinary;
    process.env.NODE_PATH = nodePath;
    
    const srcJson = JSON.parse(virtualData["/package.json"])
    const pluginEntrypoint = srcJson.source || "index.ts"
    
    // Use Module._load to load esbuild from the unpacked directory
    // This bypasses the normal require() resolution and works with absolute paths
    const esbuildMainPath = path.join(nodePath, "esbuild", "lib", "main.js");
    const esbuild = Module._load(esbuildMainPath, module, false)
    return await esbuild.build({
        entryPoints: [`/${pluginEntrypoint}`],
        bundle: true,
        format: "cjs",
        platform: "node",
        write: false,
        external: ["@anikitenko/fdo-sdk"],
        plugins: [
            EsbuildVirtualFsPlugin(virtualData)
        ],
        tsconfigRaw: {
            compilerOptions: {
                target: "ES2022",
                module: "CommonJS",
                experimentalDecorators: true,
                emitDecoratorMetadata: true,
                useDefineForClassFields: false,
                strict: true
            }
        }
    });
}

async function getPluginLogTail(pluginId, options = {}) {
    const maxFiles = Math.max(1, Math.min(8, Number(options?.maxFiles || 4)));
    const maxChars = Math.max(1000, Math.min(40000, Number(options?.maxChars || 12000)));
    const pluginORM = new PluginORM(PLUGINS_REGISTRY_FILE);
    const plugin = pluginORM.getPlugin(pluginId);

    if (!plugin?.id) {
        return {success: false, error: `Plugin "${pluginId}" not found`, pluginId, logs: [], combined: ""};
    }

    const userDataRoot = process.env.FDO_E2E_USER_DATA_DIR || app.getPath("userData");
    const logDir = path.join(userDataRoot, "plugin-data", pluginId, "logs");
    if (!existsSync(logDir)) {
        return {success: false, error: "No plugin runtime logs found", pluginId, logDir, logs: [], combined: ""};
    }

    const entries = await readdir(logDir, {withFileTypes: true});
    const fileStats = [];
    for (const entry of entries) {
        if (!entry.isFile()) continue;
        const filePath = path.join(logDir, entry.name);
        try {
            const details = await stat(filePath);
            fileStats.push({
                filePath,
                fileName: entry.name,
                mtimeMs: details.mtimeMs || 0,
            });
        } catch (_) {
            // Ignore unreadable files and continue.
        }
    }

    const selectedFiles = fileStats
        .sort((a, b) => b.mtimeMs - a.mtimeMs || a.fileName.localeCompare(b.fileName))
        .slice(0, maxFiles);

    if (selectedFiles.length === 0) {
        return {success: false, error: "No plugin runtime logs found", pluginId, logDir, logs: [], combined: ""};
    }

    const logs = [];
    const combinedParts = [];
    const perFileBudget = Math.max(500, Math.floor(maxChars / selectedFiles.length));

    for (const file of selectedFiles) {
        try {
            const content = await readFile(file.filePath, "utf8");
            const tail = String(content || "").slice(-perFileBudget);
            logs.push({
                file: file.fileName,
                size: tail.length,
                tail,
            });
            combinedParts.push(`Log file: ${file.fileName}\n\`\`\`\n${tail}\n\`\`\``);
        } catch (error) {
            logs.push({
                file: file.fileName,
                size: 0,
                tail: "",
                error: error?.message || String(error),
            });
        }
    }

    return {
        success: true,
        pluginId,
        logDir,
        logs,
        combined: combinedParts.join("\n\n"),
    };
}

async function getPluginLogTrace(pluginId, options = {}) {
    const maxNotifications = Math.max(1, Math.min(20, Number(options?.maxNotifications || 8)));
    const maxLifecycleEvents = Math.max(5, Math.min(200, Number(options?.maxLifecycleEvents || 80)));
    const runtimeStatus = {
        loading: !!PluginManager.loadingPlugins?.[pluginId],
        loaded: !!PluginManager.getLoadedPlugin(pluginId),
        ready: !!PluginManager.getLoadedPluginReady(pluginId),
        inited: !!PluginManager.getLoadedPluginInited(pluginId),
        lastUnload: PluginManager.lastUnloadByPlugin?.[pluginId] || null,
    };
    const lifecycleEvents = typeof PluginManager.getPluginEventTrace === "function"
        ? PluginManager.getPluginEventTrace(pluginId, {limit: maxLifecycleEvents})
        : [];
    const liveOutputTail = Array.isArray(PluginManager.pluginRuntimeOutputTail?.[pluginId])
        ? PluginManager.pluginRuntimeOutputTail[pluginId]
        : [];

    const tail = await getPluginLogTail(pluginId, options).catch((error) => ({
        success: false,
        error: error?.message || String(error),
        pluginId,
        logs: [],
        combined: "",
    }));

    const pluginToken = String(pluginId || "").toLowerCase();
    const relatedNotifications = NotificationCenter.getAllNotifications()
        .filter((item) => {
            const title = String(item?.title || "").toLowerCase();
            const message = String(item?.message || "").toLowerCase();
            return pluginToken && (title.includes(pluginToken) || message.includes(pluginToken));
        })
        .slice(-maxNotifications);

    const notificationText = relatedNotifications.length > 0
        ? relatedNotifications.map((item) => {
            return [
                `- [${item?.createdAt || ""}] ${item?.title || ""}`,
                String(item?.message || ""),
            ].join("\n");
        }).join("\n\n")
        : "No recent host notifications mentioning this plugin.";

    const runtimeText = [
        `Runtime status for "${pluginId}":`,
        `loading=${runtimeStatus.loading}; loaded=${runtimeStatus.loaded}; ready=${runtimeStatus.ready}; inited=${runtimeStatus.inited}`,
        runtimeStatus.lastUnload
            ? `lastUnload=${JSON.stringify(runtimeStatus.lastUnload)}`
            : "lastUnload=none",
    ].join("\n");
    const lifecycleText = lifecycleEvents.length > 0
        ? lifecycleEvents.map((entry) => {
            const isoTs = Number.isFinite(entry?.ts) ? new Date(entry.ts).toISOString() : "unknown-ts";
            return `- [${isoTs}] ${entry?.event || "unknown"} ${JSON.stringify(entry?.details || {})}`;
        }).join("\n")
        : "No in-memory lifecycle trace available.";
    const liveOutputText = liveOutputTail.length > 0
        ? liveOutputTail.join("\n")
        : "No active runtime stdout/stderr tail available.";

    const combined = [
        runtimeText,
        "",
        "Host lifecycle trace:",
        lifecycleText,
        "",
        "Live runtime output tail:",
        liveOutputText,
        "",
        "Related host notifications:",
        notificationText,
        "",
        "Plugin runtime logs:",
        tail?.combined || "No runtime log files found.",
    ].join("\n");

    return {
        success: true,
        pluginId,
        runtimeStatus,
        lifecycleEvents,
        liveOutputTail,
        notifications: relatedNotifications,
        logTail: tail,
        combined,
    };
}

export function registerPluginHandlers() {
    const emitPrivilegedAudit = (event) => {
        console.info("[PLUGIN_PRIVILEGED_AUDIT]", JSON.stringify(event));
    };

    const handlePrivilegedAction = async (pluginId, loadedPlugin, payload = {}) => {
        const correlationId = typeof payload?.correlationId === "string" && payload.correlationId.trim()
            ? payload.correlationId.trim()
            : `priv-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        const request = payload?.request ?? payload;

        return executeHostPrivilegedAction(request, {
            pluginId,
            correlationId,
            grantedCapabilities: loadedPlugin?.grantedCapabilities || [],
            onAudit: emitPrivilegedAudit,
            confirmPrivilegedAction: async ({title, message, detail, confirmLabel, cancelLabel, action}) => {
                const defaultTitle = action === HOST_PRIVILEGED_ACTION_SYSTEM_PROCESS_EXEC
                    ? "Confirm Scoped Process Execution"
                    : "Confirm Privileged Plugin Action";
                const defaultMessage = action === HOST_PRIVILEGED_ACTION_SYSTEM_PROCESS_EXEC
                    ? "Plugin requests running an approved external tool"
                    : "Plugin requests a privileged host action";
                const result = await dialog.showMessageBox({
                    type: "warning",
                    title: title || defaultTitle,
                    message: message || defaultMessage,
                    detail: detail || "",
                    buttons: [cancelLabel || "Cancel", confirmLabel || "Apply"],
                    cancelId: 0,
                    defaultId: 1,
                    noLink: true,
                });
                return result.response === 1;
            },
        });
    };

    ipcMain.handle(PluginChannels.GET_DATA, async (event, pluginPath) => {
        try {
            if (process.env.FDO_E2E === "1" && typeof pluginPath === "string" && pluginPath.startsWith("/tmp/e2e-")) {
                const fixtureName = path.basename(pluginPath);
                const content = [
                    {
                        path: "/index.ts",
                        content: `export const hello = "${fixtureName}";\n`,
                    },
                    {
                        path: "/render.tsx",
                        content: "export const render = () => null;\n",
                    },
                    {
                        path: "/package.json",
                        content: JSON.stringify({
                            name: fixtureName,
                            version: "1.0.0",
                            source: "index.ts",
                            main: "dist/index.cjs",
                        }, null, 2),
                    },
                ];
                return {
                    success: true,
                    content,
                    metadata: null,
                    entryPoint: "dist/index.cjs",
                };
            }

            const ig = await getIgnoreInstance(pluginPath, []);

            const existingFiles = await getAllFilesWithIgnorance(pluginPath, (relativePath) => {
                return !ig.ignores(relativePath);
            });
            let metadata;
            let sourceFile = "index.ts";
            let entryPoint = "dist/index.cjs";
            const content = await Promise.all(
                existingFiles.map(async (filePath) => {
                    const relPath = `/${path.relative(pluginPath, filePath).replace(/\\/g, "/")}`;
                    const buffer = await readFile(filePath);
                    const text = buffer.toString("utf8");

                    if (relPath === "/package.json") {
                        try {
                            const json = JSON.parse(text);
                            sourceFile = json.source || "index.ts";
                            entryPoint = json.module || json.main || "dist/index.cjs"
                        } catch (err) {
                            return {success: false, error: `Invalid package.json: ${err}`};
                        }
                    }

                    return {
                        path: relPath,
                        content: text,
                    };
                })
            );

            const source = content.find(file => file.path === `/${sourceFile}`);
            if (source) {
                const match = await extractMetadata(source.content);
                if (match) {
                    metadata = {
                        name: match.name,
                        version: match.version,
                        author: match.author,
                        description: match.description,
                        icon: match.icon,
                    };
                }
            } else {
                return {success: false, error: "No source file found"};
            }

            return {success: true, content, metadata, entryPoint};
        } catch (error) {
            return {success: false, error: error.message};
        }
    });

    ipcMain.handle(PluginChannels.SAVE, async (event, data) => {
        const {name, content, metadata, entrypoint} = data;
        const capabilities = Array.isArray(data?.capabilities) ? data.capabilities : [];
        try {
            const pluginORM = new PluginORM(PLUGINS_REGISTRY_FILE);
            const pluginName = generatePluginName(name)
            const pluginPath = path.join(PLUGINS_DIR, uuidv4());
            if (!pluginORM.isInstalled(pluginName)) {
                await syncPluginDir(pluginPath, content)
                const result = await ValidatePlugin(pluginPath);
                if (!result) {
                    rmSync(pluginPath, {recursive: true, force: true})
                }
                pluginORM.addPlugin(pluginName, metadata, pluginPath, entrypoint, false, capabilities)

                PluginManager.sendToMainWindow(PluginChannels.on_off.DEPLOY_FROM_EDITOR, pluginName)

                return { success: true }
            } else {
                return {success: false, error: "Plugin already installed!"};
            }
        } catch (error) {
            return {success: false, error: error.message};
        }
    });

    ipcMain.handle(PluginChannels.REMOVE, async (event, id) => {
        const pluginORM = new PluginORM(PLUGINS_REGISTRY_FILE);
        try {
            const plugin = pluginORM.getPlugin(id)
            rmSync(plugin.home, {recursive: true, force: true})
            pluginORM.removePlugin(plugin.id)
            return {success: true};
        } catch (error) {
            return {success: false, error: error.message};
        }
    });

    ipcMain.handle(PluginChannels.GET_ALL, async () => {
        const pluginORM = new PluginORM(PLUGINS_REGISTRY_FILE);
        try {
            const plugins = pluginORM.getAllPlugins();
            return {success: true, plugins: plugins};
        } catch (error) {
            return {success: false, error: error.message};
        }
    });

    ipcMain.handle(PluginChannels.GET, async (event, id) => {
        const pluginORM = new PluginORM(PLUGINS_REGISTRY_FILE);
        try {
            const plugin = pluginORM.getPlugin(id);
            return {success: true, plugin: plugin};
        } catch (error) {
            return {success: false, error: error.message};
        }
    });

    ipcMain.handle(PluginChannels.GET_SCOPE_POLICIES, async () => {
        try {
            return {
                success: true,
                scopes: [
                    ...Object.values(HOST_FS_SCOPE_REGISTRY || {}),
                    ...Object.values(HOST_PROCESS_SCOPE_REGISTRY || {}),
                ],
            };
        } catch (error) {
            return {success: false, error: error.message, scopes: []};
        }
    });

    ipcMain.handle(PluginChannels.GET_RUNTIME_STATUS, async (event, ids = []) => {
        try {
            const requestedIds = Array.isArray(ids) ? ids : [];
            const statuses = requestedIds.map((id) => ({
                id,
                loading: !!PluginManager.loadingPlugins?.[id],
                loaded: !!PluginManager.getLoadedPlugin(id),
                ready: !!PluginManager.getLoadedPluginReady(id),
                inited: !!PluginManager.getLoadedPluginInited(id),
                lastUnload: PluginManager.lastUnloadByPlugin?.[id] || null,
            }));
            return { success: true, statuses };
        } catch (error) {
            return { success: false, error: error.message, statuses: [] };
        }
    });

    ipcMain.handle(PluginChannels.ACTIVATE, async (event, id) => {
        const userORM = new UserORM(USER_CONFIG_FILE);
        try {
            const result = await PluginManager.loadPlugin(id)
            if (!result.success) {
                return {success: false, error: result.error};
            }
            userORM.activatePlugin(id)
            return {success: true};
        } catch (error) {
            return {success: false, error: error.error};
        }
    });

    ipcMain.handle(PluginChannels.DEACTIVATE, async (event, id) => {
        const userORM = new UserORM(USER_CONFIG_FILE);
        try {
            PluginManager.unLoadPlugin(id)
            userORM.deactivatePlugin(id)
            return {success: true};
        } catch (error) {
            return {success: false, error: error.message};
        }
    });

    ipcMain.handle(PluginChannels.DEACTIVATE_USERS, async (event, id) => {
        const userORM = new UserORM(USER_CONFIG_FILE);
        userORM.deactivatePlugin(id)
        return {success: true};
    });

    ipcMain.handle(PluginChannels.GET_ACTIVATED, async () => {
        const userORM = new UserORM(USER_CONFIG_FILE);
        try {
            const plugins = userORM.getActivatedPlugins()
            return {success: true, plugins: plugins};
        } catch (error) {
            return {success: false, error: error.message};
        }
    });

    ipcMain.handle(PluginChannels.DEACTIVATE_ALL, async () => {
        const userORM = new UserORM(USER_CONFIG_FILE);
        try {
            PluginManager.unLoadPlugins()
            userORM.deactivateAllPlugins()
            return {success: true};
        } catch (error) {
            return {success: false, error: error.message};
        }
    })

    ipcMain.handle(PluginChannels.INIT, async (event, id) => {
        const plugin = PluginManager.getLoadedPlugin(id)
        if (!plugin) {
            return {success: false, error: `Plugin "${id}" is not loaded`};
        }
        if (!plugin.ready) {
            return {success: false, error: `Plugin "${id}" is not ready`};
        }
        plugin.instance.postMessage(buildHostPluginMessage("PLUGIN_INIT", {
            ...buildPluginInitPayload(plugin.grantedCapabilities || resolveHostGrantedCapabilities()),
        }))
        return {success: true};
    })

    ipcMain.handle(PluginChannels.RENDER, async (event, id) => {
        const plugin = PluginManager.getLoadedPlugin(id)
        if (!plugin) {
            return {success: false, error: `Plugin "${id}" is not loaded`};
        }
        if (!plugin.ready) {
            return {success: false, error: `Plugin "${id}" is not ready`};
        }
        plugin.instance.postMessage(buildHostPluginMessage("PLUGIN_RENDER"))
        return {success: true};
    })

    ipcMain.handle(PluginChannels.UI_MESSAGE, async (event, id, content) => {
        const plugin = PluginManager.getLoadedPlugin(id)
        if (!plugin) {
            return {success: false, error: `Plugin "${id}" is not loaded`};
        }
        if (!plugin.ready) {
            return {success: false, error: `Plugin "${id}" is not ready`};
        }
        if (content?.handler === HOST_PRIVILEGED_HANDLER) {
            return handlePrivilegedAction(id, plugin, content?.content || {});
        }
        plugin.instance.postMessage(buildHostPluginMessage("UI_MESSAGE", content))
        return {success: true};
    })

    ipcMain.handle(PluginChannels.BUILD, async (event, data) => {
        try {
            const result = await buildUsingEsbuild(data.latestContent)
            return {success: true, files: result}
        } catch (error) {
            NotificationCenter.addNotification({title: `Build error`, message: error.toString(), type: "danger"});
            return {success: false, error: "Build error: "+error.toString()};
        }
    });

    ipcMain.handle(PluginChannels.RUN_TESTS, async (event, data) => {
        try {
            return await runPluginWorkspaceTests(data?.latestContent || {});
        } catch (error) {
            NotificationCenter.addNotification({title: `Test error`, message: error.toString(), type: "danger"});
            return {success: false, error: `Test error: ${error.toString()}`, output: ""};
        }
    });

    ipcMain.handle(PluginChannels.DEPLOY_FROM_EDITOR, async (event, data) => {
        try {
            const pluginORM = new PluginORM(PLUGINS_REGISTRY_FILE);
            const plugin = pluginORM.getPlugin(data.name);
            let pathToDir = path.join(PLUGINS_DIR, `${data.name}_${data.sandbox}`)
            if (plugin) {
                pathToDir = plugin.home
            }
            const pathToPlugin = path.join(pathToDir, data.entrypoint)
            const metadata = normalizeAndValidatePluginMetadata(data.metadata)

            await ensureAndWrite(pathToPlugin, data.content)
            const signResult = Certs.signPlugin(pathToDir, data.rootCert)
            if (!signResult.success) {
                return signResult
            }
            const capabilities = Array.isArray(data?.capabilities) ? data.capabilities : (plugin?.capabilities || []);
            pluginORM.addPlugin(data.name, metadata, pathToDir, data.entrypoint, true, capabilities)

            const mainWindow = PluginManager.mainWindow
            if (mainWindow) {
                mainWindow.focus()
            }
            mainWindow.webContents.send(PluginChannels.on_off.DEPLOY_FROM_EDITOR, data.name);
            return {success: true}
        } catch (error) {
            return {success: false, error: error.message};
        }
    })

    ipcMain.handle(PluginChannels.SAVE_FROM_EDITOR, async (event, data) => {
        try {
            const pluginORM = new PluginORM(PLUGINS_REGISTRY_FILE);
            const plugin = pluginORM.getPlugin(data.name);
            let pathToDir;
            if (data.dir === "sandbox" || data.dir.includes(data.sandbox) || !plugin) {
                pathToDir = path.join(PLUGINS_DIR, data.name)
            } else {
                pathToDir = plugin.home
            }

            await syncPluginDir(pathToDir, data.content)

            const signResult = Certs.signPlugin(pathToDir, data.rootCert)
            if (!signResult.success) {
                return signResult
            }

            const metadata = normalizeAndValidatePluginMetadata(data.metadata)
            const capabilities = Array.isArray(data?.capabilities) ? data.capabilities : (plugin?.capabilities || []);
            pluginORM.addPlugin(data.name, metadata, pathToDir, data.entrypoint, true, capabilities)

            if (data.dir.includes(data.sandbox)) {
                rmSync(data.dir, {recursive: true, force: true})
                const mainWindow = PluginManager.mainWindow
                mainWindow.webContents.send(PluginChannels.on_off.DEPLOY_FROM_EDITOR, data.name);
            }

            const editorWindowInstance = editorWindow.getWindow()
            if (editorWindowInstance) {
                editorWindowInstance.destroy();
            }

            return {success: true}
        } catch (error) {
            return {success: false, error: error.message};
        }
    })

    ipcMain.handle(PluginChannels.VERIFY_SIGNATURE, async (event, id) => {
        const pluginORM = new PluginORM(PLUGINS_REGISTRY_FILE);
        const plugin = pluginORM.getPlugin(id)
        return Certs.verifyPlugin(plugin.home)
    })

    ipcMain.handle(PluginChannels.SIGN, async (event, id, signerLabel) => {
        const pluginORM = new PluginORM(PLUGINS_REGISTRY_FILE);
        const plugin = pluginORM.getPlugin(id)
        return Certs.signPlugin(plugin.home, signerLabel)
    })

    ipcMain.handle(PluginChannels.EXPORT, async (event, id) => {
        const pluginORM = new PluginORM(PLUGINS_REGISTRY_FILE);
        const plugin = pluginORM.getPlugin(id)

        const archive = archiver('zip', { zlib: { level: 9 } });
        const passThrough = new stream.PassThrough();
        const chunks = [];

        archive.on('error', err => {
            NotificationCenter.addNotification({title: `Export plugin error`, message: err.toString(), type: "danger"});
        });

        passThrough.on('data', chunk => chunks.push(chunk));

        archive.pipe(passThrough);

        const ig = await getIgnoreInstance(plugin.home, []);
        const existingFiles = await getAllFilesWithIgnorance(plugin.home, relativePath => !ig.ignores(relativePath));

        for (const absFile of existingFiles) {
            const relativePath = path.relative(plugin.home, absFile);
            archive.file(absFile, { name: relativePath });
        }

        await archive.finalize();

        return new Promise((resolve, reject) => {
            passThrough.on('end', () => resolve(Buffer.concat(chunks)));
            passThrough.on('error', reject);
            archive.on('error', reject);
        });
    })

    ipcMain.handle(PluginChannels.SET_CAPABILITIES, async (_event, id, capabilities = []) => {
        try {
            const pluginORM = new PluginORM(PLUGINS_REGISTRY_FILE);
            const result = pluginORM.setPluginCapabilities(id, capabilities);
            if (!result.success) {
                return result;
            }
            const plugin = pluginORM.getPlugin(id);
            return {success: true, capabilities: result.capabilities, plugin};
        } catch (error) {
            return {success: false, error: error?.message || String(error)};
        }
    });

    ipcMain.handle(PluginChannels.GET_LOG_TAIL, async (_event, id, options = {}) => {
        try {
            return await getPluginLogTail(id, options);
        } catch (error) {
            return {success: false, error: error?.message || String(error), pluginId: id, logs: [], combined: ""};
        }
    });

    ipcMain.handle(PluginChannels.GET_LOG_TRACE, async (_event, id, options = {}) => {
        try {
            return await getPluginLogTrace(id, options);
        } catch (error) {
            return {success: false, error: error?.message || String(error), pluginId: id, combined: ""};
        }
    });
}
