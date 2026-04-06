import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import PluginORM from "../../src/utils/PluginORM";

describe("PluginORM capability persistence", () => {
    test("normalizes missing capabilities to empty array and preserves explicit grants", () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fdo-plugin-orm-"));
        const dbPath = path.join(tempDir, "plugins.json");

        try {
            const orm = new PluginORM(dbPath);
            orm.addPlugin("no-cap-plugin", {name: "N", version: "1.0.0", author: "A", description: "D", icon: "clean"}, "/tmp/p1", "dist/index.cjs");
            orm.addPlugin(
                "cap-plugin",
                {name: "C", version: "1.0.0", author: "A", description: "D", icon: "clean"},
                "/tmp/p2",
                "dist/index.cjs",
                false,
                ["storage.json"]
            );

            const noCap = orm.getPlugin("no-cap-plugin");
            const withCap = orm.getPlugin("cap-plugin");

            expect(noCap.capabilities).toEqual([]);
            expect(withCap.capabilities).toEqual(["storage.json"]);
            expect(Array.isArray(orm.getAllPlugins()[0].capabilities)).toBe(true);
            expect(Array.isArray(orm.getAllPlugins()[1].capabilities)).toBe(true);
        } finally {
            fs.rmSync(tempDir, {recursive: true, force: true});
        }
    });
});
