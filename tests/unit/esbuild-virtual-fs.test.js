import {EsbuildVirtualFsPlugin} from "../../src/utils/esbuild/plugins/virtual-fs.js";

describe("esbuild virtual-fs plugin", () => {
    test('CSS loader exports grouped styles and imported media rules on registerable entries', async () => {
        const handlers = [];
        EsbuildVirtualFsPlugin({
            '/styles.css': '@import "./base.css"; @media (max-width: 600px) { .control, .textarea { width: 100%; } }',
            '/base.css': '.control, .textarea { color: red; } .control:focus-visible, .textarea:focus-visible { outline: 2px solid blue; }',
        }).setup({initialOptions: {}, onResolve() {}, onLoad: (options, callback) => handlers.push({options, callback})});
        const loader = handlers.find(handler => String(handler.options.filter) === '/\\.css$/');
        const response = await loader.callback({path: '/styles.css'});
        const map = JSON.parse(response.contents.replace(/^export default /, '').replace(/;$/, ''));
        for (const name of ['control', 'textarea']) {
            expect(map[name]).toEqual({color: 'red', '&:focus-visible': {outline: '2px solid blue'},
                '@media (max-width: 600px)': {width: '100%'}});
        }
        expect(response.loader).toBe('js');
    });
    function createBuildHarness(initialOptions = {}) {
        const resolveHandlers = [];
        const build = {
            initialOptions,
            onResolve: (options, callback) => resolveHandlers.push({options, callback}),
            onLoad: () => {},
        };
        return {build, resolveHandlers};
    }

    function getPackageResolveHandler(resolveHandlers) {
        return resolveHandlers.find(({options}) => String(options?.filter) === "/^[^.\\/]/");
    }

    test("marks node: builtins as external", () => {
        const plugin = EsbuildVirtualFsPlugin({});
        const {build, resolveHandlers} = createBuildHarness();

        plugin.setup(build);

        const packageResolve = getPackageResolveHandler(resolveHandlers);
        expect(packageResolve).toBeTruthy();

        const result = packageResolve.callback({
            path: "node:crypto",
            importer: "/index.ts",
            namespace: "virtual",
        });

        expect(result).toEqual({external: true});
    });

    test("preserves configured externals for scoped packages and subpaths", () => {
        const plugin = EsbuildVirtualFsPlugin({});
        const {build, resolveHandlers} = createBuildHarness({
            external: ["@anikitenko/fdo-sdk"],
        });

        plugin.setup(build);

        const packageResolve = getPackageResolveHandler(resolveHandlers);
        expect(packageResolve).toBeTruthy();

        const bareResult = packageResolve.callback({
            path: "@anikitenko/fdo-sdk",
            importer: "/index.ts",
            namespace: "virtual",
        });
        const subpathResult = packageResolve.callback({
            path: "@anikitenko/fdo-sdk/dist/fdo-sdk.bundle.js",
            importer: "/index.ts",
            namespace: "virtual",
        });

        expect(bareResult).toEqual({external: true});
        expect(subpathResult).toEqual({external: true});
    });

    test("maps NodeNext-style .js specifiers onto TypeScript sources", () => {
        // './module.js' must bundle when only './module.ts' exists, matching
        // the pre-generation import validator.
        const plugin = EsbuildVirtualFsPlugin({
            "/features/dashboard/render.ts": "export const Dashboard = 1;",
            "/render.tsx": 'import {Dashboard} from "./features/dashboard/render.js";',
        });
        const {build, resolveHandlers} = createBuildHarness();
        plugin.setup(build);

        const relativeResolve = resolveHandlers
            .find(({options}) => String(options?.filter) === "/^(\\.\\/|\\.\\.|\\/)/");
        expect(relativeResolve).toBeTruthy();

        expect(relativeResolve.callback({path: "./features/dashboard/render.js", importer: "/render.tsx"}))
            .toEqual({path: "/features/dashboard/render.ts", namespace: "virtual"});

        // A real .js file still wins when both exist: literal path first.
        const sibling = EsbuildVirtualFsPlugin({"/ui.js": "js", "/ui.ts": "ts"});
        const siblingHandlers = [];
        sibling.setup({initialOptions: {}, onResolve: (options, callback) => siblingHandlers.push({options, callback}), onLoad: () => {}});
        const siblingRelative = siblingHandlers
            .find(({options}) => String(options?.filter) === "/^(\\.\\/|\\.\\.|\\/)/");
        expect(siblingRelative.callback({path: "./ui.js", importer: "/render.tsx"}))
            .toEqual({path: "/ui.js", namespace: "virtual"});
        // Unresolvable specifiers still fail loudly instead of bundling void.
        expect(relativeResolve.callback({path: "./features/missing/render.js", importer: "/render.tsx"}).errors)
            .toHaveLength(1);
    });
});
