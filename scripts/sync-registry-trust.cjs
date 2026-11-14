#!/usr/bin/env node
'use strict';
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
// AWS credentials establish the initial release pin, independently of the public HTTPS endpoint.
const stack = process.env.FDO_REGISTRY_STACK || 'FdoPluginRegistryStack';
const region = process.env.AWS_REGION || 'us-east-1';
const result = JSON.parse(
    execFileSync(
        'aws',
        [
            'cloudformation',
            'describe-stacks',
            '--stack-name',
            stack,
            '--region',
            region,
            '--output',
            'json',
        ],
        { encoding: 'utf8' },
    ),
);
const outputs = Object.fromEntries(
    result.Stacks[0].Outputs.map((item) => [item.OutputKey, item.OutputValue]),
);
if (!/^[a-f0-9]{64}$/i.test(outputs.RegistryRootFingerprint256 || ''))
    throw new Error('Deploy the registry certificate lifecycle before syncing FDO trust.');
const url = new URL(outputs.RegistryUrl);
if (url.protocol !== 'https:' || url.origin !== outputs.RegistryUrl)
    throw new Error('Invalid registry origin.');
const config = {
    certificateUrl: `${url.origin}/api/v1/registry/certificate`,
    trustUrl: `${url.origin}/api/v1/registry/trust`,
    rootFingerprint256: outputs.RegistryRootFingerprint256,
};
fs.writeFileSync(
    path.join(__dirname, '../src/config/officialRegistry.json'),
    JSON.stringify(config, null, 2) + '\n',
);
console.log(
    'Updated the FDO release trust configuration from authenticated CloudFormation outputs. Review and release this public configuration with FDO.',
);
