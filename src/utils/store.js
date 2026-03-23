import Store from 'electron-store';

export const settings = new Store({
    encryptionKey: "FDO-APPLICATION",
    name: "settings",
    schema: {
        certificates: {
            type: 'object',
            properties: {
                root: {
                    type: 'array',
                    items: {
                        type: 'object',
                        required: ['cert'],
                        properties: {
                            key: {
                                type: 'string',
                                pattern: '^-----BEGIN (RSA )?PRIVATE KEY-----([\\s\\S]*?)-----END \\1PRIVATE KEY-----\\s*$',
                                nullable: true
                            },
                            cert: {
                                type: 'string',
                                pattern: '^-----BEGIN CERTIFICATE-----([\\s\\S]*?)-----END CERTIFICATE-----\\s*$'
                            },
                            chain: {
                                type: 'array',
                                items: {
                                    type: 'string',
                                    pattern: '^-----BEGIN CERTIFICATE-----([\\s\\S]*?)-----END CERTIFICATE-----\\s*$'
                                },
                                nullable: true
                            },
                            createdAt: {type: 'string', format: 'date-time'},
                            expiresAt: {type: 'string', format: 'date-time'},
                            id: {type: 'string'},
                            identity: {type: 'string', nullable: true},
                            managedBy: {type: 'string', nullable: true},
                            label: {type: 'string'},
                            lastUsedAt: {type: 'string', format: 'date-time'},
                            imported: {type: 'boolean', default: false},
                        },
                        additionalProperties: false
                    }
                }
            },
            additionalProperties: false
        },
        notifications: {
            type: 'array',
            items: {
                type: 'object',
                required: ['id', 'title', 'message', 'type', 'createdAt'],
                properties: {
                    id: {type: 'string'},
                    title: {type: 'string'},
                    message: {type: 'string'},
                    type: {type: 'string', enum: ['primary', 'warning', 'danger', 'success', '']},
                    read: {type: 'boolean', default: false},
                    createdAt: {type: 'string', format: 'date-time'},
                    updatedAt: {type: 'string', format: 'date-time'}
                },
                additionalProperties: false
            }
        },
        ai: {
            type: "object",
            properties: {
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
                sessions: {
                    type: "array",
                    items: {
                        type: "object",
                        required: ["id", "name", "createdAt", "messages"],
                        properties: {
                            id: { type: "string" },
                            name: { type: "string" },
                            createdAt: { type: "string", format: "date-time" },
                            updatedAt: { type: "string", format: "date-time" },
                            messages: {
                                type: "array",
                                items: {
                                    type: "object",
                                    required: ["id", "role", "content", "createdAt"],
                                    properties: {
                                        id: { type: "string" },
                                        role: { type: "string", enum: ["user", "assistant"] },
                                        content: { type: "string" },
                                        contentAttachments: { type: "string" },
                                        replyContext: { type: "string" },
                                        replyTo: {
                                            type: "object",
                                            properties: {
                                                id: { type: "string" },
                                                role: { type: "string", enum: ["user", "assistant"] },
                                                content: { type: "string" },
                                            },
                                            required: ["id", "role", "content"],
                                            additionalProperties: false,
                                        },
                                        createdAt: { type: "string", format: "date-time" },
                                        model: { type: "string" },
                                        inputTokens: { type: "number", minimum: 0},
                                        outputTokens: { type: "number", minimum: 0 },
                                        local: { type: "boolean", default: false },
                                        totalTokens: { type: "number", minimum: 0 },
                                        inputCost: { type: "number", minimum: 0 },
                                        outputCost: { type: "number", minimum: 0 },
                                        totalCost: { type: "number", minimum: 0 },
                                        clarification: { type: "boolean", default: false },
                                        grounded: { type: "boolean", default: false },
                                        noSourceMatches: { type: "boolean", default: false },
                                        sources: {
                                            type: "array",
                                            items: { type: "string" },
                                        },
                                        sourceDetails: {
                                            type: "array",
                                            items: {
                                                type: "object",
                                                properties: {
                                                    source: { type: "string" },
                                                    rawSource: { type: "string", nullable: true },
                                                    why: { type: "string", nullable: true },
                                                    sourceType: { type: "string", nullable: true },
                                                    snippet: { type: "string", nullable: true },
                                                },
                                                required: ["source"],
                                                additionalProperties: false,
                                            },
                                        },
                                        retrievalConfidence: { type: "number", minimum: 0, maximum: 1 },
                                        retrievalConflict: { type: "boolean", default: false },
                                        toolsUsed: {
                                            type: "array",
                                            items: { type: "string" },
                                        },
                                        toolErrors: {
                                            type: "array",
                                            items: {
                                                type: "object",
                                                properties: {
                                                    name: { type: "string" },
                                                    error: { type: "string" },
                                                },
                                                required: ["name", "error"],
                                                additionalProperties: false,
                                            },
                                        },
                                        attachments: {
                                            type: "array",
                                            items: {
                                                type: "object",
                                                properties: {
                                                    type: {type: "string"},
                                                    path: {type: "string"},
                                                    name: {type: "string"},
                                                    category: {type: "string"},
                                                },
                                                additionalProperties: false
                                            },
                                        },
                                    },
                                    additionalProperties: false
                                }
                            },
                            stats: {
                                type: "object",
                                properties: {
                                    models: {
                                        type: "object",
                                        additionalProperties: {
                                            type: "object",
                                            required: ["model", "provider", "estimatedUsed", "maxTokens", "percentUsed", "updatedAt"],
                                            properties: {
                                                model: { type: "string" },
                                                provider: { type: "string" },
                                                estimatedUsed: { type: "number", minimum: 0 },
                                                totalMessages: { type: "number", minimum: 0 },
                                                maxTokens: { type: "number", minimum: 1 },
                                                percentUsed: { type: "number", minimum: 0 },
                                                updatedAt: { type: "string", format: "date-time" },
                                            },
                                        },
                                    },
                                    summary: {
                                        type: "object",
                                        properties: {
                                            totalTokens: { type: "number" },
                                            totalMessages: { type: "number" },
                                            lastModel: { type: "string" },
                                            updatedAt: { type: "string", format: "date-time" },
                                        },
                                        additionalProperties: false,
                                    },
                                },
                                additionalProperties: false,
                            },
                            routing: {
                                type: "object",
                                properties: {
                                    activeRoute: { type: "string" },
                                    activeTool: { type: "string", nullable: true },
                                    activeTaskShape: { type: "string" },
                                    activeScope: { type: "string" },
                                    routeConfidence: { type: "number", minimum: 0, maximum: 1 },
                                    lastToolUsedAt: { type: "string", format: "date-time", nullable: true },
                                    lastRouteChangeAt: { type: "string", format: "date-time", nullable: true },
                                    recentToolHistory: {
                                        type: "array",
                                        items: { type: "string" },
                                    },
                                    lastTopicalUserPrompt: { type: "string", nullable: true },
                                    lastTopicalAssistantReply: { type: "string", nullable: true },
                                },
                                additionalProperties: false,
                            },
                            memory: {
                                type: "object",
                                properties: {
                                    preferences: {
                                        type: "object",
                                        properties: {
                                            preferredLanguage: { type: "string", nullable: true },
                                            responseStyle: { type: "string", nullable: true },
                                        },
                                        additionalProperties: false,
                                    },
                                    summary: {
                                        type: "object",
                                        properties: {
                                            content: { type: "string", nullable: true },
                                            model: { type: "string", nullable: true },
                                            updatedAt: { type: "string", format: "date-time", nullable: true },
                                        },
                                        additionalProperties: false,
                                    },
                                },
                                additionalProperties: false,
                            },
                        },
                        additionalProperties: false
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
                metrics: {
                    type: "object",
                    properties: {
                        retrieval: {
                            type: "object",
                            properties: {
                                totalQueries: { type: "number", minimum: 0, default: 0 },
                                hits: { type: "number", minimum: 0, default: 0 },
                                misses: { type: "number", minimum: 0, default: 0 },
                                lowConfidence: { type: "number", minimum: 0, default: 0 },
                                conflicts: { type: "number", minimum: 0, default: 0 },
                                totalCandidateCount: { type: "number", minimum: 0, default: 0 },
                                totalSelectedCount: { type: "number", minimum: 0, default: 0 },
                                totalDroppedCount: { type: "number", minimum: 0, default: 0 },
                                totalRetrievalTimeMs: { type: "number", minimum: 0, default: 0 },
                                confidenceSum: { type: "number", minimum: 0, default: 0 },
                                missNoResults: { type: "number", minimum: 0, default: 0 },
                                missLowConfidence: { type: "number", minimum: 0, default: 0 },
                                missErrors: { type: "number", minimum: 0, default: 0 },
                                recentMisses: {
                                    type: "array",
                                    items: {
                                        type: "object",
                                        properties: {
                                            ts: { type: "string", format: "date-time" },
                                            tool: { type: "string" },
                                            query: { type: "string" },
                                            scope: { type: "string" },
                                            reason: { type: "string" },
                                            confidence: { type: "number", minimum: 0, maximum: 1, nullable: true },
                                        },
                                        required: ["ts", "tool", "query", "scope", "reason"],
                                        additionalProperties: false,
                                    },
                                },
                            },
                            additionalProperties: false,
                        },
                        tools: {
                            type: "object",
                            properties: {
                                totalCalls: { type: "number", minimum: 0, default: 0 },
                                countsByTool: {
                                    type: "object",
                                    additionalProperties: { type: "number", minimum: 0 },
                                },
                            },
                            additionalProperties: false,
                        },
                        answers: {
                            type: "object",
                            properties: {
                                totalReplies: { type: "number", minimum: 0, default: 0 },
                                groundedReplies: { type: "number", minimum: 0, default: 0 },
                                ungroundedReplies: { type: "number", minimum: 0, default: 0 },
                                noSourceMatches: { type: "number", minimum: 0, default: 0 },
                                clarificationReplies: { type: "number", minimum: 0, default: 0 },
                            },
                            additionalProperties: false,
                        },
                        tokens: {
                            type: "object",
                            properties: {
                                requests: { type: "number", minimum: 0, default: 0 },
                                streamRequests: { type: "number", minimum: 0, default: 0 },
                                nonStreamRequests: { type: "number", minimum: 0, default: 0 },
                                toolFollowUpRequests: { type: "number", minimum: 0, default: 0 },
                                promptTokens: { type: "number", minimum: 0, default: 0 },
                                retrievalTokens: { type: "number", minimum: 0, default: 0 },
                                outputTokens: { type: "number", minimum: 0, default: 0 },
                                totalTokens: { type: "number", minimum: 0, default: 0 },
                            },
                            additionalProperties: false,
                        },
                    },
                    additionalProperties: false,
                },
                observability: {
                    type: "object",
                    properties: {
                        langfuse: {
                            type: "object",
                            properties: {
                                enabled: { type: "boolean", default: false },
                                host: { type: "string", nullable: true },
                                publicKey: { type: "string", nullable: true },
                                secretKey: { type: "string", nullable: true },
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
                sessions: [],
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
                metrics: {
                    retrieval: {
                        totalQueries: 0,
                        hits: 0,
                        misses: 0,
                        lowConfidence: 0,
                        conflicts: 0,
                        totalCandidateCount: 0,
                        totalSelectedCount: 0,
                        totalDroppedCount: 0,
                        totalRetrievalTimeMs: 0,
                        confidenceSum: 0,
                        missNoResults: 0,
                        missLowConfidence: 0,
                        missErrors: 0,
                        recentMisses: []
                    },
                    tools: {
                        totalCalls: 0,
                        countsByTool: {}
                    },
                    answers: {
                        totalReplies: 0,
                        groundedReplies: 0,
                        ungroundedReplies: 0,
                        noSourceMatches: 0,
                        clarificationReplies: 0
                    },
                    tokens: {
                        requests: 0,
                        streamRequests: 0,
                        nonStreamRequests: 0,
                        toolFollowUpRequests: 0,
                        promptTokens: 0,
                        retrievalTokens: 0,
                        outputTokens: 0,
                        totalTokens: 0
                    }
                },
                observability: {
                    langfuse: {
                        enabled: false,
                        host: null,
                        publicKey: null,
                        secretKey: null,
                        environment: "production",
                        release: null,
                    },
                }
            },
        }
    }
});
