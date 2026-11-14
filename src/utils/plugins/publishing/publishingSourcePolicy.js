export const PUBLISHING_EXCLUSIONS = ['dist/', 'build/', 'node_modules/', '.git/', 'fdo.signature', 'fdo.meta.json', '.env', '.env.*', '*.pem', '*.key', '*.crt', '*.cert', '*.sqlite', '*.sqlite-*', '*.db', '*.p12', '*.pfx', '*.zip', '*.tgz', '.aws/', '.ssh/', '*.map', '.gitignore', 'coverage/', 'test/', 'tests/', '__tests__/', '__mocks__/',
    ...['test', 'spec'].flatMap(kind => ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'].map(extension => `**/*.${kind}.${extension}`)),
];
