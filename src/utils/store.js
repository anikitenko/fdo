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
        }
    }
});

