import Store from 'electron-store';
import {stageObservabilityMigration} from './stageObservabilityMigration.cjs';
import fs from 'node:fs';
import {migrateCodingTimeoutDefaults} from '../ai/generation/codingRequestPolicy.cjs';

const e2eCwd = process.env.FDO_E2E_USER_DATA_DIR;
if (e2eCwd) {
    try {
        fs.mkdirSync(e2eCwd, { recursive: true });
    } catch (_) {
        // Best-effort; electron-store will surface path errors if any.
    }
}

export const settings = new Store({
    ...(e2eCwd ? { cwd: e2eCwd } : {}),
    encryptionKey: "FDO-APPLICATION",
    name: "settings",
    // Persistence layout version, independent of the application release.
    projectVersion: "1.1.0",
    // Drop obsolete JSON copies; SQLite is the sole owner of notification and chat history.
    migrations: {
        "1.0.0": store => {store.delete("notifications"); store.delete("ai.sessions");},
        "1.1.0": stageObservabilityMigration,
    },
    schema: {
        notificationPreferences: {type: 'object', default: {}, additionalProperties: false, properties: {
            successToasts: {type: 'boolean'}, failureToasts: {type: 'boolean'}, infoToasts: {type: 'boolean'},
            retentionDays: {type: 'integer', enum: [0, 30, 90]},
            mutedSources: {type: 'array', items: {type: 'string', enum: ['gitops', 'builds', 'plugins', 'security', 'ai', 'observability', 'system']}},
        }},
        gitops: {
            type: 'object', default: {repositories: []}, additionalProperties: false,
            properties: {
                repositories: {type: 'array', maxItems: 30, default: [], items: {
                    type: 'object', additionalProperties: false,
                    required: ['id', 'url', 'authType', 'manifestPath', 'revisionType', 'targetRevision', 'manifest', 'commit', 'verifiedAt'],
                    properties: {
                        id: {type: 'string'}, url: {type: 'string'},
                        authType: {type: 'string', enum: ['none', 'basic']},
                        encryptedCredentials: {type: 'string'}, manifestPath: {type: 'string'},
                        revisionType: {type: 'string', enum: ['branch', 'tag']}, targetRevision: {type: 'string'},
                        manifest: {type: 'object'}, commit: {type: 'string'}, verifiedAt: {type: 'string'},
                        autoSync: {type: 'boolean'}, lastSyncedAt: {type: 'string'}, syncError: {type: 'string'},
                        checkIntervalMinutes: {type: 'integer', minimum: 1, maximum: 1439}, lastCheckedAt: {type: 'string'},
                        pluginStatuses: {type: 'array', items: {type: 'object', required: ['name', 'state'], additionalProperties: false,
                            properties: {name: {type: 'string'}, state: {type: 'string', enum: ['checking', 'synced', 'error']},
                                checkedAt: {type: 'string'}, error: {type: 'string'}, commit: {type: 'string'}}}},
                        installedPlugins: {type: 'array', items: {type: 'object', required: ['id', 'name', 'commit'], additionalProperties: false,
                            properties: {id: {type: 'string'}, name: {type: 'string'}, commit: {type: 'string'}}}},
                    },
                }},
            },
        },
        ai: {
            type: "object",
            properties: {
                codingTimeoutDefaultsVersion: {type:'integer',minimum:0,default:0},
                usageRates: {type: "object", default: {}},
                codexHooks: {type:'array',default:[],maxItems:30,items:{type:'object',additionalProperties:false,
                    required:['id','name','event','toolPattern','command','args','cwd','environment','timeoutSeconds','enabled','assistantIds'],
                    properties:{id:{type:'string'},name:{type:'string',maxLength:64},event:{type:'string',enum:['SessionStart','UserPromptSubmit','PreToolUse','PostToolUse','PreCompact','PostCompact','Stop','SessionEnd','Interrupt']},
                        toolPattern:{type:'string',maxLength:128},command:{type:'string',maxLength:2048},args:{type:'array',maxItems:64,items:{type:'string',maxLength:8192}},cwd:{type:'string',maxLength:2048},
                        environment:{type:'object',maxProperties:32,additionalProperties:{type:'string',maxLength:8192}},timeoutSeconds:{type:'integer',minimum:1,maximum:60},enabled:{type:'boolean'},assistantIds:{type:'array',uniqueItems:true,items:{type:'string'}}}}},
                codexMcpAuth: {type: 'object', default: {}, additionalProperties: {type: 'object'}},
                codexMcpServers: {
                    type: 'array', default: [], maxItems: 20,
                    items: {type: 'object', additionalProperties: false,
                        required: ['id', 'name', 'url', 'bearerToken', 'enabled', 'assistantIds', 'enabledTools', 'tools', 'checkedAt'],
                        properties: {
                            transport: {type: 'string', enum: ['http', 'stdio']}, authMode: {type: 'string', enum: ['none', 'bearer', 'oauth']},
                            command: {type: 'string', maxLength: 2048}, args: {type: 'array', maxItems: 64, items: {type: 'string', maxLength: 8192}}, cwd: {type: 'string', maxLength: 2048},
                            headers: {type: 'object', maxProperties: 32, additionalProperties: {type: 'string', maxLength: 8192}},
                            environment: {type: 'object', maxProperties: 32, additionalProperties: {type: 'string', maxLength: 8192}},
                            oauthClientId: {type: 'string', maxLength: 1024}, oauthScopes: {type: 'string', maxLength: 1024}, oauthCallbackPort: {type: 'integer', minimum: 0, maximum: 65535}, authRevision: {type: 'string'},
                            id: {type: 'string'}, name: {type: 'string', maxLength: 64}, url: {type: 'string', maxLength: 2048},
                            bearerToken: {type: 'string', maxLength: 8192}, enabled: {type: 'boolean'}, checkedAt: {type: 'string'},
                            assistantIds: {type: 'array', uniqueItems: true, items: {type: 'string'}},
                            enabledTools: {type: 'array', maxItems: 100, uniqueItems: true, items: {type: 'string'}},
                            tools: {type: 'array', maxItems: 100, items: {type: 'object', additionalProperties: false,
                                required: ['name', 'description'], properties: {name: {type: 'string', maxLength: 128}, description: {type: 'string', maxLength: 1024}}}},
                        }},
                },
                codexSkills: {
                    type: 'array', default: [], maxItems: 50,
                    items: {
                        type: 'object', additionalProperties: false,
                        required: ['id', 'name', 'description', 'content', 'enabled', 'assistantIds'],
                        properties: {
                            id: {type: 'string'}, name: {type: 'string', maxLength: 64},
                            description: {type: 'string', maxLength: 1024}, content: {type: 'string', maxLength: 16000},
                            enabled: {type: 'boolean'}, assistantIds: {type: 'array', uniqueItems: true, items: {type: 'string'}},
                        },
                    },
                },
                chat: {
                    type: "array",
                    items: {
                        type: "object",
                        required: ["name", "model", "apiKey", "provider"],
                        properties: {
                            id: {type: "string"},
                            name: {type: "string"},
                            provider: {type: "string"},
                            model: {type: "string"},
                            apiKey: {type: "string", nullable: true},
                            executablePath: {type: "string", nullable: true},
                            codexRuntime: {
                                type: "object",
                                nullable: true,
                                properties: {
                                    source: { type: "string" },
                                    version: { type: "string", nullable: true },
                                    bundled: { type: "boolean", default: false },
                                },
                                required: ["source", "bundled"],
                                additionalProperties: false,
                            },
                            geminiRuntime: {
                                type: "object",
                                nullable: true,
                                properties: {
                                    source: { type: "string" },
                                    version: { type: "string", nullable: true },
                                    bundled: { type: "boolean", default: false },
                                },
                                required: ["source", "bundled"],
                                additionalProperties: false,
                            },
                            codexAuth: {
                                type: "object",
                                nullable: true,
                                properties: {
                                    status: { type: "string" },
                                    message: { type: "string", nullable: true },
                                    checkedAt: { type: "string", format: "date-time" },
                                },
                                required: ["status", "checkedAt"],
                                additionalProperties: false,
                            },
                            default: {type: "boolean", default: false},
                            defaultThinkingMode: { type: "string", nullable: true },
                            createdAt: {type: "string", format: "date-time"},
                            updatedAt: {type: "string", format: "date-time"},
                            usage: {
                                type: "object",
                                properties: {
                                    totalTokens: {type: "number", default: 0},
                                    monthlyTokens: {type: "number", default: 0},
                                    lastUsedAt: {type: "string", format: "date-time"},
                                },
                                additionalProperties: false,
                            },
                        },
                        additionalProperties: false,
                    }
                },
                coding: {
                    type: "array",
                    items: {
                        type: "object",
                        required: ["name", "model", "apiKey", "provider"],
                        properties: {
                            id: {type: "string"},
                            name: {type: "string"},
                            provider: {type: "string"},
                            model: {type: "string"},
                            apiKey: {type: "string", nullable: true},
                            firstResponseTimeoutMs: {type: "integer", minimum: 10000, maximum: 600000},
                            inputCapabilities: {
                                type: "object",
                                properties: {
                                    provider: {type: "string"},
                                    model: {type: "string"},
                                    imageSupport: {type: "string", enum: ["supported", "unsupported", "unknown"]},
                                    source: {type: "string", enum: ["provider-metadata", "integration"]},
                                    reason: {type: "string"},
                                    checkedAt: {type: "string", format: "date-time"},
                                },
                                required: ["provider", "model", "imageSupport", "source", "reason"],
                                additionalProperties: false,
                            },
                            accountId: {type: "string", pattern: "^[a-fA-F0-9]{32}$"},
                            baseUrl: {type: "string"},
                            contextLength: {type: "integer", minimum: 4096, maximum: 262144},
                            executablePath: {type: "string", nullable: true},
                            codexRuntime: {
                                type: "object",
                                nullable: true,
                                properties: {
                                    source: { type: "string" },
                                    version: { type: "string", nullable: true },
                                    bundled: { type: "boolean", default: false },
                                },
                                required: ["source", "bundled"],
                                additionalProperties: false,
                            },
                            geminiRuntime: {
                                type: "object",
                                nullable: true,
                                properties: {
                                    source: { type: "string" },
                                    version: { type: "string", nullable: true },
                                    bundled: { type: "boolean", default: false },
                                },
                                required: ["source", "bundled"],
                                additionalProperties: false,
                            },
                            codexAuth: {
                                type: "object",
                                nullable: true,
                                properties: {
                                    status: { type: "string" },
                                    message: { type: "string", nullable: true },
                                    checkedAt: { type: "string", format: "date-time" },
                                },
                                required: ["status", "checkedAt"],
                                additionalProperties: false,
                            },
                            default: {type: "boolean", default: false},
                            defaultThinkingMode: { type: "string", nullable: true },
                            createdAt: {type: "string", format: "date-time"},
                            updatedAt: {type: "string", format: "date-time"},
                            usage: {
                                type: "object",
                                properties: {
                                    totalTokens: {type: "number", default: 0},
                                    monthlyTokens: {type: "number", default: 0},
                                    lastUsedAt: {type: "string", format: "date-time"},
                                },
                                additionalProperties: false,
                            },
                        },
                        additionalProperties: false,
                    }
                },
                options: {
                    type: "object",
                    properties: {
                        chatStreamingDefault: { type: "boolean", default: false },
                        chatDialog: {
                            type: "object",
                            properties: {
                                provider: { type: "string", nullable: true },
                                model: { type: "string", nullable: true },
                                assistantId: { type: "string", nullable: true },
                                streaming: { type: "boolean", default: false },
                                thinking: { type: "boolean", default: false },
                                thinkingModeSource: { type: "string", nullable: true },
                                temperature: { type: "number", minimum: 0, maximum: 2, default: 0.7 },
                                showDebugDetails: { type: "boolean", default: false },
                                enableComposerCompletion: { type: "boolean", default: true },
                                uiLanguage: { type: "string", nullable: true },
                                drafts: {
                                    type: "array",
                                    items: {
                                        type: "object",
                                        properties: {
                                            sessionId: { type: "string" },
                                            input: { type: "string", default: "" },
                                            replyTo: {
                                                type: "object",
                                                nullable: true,
                                                properties: {
                                                    id: { type: "string" },
                                                    role: { type: "string" },
                                                    content: { type: "string", nullable: true },
                                                },
                                                additionalProperties: false,
                                            },
                                        },
                                        additionalProperties: false,
                                    },
                                    default: [],
                                },
                            },
                            additionalProperties: false,
                            default: {
                                provider: "",
                                model: "",
                                assistantId: "",
                                streaming: false,
                                thinking: false,
                                thinkingModeSource: "assistant",
                                temperature: 0.7,
                                showDebugDetails: false,
                                enableComposerCompletion: true,
                                drafts: [],
                            }
                        }
                    },
                    additionalProperties: false
                },
                observability: {
                    type: "object",
                    properties: {
                        localTracing: {type: 'boolean', default: false},
                        captureContent: {type: 'boolean', default: false},
                        retention: {type: 'object', additionalProperties: false, default: {}, properties: {
                            runtimeDays: {type: 'integer', minimum: 1, maximum: 365, default: 7},
                            diagnosticsDays: {type: 'integer', minimum: 1, maximum: 365, default: 30},
                            traceDays: {type: 'integer', minimum: 1, maximum: 365, default: 30},
                            usageDays: {type: 'integer', minimum: 1, maximum: 365, default: 365},
                        }},
                        langfuse: {
                            type: "object",
                            properties: {
                                enabled: { type: "boolean", default: false },
                                host: { type: "string", nullable: true },
                                publicKey: { type: "string", nullable: true },
                                encryptedSecretKey: { type: "string", nullable: true },
                                environment: { type: "string", default: "production" },
                                release: { type: "string", nullable: true },
                            },
                            additionalProperties: false,
                        },
                    },
                    additionalProperties: false,
                }
            },
            additionalProperties: false,
            default: {
                chat: [],
                coding: [],
                options: {
                    chatStreamingDefault: false,
                    chatDialog: {
                        provider: "",
                        model: "",
                        assistantId: "",
                        streaming: false,
                        thinking: false,
                        temperature: 0.7,
                        showDebugDetails: false,
                        enableComposerCompletion: true,
                        uiLanguage: null,
                        drafts: [],
                    }
                },
                observability: {
                    langfuse: {
                        enabled: false,
                        host: null,
                        publicKey: null,
                        encryptedSecretKey: null,
                        environment: "production",
                        release: null,
                    },
                }
            },
        }
    }
});

if (typeof settings.get === 'function' && typeof settings.set === 'function') migrateCodingTimeoutDefaults(settings);
