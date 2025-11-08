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
                            default: {type: "boolean", default: false},
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
                            default: {type: "boolean", default: false},
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
                                        createdAt: { type: "string", format: "date-time" },
                                        model: { type: "string" },
                                        inputTokens: { type: "number", minimum: 0},
                                        outputTokens: { type: "number", minimum: 0 },
                                        local: { type: "boolean", default: false },
                                        totalTokens: { type: "number", minimum: 0 },
                                        inputCost: { type: "number", minimum: 0 },
                                        outputCost: { type: "number", minimum: 0 },
                                        totalCost: { type: "number", minimum: 0 },
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
                                                percentUsed: { type: "number", minimum: 0, maximum: 100 },
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
                        },
                        additionalProperties: false
                    }
                },
                options: {
                    type: "object",
                    properties: {
                        chatStreamingDefault: { type: "boolean", default: false }
                    },
                    additionalProperties: false
                }
            },
            additionalProperties: false,
            default: {
                chat: [],
                coding: [],
                sessions: [],
                options: { chatStreamingDefault: false }
            },
        }
    }
});

