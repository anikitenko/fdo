import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {BLANK_TEMPLATE_MAIN, BLANK_TEMPLATE_RENDER, BLANK_TEMPLATE_TEST, createPluginTemplateFiles} from "../../src/components/editor/utils/virtualTemplates";
import {compileCssStyleModule} from "../../src/utils/esbuild/plugins/cssStyleModule";

// Exercise the generated examples against the installed SDK, as the plugin runner does.
test("blank plugin example tests pass against its generated render module", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "fdo-blank-tests-"));
    try {
        fs.writeFileSync(path.join(directory, "render.tsx"), BLANK_TEMPLATE_RENDER("Example"));
        const files = createPluginTemplateFiles({name: 'example', displayName: 'Example', template: 'blank'});
        fs.writeFileSync(path.join(directory, "styles.css"), await compileCssStyleModule(files, '/styles.css'));
        fs.writeFileSync(path.join(directory, "index.ts"), BLANK_TEMPLATE_MAIN("Example"));
        fs.writeFileSync(path.join(directory, "render.test.ts"), BLANK_TEMPLATE_TEST("Example") + `
import {PluginRegistry} from "@anikitenko/fdo-sdk";
process.parentPort = {on() {}, postMessage() {}};
require("./index");
test("refreshStatus returns a backend response after init", async () => {
    PluginRegistry.callInit();
    const response = await PluginRegistry.callHandler("refreshStatus", {});
    assert.equal(response.success, true);
    assert.match(response.message, /Example is running/);
});
`);
        const build = spawnSync(process.execPath, ["-e",
            'require(process.argv[1]).buildSync(JSON.parse(process.argv[2]))',
            require.resolve("esbuild"),
            JSON.stringify({entryPoints: [path.join(directory, "render.test.ts")],
                bundle: true, platform: "node", external: ["@anikitenko/fdo-sdk"], loader: {".css": "js"},
                outfile: path.join(directory, "test.cjs")}),
        ], {encoding: "utf8"});
        expect({status: build.status, error: build.status ? build.stderr : ""}).toEqual({status: 0, error: ""});
        const result = spawnSync(process.execPath, ["--test", path.join(directory, "test.cjs")], {
            env: {...process.env, ELECTRON_RUN_AS_NODE: "1", NODE_PATH: path.resolve("node_modules")},
            encoding: "utf8",
        });
        expect({status: result.status, output: result.status ? result.stdout + result.stderr : ""})
            .toEqual({status: 0, output: ""});
    } finally {
        fs.rmSync(directory, {recursive: true, force: true});
    }
});
