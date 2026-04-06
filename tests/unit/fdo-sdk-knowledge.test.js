import {
    buildFdoSdkKnowledgeIndex,
    extractSdkSymbols,
    formatSdkKnowledgeContext,
    searchFdoSdkKnowledge,
    shouldUseFdoSdkKnowledge,
} from "../../src/utils/fdoSdkKnowledge.js";

describe("fdo sdk knowledge indexing", () => {
    const files = [
        {
            path: "@types/index.d.ts",
            content: `
export interface FDOInterface {
    init(): void;
    render(): string;
}

export class FDO_SDK {}
export type PrivilegedActionResponse<TResult = unknown> = any;
export type PrivilegedActionSuccessResponse<TResult = unknown> = any;
export type PrivilegedActionErrorResponse = any;
export function createPrivilegedActionCorrelationId(prefix?: string): string;
export function createPrivilegedActionBackendRequest<TRequest = unknown>(request: TRequest, options?: any): { correlationId: string; request: TRequest };
export function requestPrivilegedAction<TResult = unknown, TRequest = unknown>(request: TRequest, options?: any): Promise<PrivilegedActionResponse<TResult>>;
export function createScopedProcessExecActionRequest(scopeId: string, payload: any): any;
export function requestScopedProcessExec<TResult = unknown>(scopeId: string, payload: any, options?: any): Promise<PrivilegedActionResponse<TResult>>;
export function getOperatorToolPreset(presetId: string): any;
export function listOperatorToolPresets(): any[];
export function createOperatorToolCapabilityPreset(presetId: string): string[];
export function createOperatorToolActionRequest(presetId: string, payload: any): any;
export function requestOperatorTool<TResult = unknown>(presetId: string, payload: any, options?: any): Promise<PrivilegedActionResponse<TResult>>;
export function createCapabilityBundle(capabilities: string[]): string[];
export function createFilesystemCapabilityBundle(scopeId: string): string[];
export function createProcessCapabilityBundle(scopeId: string): string[];
export function describeCapability(capability: string): any;
export function parseMissingCapabilityError(error: unknown): any;
export function isPrivilegedActionSuccessResponse(value: unknown): boolean;
export function isPrivilegedActionErrorResponse(value: unknown): boolean;
export function unwrapPrivilegedActionResponse<TResult = unknown>(response: PrivilegedActionResponse<TResult>): TResult;
            `.trim(),
        },
        {
            path: "@types/DOMTable.d.ts",
            content: `
export class DOMTable {
    addRow(cells: string[]): DOMTable;
    build(): string;
}
            `.trim(),
        },
        {
            path: "README.md",
            content: `
# FDO SDK

Use DOMTable to create table layouts for plugin UIs.
            `.trim(),
        },
        {
            path: "docs/OPERATOR_PLUGIN_PATTERNS.md",
            content: `
# Operator Plugin Patterns
Use requestOperatorTool, createOperatorToolCapabilityPreset, requestScopedProcessExec, requestPrivilegedAction, createPrivilegedActionBackendRequest, createPrivilegedActionCorrelationId, createProcessExecActionRequest, isPrivilegedActionSuccessResponse, and isPrivilegedActionErrorResponse for operator-style plugins.
            `.trim(),
        },
        {
            path: "examples/09-operator-plugin.ts",
            content: `
import {
  createOperatorToolCapabilityPreset,
  createProcessCapabilityBundle,
  requestOperatorTool,
  requestScopedProcessExec,
  parseMissingCapabilityError,
  describeCapability,
} from "@anikitenko/fdo-sdk";
            `.trim(),
        },
        {
            path: "examples/fixtures/operator-kubernetes-plugin.fixture.ts",
            content: `
import { createOperatorToolCapabilityPreset, requestOperatorTool } from "@anikitenko/fdo-sdk";
const capabilities = createOperatorToolCapabilityPreset("kubectl");
const response = requestOperatorTool("kubectl", { args: ["get", "pods"], dryRun: true });
            `.trim(),
        },
        {
            path: "examples/fixtures/operator-terraform-plugin.fixture.ts",
            content: `
import { createOperatorToolCapabilityPreset, createOperatorToolActionRequest } from "@anikitenko/fdo-sdk";
const capabilities = createOperatorToolCapabilityPreset("terraform");
const request = createOperatorToolActionRequest("terraform", { args: ["plan"], dryRun: true });
            `.trim(),
        },
        {
            path: "examples/fixtures/operator-custom-tool-plugin.fixture.ts",
            content: `
import { createProcessCapabilityBundle, requestScopedProcessExec } from "@anikitenko/fdo-sdk";
const capabilities = createProcessCapabilityBundle("internal-runner");
const response = requestScopedProcessExec("internal-runner", { args: ["status"], dryRun: true });
            `.trim(),
        },
    ];

    test("extracts exported SDK symbols", () => {
        expect(extractSdkSymbols(files[0].content)).toEqual(
            expect.arrayContaining(["FDOInterface", "FDO_SDK"])
        );
    });

    test("builds a searchable chunk index", () => {
        const index = buildFdoSdkKnowledgeIndex(files);
        expect(index.length).toBeGreaterThanOrEqual(3);
        expect(index[0]).toEqual(expect.objectContaining({
            id: expect.any(String),
            path: expect.any(String),
            content: expect.any(String),
            symbols: expect.any(Array),
        }));
    });

    test("returns the most relevant chunks for a query", () => {
        const index = buildFdoSdkKnowledgeIndex(files);
        const results = searchFdoSdkKnowledge(index, "How do I use DOMTable in FDO plugin render?");

        expect(results.length).toBeGreaterThan(0);
        expect(results[0].path).toMatch(/DOMTable|README/i);
        expect(results.some((entry) => entry.symbols.includes("DOMTable"))).toBe(true);
    });

    test("formats selected SDK chunks into prompt context", () => {
        const context = formatSdkKnowledgeContext([
            {
                path: "@types/DOMTable.d.ts",
                symbols: ["DOMTable"],
                content: "export class DOMTable { build(): string; }",
            },
        ]);

        expect(context).toContain("Relevant FDO SDK knowledge");
        expect(context).toContain("DOMTable");
        expect(context).toContain("@types/DOMTable.d.ts");
    });

    test("enables SDK knowledge for plan mode only when the new request carries FDO/plugin signals", () => {
        expect(shouldUseFdoSdkKnowledge({
            action: "plan",
            prompt: "Build an FDO plugin settings panel",
        })).toBe(true);

        expect(shouldUseFdoSdkKnowledge({
            action: "plan",
            prompt: "Proceed with implementation from TODO and mark completed items",
        })).toBe(false);
    });

    test("enables SDK knowledge for smart/generate/fix/edit/explain only when FDO signals are present", () => {
        expect(shouldUseFdoSdkKnowledge({
            action: "smart",
            prompt: "Build an FDO plugin settings panel with DOMTable",
        })).toBe(true);

        expect(shouldUseFdoSdkKnowledge({
            action: "generate",
            prompt: "I need a production grade hosts file replacer like switchhosts",
        })).toBe(false);

        expect(shouldUseFdoSdkKnowledge({
            action: "fix",
            error: "DOMTable build is not a function in my FDO plugin",
        })).toBe(true);

        expect(shouldUseFdoSdkKnowledge({
            action: "edit",
            prompt: "Refactor this function for readability",
            code: "function sum(a, b) { return a + b; }",
        })).toBe(false);
    });

    test("does not enable SDK knowledge for generic reference-product prompts just because current file is an FDO plugin", () => {
        expect(shouldUseFdoSdkKnowledge({
            action: "smart",
            prompt: "I want a production grade hosts file replacer similar to https://switchhosts.app but even better",
            context: "export default class MyPlugin extends FDO_SDK { render(): string { return '<div />'; } }",
        })).toBe(false);
    });

    test("enables SDK knowledge for best-practice plugin edit prompts even without explicit sdk symbol names", () => {
        expect(shouldUseFdoSdkKnowledge({
            action: "smart",
            prompt: "please change plugin's name in metadata using best practices and production grade guidance",
        })).toBe(true);
    });

    test("enables SDK knowledge for operator-style plugin prompts using scoped process execution language", () => {
        expect(shouldUseFdoSdkKnowledge({
            action: "smart",
            prompt: "Build an FDO plugin like Docker Desktop using system.process.exec and system.process.scope.docker-cli",
        })).toBe(true);

        expect(shouldUseFdoSdkKnowledge({
            action: "generate",
            prompt: "Create a Kubernetes operator console plugin with scoped tool execution through kubectl",
        })).toBe(true);

        expect(shouldUseFdoSdkKnowledge({
            action: "smart",
            prompt: "Use requestPrivilegedAction with createProcessExecActionRequest for a Helm manager plugin",
        })).toBe(true);
        expect(shouldUseFdoSdkKnowledge({
            action: "generate",
            prompt: "Build an Ansible operator plugin using requestOperatorTool and createOperatorToolCapabilityPreset",
        })).toBe(true);
        expect(shouldUseFdoSdkKnowledge({
            action: "generate",
            prompt: "Build an internal runner dashboard using requestScopedProcessExec for a custom host-defined scope",
        })).toBe(true);
        expect(shouldUseFdoSdkKnowledge({
            action: "fix",
            prompt: "Handle capability denied errors with parseMissingCapabilityError and describeCapability in my operator plugin",
        })).toBe(true);
    });

    test("prioritizes operator docs and example files for operator-style queries", () => {
        const index = buildFdoSdkKnowledgeIndex(files);
        const results = searchFdoSdkKnowledge(index, "Show the operator plugin pattern using requestOperatorTool and createOperatorToolCapabilityPreset for Docker Desktop-like plugins");

        expect(results.length).toBeGreaterThan(0);
        expect(results[0].path).toMatch(/operator-kubernetes-plugin\.fixture|operator-terraform-plugin\.fixture|operator-custom-tool-plugin\.fixture/);
        expect(results.some((entry) => /OPERATOR_PLUGIN_PATTERNS|operator-kubernetes-plugin\.fixture|operator-terraform-plugin\.fixture|operator-custom-tool-plugin\.fixture/.test(entry.path))).toBe(true);
    });

    test("prefers fixture-backed operator examples for kubernetes, terraform, and custom tool prompts", () => {
        const index = buildFdoSdkKnowledgeIndex(files);

        const kubernetesResults = searchFdoSdkKnowledge(index, "Build a Kubernetes dashboard plugin using kubectl operator helpers");
        expect(kubernetesResults[0].path).toMatch(/operator-kubernetes-plugin\.fixture|OPERATOR_PLUGIN_PATTERNS/);

        const terraformResults = searchFdoSdkKnowledge(index, "Create a Terraform operator console using curated capability presets");
        expect(terraformResults[0].path).toMatch(/operator-terraform-plugin\.fixture|OPERATOR_PLUGIN_PATTERNS/);

        const customToolResults = searchFdoSdkKnowledge(index, "Create an internal operational dashboard for a custom internal-runner tool");
        expect(customToolResults[0].path).toMatch(/operator-custom-tool-plugin\.fixture|OPERATOR_PLUGIN_PATTERNS/);
    });

    test("lets transport-level operator queries surface non-fixture references first", () => {
        const index = buildFdoSdkKnowledgeIndex(files);
        const results = searchFdoSdkKnowledge(index, "Show transport-level debugging with requestPrivilegedAction and createProcessExecActionRequest for a non-curated action family");

        expect(results.length).toBeGreaterThan(0);
        expect(results[0].path).toMatch(/OPERATOR_PLUGIN_PATTERNS|09-operator-plugin/);
    });
});
