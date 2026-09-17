import fs from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import {
    runSdkMigration,
    SdkMigrationErrorCode,
} from "../../src/utils/sdkMigrationCli";

describe("sdk migration cli utility", () => {
    function createTempWorkspace() {
        return fs.mkdtempSync(nodePath.join(os.tmpdir(), "fdo-sdk-migrate-"));
    }

    function migrationStub(source) {
        if (!source.includes("legacyCall();")) {
            return {output: source, changed: false, changes: []};
        }
        return {
            output: source.replace("legacyCall();", "modernCall();"),
            changed: true,
            changes: [
                {
                    rule: "privileged-envelope-extract-helper",
                    replacements: 1,
                    description: "migration hit",
                },
            ],
        };
    }

    test("dry-run reports pending changes and does not write to disk", async () => {
        const root = createTempWorkspace();
        const candidatePath = nodePath.join(root, "plugin.ts");
        const unchangedPath = nodePath.join(root, "noop.js");
        const skippedPath = nodePath.join(root, "notes.md");
        fs.writeFileSync(candidatePath, "legacyCall();\n", "utf8");
        fs.writeFileSync(unchangedPath, "const ok = true;\n", "utf8");
        fs.writeFileSync(skippedPath, "legacyCall();\n", "utf8");

        try {
            const report = await runSdkMigration({
                target: root,
                applyCodemod: migrationStub,
            });

            expect(report.mode).toBe("dry-run");
            expect(report.scannedFiles).toBe(2);
            expect(report.filesToUpdate).toBe(1);
            expect(report.updatedFiles).toBe(0);
            expect(report.files[0]).toEqual(expect.objectContaining({
                relativePath: "plugin.ts",
            }));
            expect(report.ruleHits).toEqual([
                {
                    rule: "privileged-envelope-extract-helper",
                    replacements: 1,
                    files: [expect.stringContaining("/plugin.ts")],
                },
            ]);
            expect(fs.readFileSync(candidatePath, "utf8")).toContain("legacyCall();");
        } finally {
            fs.rmSync(root, {recursive: true, force: true});
        }
    });

    test("write mode applies migration only after confirmation", async () => {
        const root = createTempWorkspace();
        const candidatePath = nodePath.join(root, "plugin.ts");
        fs.writeFileSync(candidatePath, "legacyCall();\n", "utf8");
        const confirmWrite = jest.fn(async () => true);

        try {
            const report = await runSdkMigration({
                target: root,
                write: true,
                applyCodemod: migrationStub,
                confirmWrite,
            });

            expect(confirmWrite).toHaveBeenCalledWith(expect.objectContaining({
                filesToUpdate: 1,
            }));
            expect(report.mode).toBe("write");
            expect(report.filesToUpdate).toBe(1);
            expect(report.updatedFiles).toBe(1);
            expect(report.cancelled).toBe(false);
            expect(fs.readFileSync(candidatePath, "utf8")).toContain("modernCall();");
        } finally {
            fs.rmSync(root, {recursive: true, force: true});
        }
    });

    test("write mode can be cancelled via confirmation callback", async () => {
        const root = createTempWorkspace();
        const candidatePath = nodePath.join(root, "plugin.ts");
        fs.writeFileSync(candidatePath, "legacyCall();\n", "utf8");

        try {
            const report = await runSdkMigration({
                target: root,
                write: true,
                applyCodemod: migrationStub,
                confirmWrite: async () => false,
            });

            expect(report.cancelled).toBe(true);
            expect(report.updatedFiles).toBe(0);
            expect(fs.readFileSync(candidatePath, "utf8")).toContain("legacyCall();");
        } finally {
            fs.rmSync(root, {recursive: true, force: true});
        }
    });

    test("throws structured errors for invalid target arguments", async () => {
        await expect(runSdkMigration({target: ""})).rejects.toEqual(
            expect.objectContaining({code: SdkMigrationErrorCode.INVALID_ARGUMENT})
        );
        await expect(runSdkMigration({target: "/__missing_fdo_sdk_migrate_target__"})).rejects.toEqual(
            expect.objectContaining({code: SdkMigrationErrorCode.INVALID_TARGET})
        );
    });
});
