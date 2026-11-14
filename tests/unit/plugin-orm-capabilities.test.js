import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import PluginORM from "../../src/utils/persistence/PluginORM";

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
test('approval clears a registry capability-review flag while preserving durable provenance',()=>{
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'registry-grants-'));
    try {
        const file=path.join(directory,'plugins.json');
        fs.writeFileSync(file,JSON.stringify({plugins:[{id:'registry-plugin',capabilities:[],registry:{origin:'https://plugins.fdo.alexvwan.me',pluginId:'source',version:'2.0.0',declaredCapabilities:['storage'],needsCapabilityReview:true}}]}));
        const orm=new PluginORM(file);orm.setPluginCapabilities('registry-plugin',['storage']);
        const saved=new PluginORM(file).getPlugin('registry-plugin');expect(saved.registry).toMatchObject({pluginId:'source',version:'2.0.0',needsCapabilityReview:false});
        orm.setPluginCapabilities('registry-plugin',[]);expect(new PluginORM(file).getPlugin('registry-plugin').registry.needsCapabilityReview).toBe(true);
    } finally {fs.rmSync(directory,{recursive:true,force:true});}
});
