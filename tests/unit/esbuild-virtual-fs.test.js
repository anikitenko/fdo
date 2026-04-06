import {EsbuildVirtualFsPlugin} from "../../src/utils/esbuild/plugins/virtual-fs.js";

describe("esbuild virtual-fs plugin", () => {
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
});
