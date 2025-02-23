export const packageJsonContent = (name) => JSON.stringify({
    name: name,
    version: "1.0.0",
    type: "module",
    dependencies: {
        "@anikitenko/fdo-sdk": "^1.0.10",
    }
}, null, 2);

export const packageLockContent = (name) => JSON.stringify({
    name: name,
    lockfileVersion: 1,
    dependencies: {}
}, null, 2);
