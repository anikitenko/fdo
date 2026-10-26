// Plugin tests and runtime imports use Node's node: protocol. Monaco does not
// discover @types/node through directory listing, so the editor has to pull the
// bundled declarations in by reference. The fallback covers the same modules
// when those declarations were not copied into the editor.

export const NODE_TYPES_SHIM_PATH = "/node_modules/@types/fdo-node-builtins.d.ts";
export const NODE_TYPES_SHIM = '/// <reference path="/node_modules/@types/node/index.d.ts" />\n';
export const NODE_TYPES_FALLBACK_PATH = "/node_modules/@types/fdo-node-builtin-fallback.d.ts";

const builtin = (name, body) => `declare module ${JSON.stringify(name)} {\n${body}\n}\n`;

const moduleWith = (names) => {
    const functions = names.map(name => `export function ${name}(...args: any[]): any;`).join("\n");
    const fields = names.map(name => `${name}: typeof ${name};`).join(" ");
    return `${functions}
const api: { ${fields} [member: string]: any };
export default api;`;
};

const namedBuiltins = {
    "node:assert": ["deepEqual", "deepStrictEqual", "doesNotMatch", "doesNotReject", "doesNotThrow", "equal", "fail", "ifError", "match", "notDeepEqual", "notDeepStrictEqual", "notEqual", "ok", "rejects", "strictEqual", "throws"],
    "node:buffer": ["Buffer"],
    "node:child_process": ["exec", "execFile", "execFileSync", "execSync", "spawn", "spawnSync"],
    "node:crypto": ["createHash", "randomBytes", "randomUUID"],
    "node:dns": ["lookup", "resolve"],
    "node:dns/promises": ["lookup", "resolve"],
    "node:events": ["EventEmitter", "once"],
    "node:fs": ["accessSync", "copyFileSync", "existsSync", "mkdirSync", "readFileSync", "readdirSync", "rmSync", "statSync", "writeFileSync"],
    "node:fs/promises": ["access", "copyFile", "mkdir", "readFile", "readdir", "rm", "stat", "writeFile"],
    "node:http": ["createServer", "request"],
    "node:https": ["createServer", "request"],
    "node:module": ["createRequire"],
    "node:net": ["createConnection", "createServer"],
    "node:os": ["arch", "homedir", "hostname", "platform", "tmpdir"],
    "node:path": ["basename", "dirname", "extname", "isAbsolute", "join", "relative", "resolve"],
    "node:readline": ["createInterface"],
    "node:stream": ["Readable", "Writable", "pipeline"],
    "node:string_decoder": ["StringDecoder"],
    "node:timers": ["setInterval", "setTimeout"],
    "node:timers/promises": ["setTimeout"],
    "node:url": ["fileURLToPath", "pathToFileURL", "URL"],
    "node:util": ["promisify", "types"],
    "node:vm": ["runInNewContext"],
    "node:worker_threads": ["Worker", "parentPort"],
    "node:zlib": ["gzipSync", "gunzipSync"],
};

export const NODE_TYPES_FALLBACK = `${builtin("node:test", `function test(name: string, fn: (...args: any[]) => unknown): void;
function test(name: string, options: Record<string, unknown>, fn: (...args: any[]) => unknown): void;
namespace test {
    function skip(name: string, fn?: (...args: any[]) => unknown): void;
    function todo(name: string, fn?: (...args: any[]) => unknown): void;
    function only(name: string, fn?: (...args: any[]) => unknown): void;
}
function describe(name: string, fn: () => unknown): void;
function it(name: string, fn: (...args: any[]) => unknown): void;
function before(fn: () => unknown): void;
function after(fn: () => unknown): void;
function beforeEach(fn: () => unknown): void;
function afterEach(fn: () => unknown): void;
export {after, afterEach, before, beforeEach, describe, it, test};
export default test;`)}
${builtin("node:assert/strict", `function equal(actual: unknown, expected: unknown, message?: unknown): void;
function notEqual(actual: unknown, expected: unknown, message?: unknown): void;
function deepEqual(actual: unknown, expected: unknown, message?: unknown): void;
function notDeepEqual(actual: unknown, expected: unknown, message?: unknown): void;
function strictEqual(actual: unknown, expected: unknown, message?: unknown): void;
function deepStrictEqual(actual: unknown, expected: unknown, message?: unknown): void;
function notDeepStrictEqual(actual: unknown, expected: unknown, message?: unknown): void;
function ok(value: unknown, message?: unknown): void;
function match(value: string, expression: RegExp, message?: unknown): void;
function doesNotMatch(value: string, expression: RegExp, message?: unknown): void;
function throws(block: () => unknown, error?: unknown, message?: unknown): void;
function doesNotThrow(block: () => unknown, message?: unknown): void;
function rejects(block: (() => unknown) | Promise<unknown>, error?: unknown, message?: unknown): Promise<void>;
function doesNotReject(block: (() => unknown) | Promise<unknown>, message?: unknown): Promise<void>;
function fail(message?: unknown): never;
function ifError(value: unknown): void;
const strict: {
    equal: typeof equal;
    notEqual: typeof notEqual;
    deepEqual: typeof deepEqual;
    notDeepEqual: typeof notDeepEqual;
    strictEqual: typeof strictEqual;
    deepStrictEqual: typeof deepStrictEqual;
    notDeepStrictEqual: typeof notDeepStrictEqual;
    ok: typeof ok;
    match: typeof match;
    doesNotMatch: typeof doesNotMatch;
    throws: typeof throws;
    doesNotThrow: typeof doesNotThrow;
    rejects: typeof rejects;
    doesNotReject: typeof doesNotReject;
    fail: typeof fail;
    ifError: typeof ifError;
};
export {deepEqual, deepStrictEqual, doesNotMatch, doesNotReject, doesNotThrow, equal, fail, ifError, match, notDeepEqual, notDeepStrictEqual, notEqual, ok, rejects, strictEqual, throws};
export default strict;`)}
${Object.entries(namedBuiltins).map(([name, members]) => builtin(name, moduleWith(members))).join("\n")}
`;

export function registerNodeBuiltinEditorTypes(tsDefaults, jsDefaults, moduleFiles = []) {
    const hasNodeTypes = moduleFiles.some(file => String(file?.path || "").replace(/\\/g, "/") === "@types/node/index.d.ts");
    const path = hasNodeTypes ? NODE_TYPES_SHIM_PATH : NODE_TYPES_FALLBACK_PATH;
    const content = hasNodeTypes ? NODE_TYPES_SHIM : NODE_TYPES_FALLBACK;
    tsDefaults?.addExtraLib?.(content, path);
    jsDefaults?.addExtraLib?.(content, path);
    return {hasNodeTypes, path, content};
}
