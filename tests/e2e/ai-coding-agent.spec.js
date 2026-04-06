const { test, expect, _electron: electron } = require('@playwright/test');
const {
  launchElectronApp,
  closeElectronApp,
  openEditorWithMockedIPC,
  clearToastLog,
  getToastLog,
  expectNoUnexpectedErrorToasts,
} = require('./helpers/electronApp');

let electronApp;
let editorWindow;
let allowedErrorToasts = [];

test.beforeAll(async () => {
  try {
    electronApp = await launchElectronApp(electron);
    editorWindow = await openEditorWithMockedIPC(electronApp);
    await editorWindow.waitForTimeout(1500);
  } catch (error) {
    console.error('Error in beforeAll:', error);
    throw error;
  }
}, 90000);

test.afterAll(async () => {
  await closeElectronApp(electronApp);
}, 60000);

test.afterEach(async () => {
  await expectNoUnexpectedErrorToasts(editorWindow, { allow: allowedErrorToasts });
  allowedErrorToasts = [];
});

test.describe('AI Coding Agent Tab', () => {
  const aiAgentTab = () => editorWindow.getByRole('tab', { name: 'AI Coding Agent' });
  const actionSelect = () => editorWindow.locator('#action-select');
  const promptInput = () => editorWindow.locator('#prompt-input');
  const submitButton = () => editorWindow.locator('button:has-text("Submit")');

  const openAiAgentPanel = async () => {
    await aiAgentTab().click();
    const assistants = await editorWindow.evaluate(async () => {
      try {
        return await window.electron.settings.ai.getAssistants();
      } catch (error) {
        return { __error: error?.message || String(error) };
      }
    });
    await expect(editorWindow.locator('text=AI Coding Assistant')).toBeVisible({ timeout: 10000 });
    const hasAssistants = Array.isArray(assistants) && assistants.some((assistant) => assistant?.purpose === 'coding');
    if (!hasAssistants) {
      await expect(editorWindow.locator('text=No Coding Assistants Available')).toBeVisible({ timeout: 10000 });
      return false;
    }
    await expect(actionSelect(), `assistants=${JSON.stringify(assistants)}`).toBeVisible({ timeout: 10000 });
    await expect(promptInput()).toBeVisible({ timeout: 10000 });
    return true;
  };

  const installDelayedAiRouteProbe = async ({ delayMs = 350 } = {}) => {
    await editorWindow.evaluate(({ delayMs }) => {
      window.__e2eAiCalls = [];
      window.__e2eAiCallSeq = 0;

      const makeDelayed = (name, responder) => async (payload = {}) => {
        const seq = ++window.__e2eAiCallSeq;
        window.__e2eAiCalls.push({
          seq,
          name,
          prompt: String(payload?.prompt || ""),
          requestId: payload?.requestId || null,
          at: Date.now(),
        });
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        return responder(payload, seq);
      };

      window.electron.aiCodingAgent.smartMode = makeDelayed("smartMode", (payload, seq) => ({
        success: true,
        requestId: payload?.requestId || `e2e-smart-${seq}`,
        content: `Analysis only (${seq}): no workspace edits requested.`,
      }));
      window.electron.aiCodingAgent.routeJudge = async () => ({
        success: true,
        judge: {
          available: true,
          route: "smart",
          confidence: 0.98,
          intent: {
            isQuestion: true,
            asksForCodeChange: false,
            asksForFileCreation: false,
            asksForPlanExecution: false,
            isFollowupConfirmation: false,
          },
          reasons: ["e2e-analysis-only"],
        },
      });
      window.electron.aiCodingAgent.fixCode = makeDelayed("fixCode", (payload, seq) => ({
        success: true,
        requestId: payload?.requestId || `e2e-fix-${seq}`,
        content: `Unexpected fix route (${seq})`,
      }));
      window.electron.aiCodingAgent.generateCode = makeDelayed("generateCode", (payload, seq) => ({
        success: true,
        requestId: payload?.requestId || `e2e-generate-${seq}`,
        content: `Unexpected generate route (${seq})`,
      }));
      window.electron.aiCodingAgent.editCode = makeDelayed("editCode", (payload, seq) => ({
        success: true,
        requestId: payload?.requestId || `e2e-edit-${seq}`,
        content: `Unexpected edit route (${seq})`,
      }));
      window.electron.aiCodingAgent.planCode = makeDelayed("planCode", (payload, seq) => ({
        success: true,
        requestId: payload?.requestId || `e2e-plan-${seq}`,
        content: `Unexpected plan route (${seq})`,
      }));
      window.electron.aiCodingAgent.explainCode = makeDelayed("explainCode", (payload, seq) => ({
        success: true,
        requestId: payload?.requestId || `e2e-explain-${seq}`,
        content: `Unexpected explain route (${seq})`,
      }));
    }, { delayMs });
  };

  const submitPromptAndAwaitCalls = async (promptText, expectedCallCount) => {
    await promptInput().fill(promptText);
    await submitButton().click();

    await expect(editorWindow.locator('button:has-text("Stop")')).toBeVisible({ timeout: 5000 });

    await editorWindow.waitForFunction((expected) => {
      const calls = window.__e2eAiCalls || [];
      return calls.length >= expected;
    }, expectedCallCount, { timeout: 15000 });

    await editorWindow.waitForFunction(() => {
      const stopButton = Array.from(document.querySelectorAll("button"))
        .find((button) => button.textContent?.trim() === "Stop");
      return !stopButton;
    }, null, { timeout: 15000 });
  };

  const createSeededRng = (seed = 1) => {
    let state = seed >>> 0;
    return () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 0x100000000;
    };
  };

  const pick = (rng, list) => list[Math.floor(rng() * list.length)];

  const buildRandomQuestionPrompts = (count = 12, seed = 1) => {
    const rng = createSeededRng(seed);
    const openers = [
      "can you explain",
      "what is",
      "how can i verify",
      "is it expected that",
      "why does",
      "could you clarify",
    ];
    const subjects = [
      "plugin ui disappears after activation",
      "iframe is mounted but screen is not visible",
      "capability denied appears during privileged action",
      "signature validation fails after reload",
      "runtime is ready but no visible output appears",
      "plugin logs are missing from expected location",
      "manual unload versus crash in traces",
      "node modules preload timing and plugin startup",
      "quick fix behavior after metadata icon suggestions",
      "render stage reaches iframe-dom-after-mount but ui is hidden",
    ];
    const suffixes = [
      "without changing code yet?",
      "from developer UX perspective?",
      "and what should be checked first?",
      "in practical troubleshooting terms?",
      "before any auto-apply changes?",
      "with production-grade debugging steps?",
    ];

    const prompts = [];
    for (let i = 0; i < count; i += 1) {
      prompts.push(`${pick(rng, openers)} ${pick(rng, subjects)} ${pick(rng, suffixes)}`);
    }
    return prompts;
  };

  test('should display AI Coding Agent tab in the bottom panel', async () => {
    await expect(aiAgentTab()).toBeVisible({ timeout: 10000 });
  });

  test('should switch to AI Coding Agent tab when clicked', async () => {
    await openAiAgentPanel();
  });

  test('should display action dropdown in AI Coding Agent panel', async () => {
    const ready = await openAiAgentPanel();
    if (!ready) return;
    
    // Verify current default value
    const selectedValue = await actionSelect().inputValue();
    expect(selectedValue).toBe('smart');
  });

  test('should display prompt textarea in AI Coding Agent panel', async () => {
    const ready = await openAiAgentPanel();
    if (!ready) return;
    await expect(promptInput()).toBeVisible({ timeout: 10000 });
  });

  test('should display submit button in AI Coding Agent panel', async () => {
    const ready = await openAiAgentPanel();
    if (!ready) return;
    await expect(submitButton()).toBeVisible({ timeout: 10000 });
    
    // Button should be disabled when prompt is empty
    const isDisabled = await submitButton().isDisabled();
    expect(isDisabled).toBe(true);
  });

  test('should enable submit button when prompt is filled', async () => {
    const ready = await openAiAgentPanel();
    if (!ready) return;
    
    // Fill in the prompt
    await promptInput().fill('Create a function that adds two numbers');
    
    // Check if submit button is now enabled
    await editorWindow.waitForTimeout(300);
    const isDisabled = await submitButton().isDisabled();
    expect(isDisabled).toBe(false);
  });

  test('should change action dropdown options', async () => {
    const ready = await openAiAgentPanel();
    if (!ready) return;
    
    // Change to "Edit Code"
    await actionSelect().selectOption('edit');
    let selectedValue = await actionSelect().inputValue();
    expect(selectedValue).toBe('edit');
    
    // Change to "Explain Code"
    await actionSelect().selectOption('explain');
    selectedValue = await actionSelect().inputValue();
    expect(selectedValue).toBe('explain');
    
    // Change to "Fix Code"
    await actionSelect().selectOption('fix');
    selectedValue = await actionSelect().inputValue();
    expect(selectedValue).toBe('fix');
    
    // Change back to "Generate Code"
    await actionSelect().selectOption('generate');
    selectedValue = await actionSelect().inputValue();
    expect(selectedValue).toBe('generate');
  });

  test('should display NonIdealState when no response', async () => {
    const ready = await openAiAgentPanel();
    if (!ready) return;
    
    // Check if NonIdealState is displayed
    const nonIdealState = editorWindow.locator('text=Select an action and provide a prompt');
    await expect(nonIdealState).toBeVisible({ timeout: 5000 });
  });

  test('should switch between tabs (Problems, Output, AI Coding Agent)', async () => {
    // Click on Problems tab
    await editorWindow.click('text=Problems');
    await editorWindow.waitForTimeout(300);
    let activeTab = await editorWindow.locator('[role="tab"][aria-selected="true"]').textContent();
    expect(activeTab).toContain('Problems');
    
    // Click on Build tab (previously named Output)
    await editorWindow.getByRole('tab', { name: 'Build' }).click();
    await editorWindow.waitForTimeout(300);
    activeTab = await editorWindow.locator('[role="tab"][aria-selected="true"]').textContent();
    expect(activeTab).toContain('Build');
    
    // Click on AI Coding Agent tab
    await aiAgentTab().click();
    await editorWindow.waitForTimeout(300);
    activeTab = await editorWindow.locator('[role="tab"][aria-selected="true"]').textContent();
    expect(activeTab).toContain('AI Coding Agent');
  });

  test('should execute plugin runtime probe utilities before log-verification answer', async () => {
    const ready = await openAiAgentPanel();
    if (!ready) return;

    await clearToastLog(editorWindow);

    await editorWindow.evaluate(() => {
      const decodePluginId = () => {
        try {
          const hash = String(window.location.hash || "");
          const queryIndex = hash.indexOf("?");
          if (queryIndex < 0) return "";
          const params = new URLSearchParams(hash.slice(queryIndex + 1));
          const encoded = params.get("data");
          if (!encoded) return "";
          const parsed = JSON.parse(decodeURIComponent(encoded));
          return String(parsed?.name || "").trim();
        } catch (_) {
          return "";
        }
      };

      const pluginId = decodePluginId();
      window.__e2eProbeCalls = [];
      window.__e2eSmartPayload = null;

      const call = (name, fn) => async (...args) => {
        window.__e2eProbeCalls.push({ name, args });
        return fn(...args);
      };

      window.electron.plugin.getRuntimeStatus = call("getRuntimeStatus", async () => ({
        success: true,
        statuses: [{ id: pluginId, loading: false, loaded: true, ready: true, inited: true }],
      }));
      window.electron.plugin.activate = call("activate", async () => ({ success: true }));
      window.electron.plugin.init = call("init", async () => ({ success: true }));
      window.electron.plugin.render = call("render", async () => ({ success: true }));
      window.electron.plugin.getLogTrace = call("getLogTrace", async () => ({
        success: true,
        combined: "Runtime status for plugin from e2e runtime probe",
      }));

      window.electron.aiCodingAgent.smartMode = async (payload) => {
        window.__e2eSmartPayload = payload;
        return { success: false, error: "E2E intentional stop after probe." };
      };
    });

    await actionSelect().selectOption('fix');
    await promptInput().fill('run plugin and verify logs before answering');
    await submitButton().click();

    await editorWindow.waitForFunction(() => {
      const calls = window.__e2eProbeCalls || [];
      return calls.some((entry) => entry.name === "activate")
        && calls.some((entry) => entry.name === "getRuntimeStatus")
        && calls.some((entry) => entry.name === "getLogTrace");
    }, null, { timeout: 10000 });

    const probeData = await editorWindow.evaluate(() => ({
      calls: window.__e2eProbeCalls || [],
      smartPayload: window.__e2eSmartPayload || null,
    }));

    expect(probeData.calls.some((entry) => entry.name === "activate")).toBeTruthy();
    expect(probeData.calls.some((entry) => entry.name === "getLogTrace")).toBeTruthy();
    expect(String(probeData.smartPayload?.context || "")).toContain('Plugin runtime action report');
  });

  test('should show native runtime failure toast when probe action fails', async () => {
    const ready = await openAiAgentPanel();
    if (!ready) return;

    allowedErrorToasts.push(/Plugin runtime actions completed with errors/i);
    await clearToastLog(editorWindow);

    await editorWindow.evaluate(() => {
      const decodePluginId = () => {
        try {
          const hash = String(window.location.hash || "");
          const queryIndex = hash.indexOf("?");
          if (queryIndex < 0) return "";
          const params = new URLSearchParams(hash.slice(queryIndex + 1));
          const encoded = params.get("data");
          if (!encoded) return "";
          const parsed = JSON.parse(decodeURIComponent(encoded));
          return String(parsed?.name || "").trim();
        } catch (_) {
          return "";
        }
      };
      const pluginId = decodePluginId();
      window.__e2eProbeCalls = [];
      const call = (name, fn) => async (...args) => {
        window.__e2eProbeCalls.push({ name, args });
        return fn(...args);
      };

      window.electron.plugin.getRuntimeStatus = call("getRuntimeStatus", async () => ({
        success: true,
        statuses: [{ id: pluginId, loading: false, loaded: false, ready: false, inited: false }],
      }));
      window.electron.plugin.activate = call("activate", async () => ({ success: false, error: "Activation failed in e2e." }));
      window.electron.plugin.getLogTrace = call("getLogTrace", async () => ({ success: false, error: "Trace unavailable in e2e." }));

      window.electron.aiCodingAgent.smartMode = async () => ({ success: false, error: "E2E intentional stop after failure probe." });
    });

    await actionSelect().selectOption('fix');
    await promptInput().fill('run plugin and verify logs before answering');
    await submitButton().click();

    await editorWindow.waitForFunction(() => {
      const toasts = window.__e2eToastLog || [];
      return toasts.some((entry) => /Plugin runtime actions completed with errors/i.test(entry?.text || ""));
    }, null, { timeout: 10000 });

    const toasts = await getToastLog(editorWindow);
    expect(toasts.some((entry) => /Plugin runtime actions completed with errors/i.test(entry?.text || ""))).toBeTruthy();
  });

  test('stress: random question prompts stay in analysis path and do not mutate workspace files', async ({}, testInfo) => {
    const ready = await openAiAgentPanel();
    if (!ready) return;

    await installDelayedAiRouteProbe({ delayMs: 260 });

    const baseline = await editorWindow.evaluate(() => {
      window.__editorTestApi.createFile("/index.ts", "export const sentinel = 'KEEP_ME';\n", "typescript");
      return {
        content: window.__editorTestApi.getFileContent("/index.ts"),
        treeIds: window.__editorTestApi.getState()?.workspaceTreeIds || [],
      };
    });

    const questionPrompts = buildRandomQuestionPrompts(
      20,
      1774687257 + (testInfo.repeatEachIndex || 0) + ((testInfo.retry || 0) * 997)
    );

    for (let i = 0; i < questionPrompts.length; i += 1) {
      await submitPromptAndAwaitCalls(questionPrompts[i], i + 1);
    }

    const probe = await editorWindow.evaluate(() => ({
      calls: window.__e2eAiCalls || [],
      finalContent: window.__editorTestApi.getFileContent("/index.ts"),
      treeIds: window.__editorTestApi.getState()?.workspaceTreeIds || [],
    }));

    expect(probe.calls.length).toBe(questionPrompts.length);
    expect(probe.calls.every((call) => call.name === "smartMode")).toBeTruthy();
    expect(probe.finalContent).toBe(baseline.content);
    expect(probe.treeIds).toEqual(baseline.treeIds);
  });

  test('confirmation follow-up after prose summary does not trigger plan execution or auto-apply writes', async () => {
    const ready = await openAiAgentPanel();
    if (!ready) return;

    await editorWindow.evaluate(() => {
      window.__e2eAiCalls = [];
      window.__e2eAiCallSeq = 0;
      const delayed = async (payload, name, content) => {
        const seq = ++window.__e2eAiCallSeq;
        window.__e2eAiCalls.push({
          seq,
          name,
          prompt: String(payload?.prompt || ""),
          requestId: payload?.requestId || null,
          at: Date.now(),
        });
        await new Promise((resolve) => setTimeout(resolve, 320));
        return {
          success: true,
          requestId: payload?.requestId || `e2e-${name}-${seq}`,
          content,
        };
      };

      window.electron.aiCodingAgent.smartMode = async (payload = {}) => {
        const prompt = String(payload?.prompt || "").toLowerCase();
        if (prompt.includes("what do they cover")) {
          return delayed(
            payload,
            "smartMode",
            "Implementation Summary: tests cover editor close reliability and references specs/006-fix-editor-close/tasks.md."
          );
        }
        return delayed(payload, "smartMode", "Acknowledged. No code changes requested.");
      };
      window.electron.aiCodingAgent.routeJudge = async (payload = {}) => {
        const prompt = String(payload?.prompt || "").toLowerCase();
        const confirmationLike = prompt.includes("yes") || prompt.includes("make those changes");
        return {
          success: true,
          judge: {
            available: true,
            route: "smart",
            confidence: 0.97,
            intent: {
              isQuestion: !confirmationLike,
              asksForCodeChange: false,
              asksForFileCreation: false,
              asksForPlanExecution: false,
              isFollowupConfirmation: confirmationLike,
            },
            reasons: ["e2e-safe-smart-route"],
          },
        };
      };
      window.electron.aiCodingAgent.planCode = async (payload = {}) => delayed(payload, "planCode", "UNEXPECTED_PLAN_ROUTE");
      window.electron.aiCodingAgent.fixCode = async (payload = {}) => delayed(payload, "fixCode", "UNEXPECTED_FIX_ROUTE");
      window.electron.aiCodingAgent.generateCode = async (payload = {}) => delayed(payload, "generateCode", "UNEXPECTED_GENERATE_ROUTE");
      window.electron.aiCodingAgent.editCode = async (payload = {}) => delayed(payload, "editCode", "UNEXPECTED_EDIT_ROUTE");
      window.electron.aiCodingAgent.explainCode = async (payload = {}) => delayed(payload, "explainCode", "UNEXPECTED_EXPLAIN_ROUTE");
    });

    const autoApplyToggle = editorWindow.getByLabel("Auto-apply generated changes to the editor or virtual workspace (creates snapshot first)");
    await autoApplyToggle.check();

    const baseline = await editorWindow.evaluate(() => {
      window.__editorTestApi.createFile("/index.ts", "export const stable = 'DO_NOT_CHANGE';\n", "typescript");
      return window.__editorTestApi.getFileContent("/index.ts");
    });

    await submitPromptAndAwaitCalls("what do they cover?", 1);
    await submitPromptAndAwaitCalls("yes, please make those changes", 2);

    const probe = await editorWindow.evaluate(() => ({
      calls: window.__e2eAiCalls || [],
      finalContent: window.__editorTestApi.getFileContent("/index.ts"),
    }));

    expect(probe.calls.length).toBe(2);
    expect(probe.calls.every((call) => call.name === "smartMode")).toBeTruthy();
    expect(probe.finalContent).toBe(baseline);
  });

  test('plugin-only scope retry corrects a host-drifting answer before showing it', async () => {
    const ready = await openAiAgentPanel();
    if (!ready) return;

    await editorWindow.evaluate(() => {
      window.__e2eAiCalls = [];
      window.__e2eAiCallSeq = 0;
      const respond = async (payload, content) => {
        const seq = ++window.__e2eAiCallSeq;
        window.__e2eAiCalls.push({
          seq,
          name: "smartMode",
          prompt: String(payload?.prompt || ""),
          requestId: payload?.requestId || null,
          at: Date.now(),
        });
        await new Promise((resolve) => setTimeout(resolve, 180));
        return {
          success: true,
          requestId: payload?.requestId || `scope-retry-${seq}`,
          content,
        };
      };

      window.electron.aiCodingAgent.routeJudge = async () => ({
        success: true,
        judge: {
          available: true,
          route: "smart",
          confidence: 0.98,
          intent: {
            isQuestion: false,
            asksForCodeChange: true,
            asksForFileCreation: false,
            asksForPlanExecution: false,
            isFollowupConfirmation: false,
          },
          reasons: ["e2e-plugin-scope-retry"],
        },
      });

      window.electron.aiCodingAgent.smartMode = async (payload = {}) => {
        if ((window.__e2eAiCallSeq || 0) === 0) {
          return respond(payload, "Update src/components/editor/utils/setupVirtualWorkspace.js to forward displayName.");
        }
        return respond(payload, "Update /fdo.meta.json and set name to Useful Plugin Name.");
      };
    });

    await promptInput().fill("please change plugin's name in metadata from undefined to something more useful and meaningful");
    await submitButton().click();

    await editorWindow.waitForFunction(() => (window.__e2eAiCalls || []).length >= 2, null, { timeout: 10000 });
    await expect(editorWindow.locator('text=Plugin Scope Enforced')).toHaveCount(0);
    await expect(editorWindow.locator('text=Update /fdo.meta.json and set name to Useful Plugin Name.')).toBeVisible({ timeout: 10000 });
  });

  test('auto-apply retries multi-file plugin changes and applies both index.ts and render.tsx', async () => {
    const ready = await openAiAgentPanel();
    if (!ready) return;

    await editorWindow.evaluate(() => {
      window.__editorTestApi.createFile(
        "/index.ts",
        [
          "export default class Test6 extends FDO_SDK {",
          "    public get metadata(): PluginMetadata {",
          "        return {",
          '            name: "Aurora Anvil",',
          '            version: "1.0.0",',
          '            author: "AleXvWaN",',
          '            description: "A sample FDO plugin",',
          '            icon: "cog",',
          "        };",
          "    }",
          "}",
        ].join("\n"),
        "typescript",
      );
      window.__editorTestApi.createFile(
        "/render.tsx",
        [
          "export default function Render() {",
          "  return <h1>My Plugin</h1>;",
          "}",
        ].join("\n"),
        "typescript",
      );

      window.__e2eAiCalls = [];
      window.__e2eAiCallSeq = 0;
      const delayedResponse = async (name, payload, content) => {
        const seq = ++window.__e2eAiCallSeq;
        window.__e2eAiCalls.push({
          seq,
          name,
          prompt: String(payload?.prompt || ""),
          requestId: payload?.requestId || null,
          at: Date.now(),
        });
        await new Promise((resolve) => setTimeout(resolve, 180));
        return {
          success: true,
          requestId: payload?.requestId || `multi-file-${name}-${seq}`,
          content,
        };
      };

      window.electron.aiCodingAgent.routeJudge = async () => ({
        success: true,
        judge: {
          available: true,
          route: "smart",
          confidence: 0.98,
          intent: {
            isQuestion: false,
            asksForCodeChange: true,
            asksForFileCreation: false,
            asksForPlanExecution: false,
            isFollowupConfirmation: false,
          },
          reasons: ["e2e-multi-file-auto-apply"],
        },
      });

      window.electron.aiCodingAgent.smartMode = async (payload = {}) => delayedResponse(
        "smartMode",
        payload,
        [
          "Changed the plugin branding from Aurora Anvil to a more distinctive name: Quasar Quill.",
          "",
          "What changed:",
          "",
          "In /index.ts, metadata.name now uses Quasar Quill.",
          "In /render.tsx, the visible heading now matches the new plugin name instead of My Plugin.",
          "",
          "// SOLUTION READY TO APPLY",
          "public get metadata(): PluginMetadata {",
          "    return {",
          '        name: "Quasar Quill",',
          '        version: "1.0.0",',
          '        author: "AleXvWaN",',
          '        description: "A sample FDO plugin",',
          '        icon: "cog",',
          "    };",
          "}",
        ].join("\n"),
      );

      window.electron.aiCodingAgent.planCode = async (payload = {}) => delayedResponse(
        "planCode",
        payload,
        [
          "### File: /index.ts",
          "```typescript",
          "export default class Test6 extends FDO_SDK {",
          "    public get metadata(): PluginMetadata {",
          "        return {",
          '            name: "Quasar Quill",',
          '            version: "1.0.0",',
          '            author: "AleXvWaN",',
          '            description: "A sample FDO plugin",',
          '            icon: "cog",',
          "        };",
          "    }",
          "}",
          "new Test6();",
          "```",
          "",
          "### File: /render.tsx",
          "```tsx",
          "export default function Render() {",
          "  return <h1>Quasar Quill</h1>;",
          "}",
          "```",
        ].join("\n"),
      );
    });

    const autoApply = editorWindow.getByRole('checkbox', { name: /Auto-apply generated changes/i });
    const autoApplyChecked = await autoApply.isChecked();
    if (!autoApplyChecked) {
      await autoApply.click();
    }

    await promptInput().fill("please change plugin's name to something more creative");
    await submitButton().click();

    await editorWindow.waitForFunction(() => {
      const calls = window.__e2eAiCalls || [];
      return calls.some((call) => call.name === "smartMode") && calls.some((call) => call.name === "planCode");
    }, null, { timeout: 15000 });

    await expect(editorWindow.locator('text=Workspace Updated')).toBeVisible({ timeout: 10000 });
    await expect(editorWindow.locator('text=/Applied 2 workspace file\\(s\\) automatically/i')).toBeVisible({ timeout: 10000 });

    const probe = await editorWindow.evaluate(() => ({
      calls: window.__e2eAiCalls || [],
      indexContent: window.__editorTestApi.getFileContent("/index.ts"),
      renderContent: window.__editorTestApi.getFileContent("/render.tsx"),
    }));

    expect(probe.calls.some((call) => call.name === "smartMode")).toBeTruthy();
    expect(probe.calls.some((call) => call.name === "planCode")).toBeTruthy();
    expect(probe.indexContent).toContain('name: "Quasar Quill"');
    expect(probe.renderContent).toContain("<h1>Quasar Quill</h1>");
  });
});
