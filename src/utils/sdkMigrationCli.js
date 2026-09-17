import fs from "node:fs";
import nodePath from "node:path";
import * as fdoSdk from "@anikitenko/fdo-sdk";

const SUPPORTED_SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"]);
const SKIPPED_DIRECTORIES = new Set([".git", "node_modules", "dist", "release", "coverage"]);

export const SdkMigrationErrorCode = Object.freeze({
    INVALID_ARGUMENT: "SDK_MIGRATE_INVALID_ARGUMENT",
    INVALID_TARGET: "SDK_MIGRATE_INVALID_TARGET",
    HELPER_UNAVAILABLE: "SDK_MIGRATE_HELPER_UNAVAILABLE",
    EXECUTION_FAILED: "SDK_MIGRATE_EXECUTION_FAILED",
});

function createSdkMigrationError(message, code, cause = undefined) {
    const error = new Error(message);
    error.code = code;
    if (cause !== undefined) {
        error.cause = cause;
    }
    return error;
}

function normalizePathForDisplay(filePath) {
    return String(filePath || "").replace(/\\/g, "/");
}

function getSdkMigrationEngine() {
    if (typeof fdoSdk.applySdkMigrationCodemod === "function") {
        return fdoSdk.applySdkMigrationCodemod;
    }

    throw createSdkMigrationError(
        "Installed @anikitenko/fdo-sdk does not expose applySdkMigrationCodemod(). Update SDK to a newer version.",
        SdkMigrationErrorCode.HELPER_UNAVAILABLE
    );
}

function isCandidateSourceFile(filePath) {
    return SUPPORTED_SOURCE_EXTENSIONS.has(nodePath.extname(filePath).toLowerCase());
}

function collectMigrationCandidateFiles(targetPath) {
    const stat = fs.statSync(targetPath);

    if (stat.isFile()) {
        return isCandidateSourceFile(targetPath) ? [nodePath.resolve(targetPath)] : [];
    }

    if (!stat.isDirectory()) {
        return [];
    }

    const pending = [nodePath.resolve(targetPath)];
    const files = [];

    while (pending.length > 0) {
        const currentDir = pending.pop();
        const entries = fs.readdirSync(currentDir, {withFileTypes: true});

        for (const entry of entries) {
            const absolutePath = nodePath.join(currentDir, entry.name);
            if (entry.isDirectory()) {
                if (!SKIPPED_DIRECTORIES.has(entry.name)) {
                    pending.push(absolutePath);
                }
                continue;
            }

            if (entry.isFile() && isCandidateSourceFile(absolutePath)) {
                files.push(nodePath.resolve(absolutePath));
            }
        }
    }

    files.sort((left, right) => left.localeCompare(right));
    return files;
}

function aggregateRuleHits(changedFiles) {
    const ruleMap = new Map();

    for (const fileReport of changedFiles) {
        const filePath = fileReport.path;
        for (const hit of fileReport.ruleHits) {
            const existing = ruleMap.get(hit.rule) || {
                rule: hit.rule,
                replacements: 0,
                files: new Set(),
            };
            existing.replacements += Number(hit.replacements || 0);
            existing.files.add(filePath);
            ruleMap.set(hit.rule, existing);
        }
    }

    return Array.from(ruleMap.values())
        .map((entry) => ({
            rule: entry.rule,
            replacements: entry.replacements,
            files: Array.from(entry.files).sort((left, right) => left.localeCompare(right)),
        }))
        .sort((left, right) => left.rule.localeCompare(right.rule));
}

export async function runSdkMigration(options = {}) {
    const {
        target,
        cwd = process.cwd(),
        write = false,
        confirmWrite = async () => true,
        applyCodemod = null,
    } = options;

    if (typeof target !== "string" || !target.trim()) {
        throw createSdkMigrationError(
            'Missing required "--target <path>" argument for SDK migration.',
            SdkMigrationErrorCode.INVALID_ARGUMENT
        );
    }

    const resolvedTarget = nodePath.resolve(cwd, target);
    if (!fs.existsSync(resolvedTarget)) {
        throw createSdkMigrationError(
            `Target path does not exist: ${resolvedTarget}`,
            SdkMigrationErrorCode.INVALID_TARGET
        );
    }

    const candidateFiles = collectMigrationCandidateFiles(resolvedTarget);
    const codemod = typeof applyCodemod === "function" ? applyCodemod : getSdkMigrationEngine();
    const changedFiles = [];
    const pendingWrites = [];

    for (const filePath of candidateFiles) {
        const source = fs.readFileSync(filePath, "utf8");
        const result = codemod(source);

        if (!result || !result.changed || typeof result.output !== "string") {
            continue;
        }

        const relativePath = normalizePathForDisplay(nodePath.relative(resolvedTarget, filePath) || nodePath.basename(filePath));
        const ruleHits = Array.isArray(result.changes)
            ? result.changes.map((change) => ({
                rule: change.rule,
                replacements: Number(change.replacements || 0),
                description: String(change.description || ""),
            }))
            : [];

        changedFiles.push({
            path: normalizePathForDisplay(filePath),
            relativePath,
            ruleHits,
        });

        pendingWrites.push({path: filePath, output: result.output});
    }

    const report = {
        targetPath: normalizePathForDisplay(resolvedTarget),
        mode: write ? "write" : "dry-run",
        scannedFiles: candidateFiles.length,
        filesToUpdate: changedFiles.length,
        updatedFiles: 0,
        cancelled: false,
        files: changedFiles,
        ruleHits: aggregateRuleHits(changedFiles),
    };

    if (!write || pendingWrites.length === 0) {
        return report;
    }

    let confirmed = false;
    try {
        confirmed = !!(await confirmWrite({
            targetPath: report.targetPath,
            filesToUpdate: pendingWrites.length,
        }));
    } catch (error) {
        throw createSdkMigrationError(
            "Could not confirm migration write operation.",
            SdkMigrationErrorCode.EXECUTION_FAILED,
            error
        );
    }

    if (!confirmed) {
        report.cancelled = true;
        return report;
    }

    for (const file of pendingWrites) {
        fs.writeFileSync(file.path, file.output, "utf8");
    }

    report.updatedFiles = pendingWrites.length;
    return report;
}

export function getSdkMigrationExitCode(error) {
    const code = error?.code;
    if (code === SdkMigrationErrorCode.INVALID_ARGUMENT || code === SdkMigrationErrorCode.INVALID_TARGET) {
        return 2;
    }
    if (code === SdkMigrationErrorCode.HELPER_UNAVAILABLE) {
        return 3;
    }
    return 1;
}
