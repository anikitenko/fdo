function defaultSpecFromEntry(entry) {
  const handlers = Array.isArray(entry?.expectations?.handlers) ? entry.expectations.handlers : [];
  const initLogAnyOf = Array.isArray(entry?.expectations?.initMessages) ? entry.expectations.initMessages : [];
  const uiMarkerAnyOf = Array.isArray(entry?.expectations?.uiMarkers) ? entry.expectations.uiMarkers : [];
  return {
    handlers,
    initLogAnyOf,
    uiMarkerAnyOf,
    handlerExpectations: {},
    uiInteractionChecks: [],
  };
}

const OVERRIDES = {
  "01-basic-plugin.ts": {
    uiMarkerAnyOf: ["Basic Plugin Example", "What's Next?"],
    initLogAnyOf: ["BasicPlugin initialized!"],
  },
  "02-interactive-plugin.ts": {
    uiMarkerAnyOf: ["Interactive Plugin Example", "Counter Example", "Form Example"],
    initLogAnyOf: ["InteractivePlugin initialized!"],
    handlerExpectations: {
      incrementCounter: { payload: { step: "increment" }, expectSuccess: true, resultPathsTruthy: ["message"] },
      decrementCounter: { payload: { step: "decrement" }, expectSuccess: true, resultPathsTruthy: ["message"] },
      submitForm: {
        payload: { userName: "Contract E2E" },
        expectSuccess: true,
        resultPathContains: { message: "Contract E2E" },
      },
    },
    uiInteractionChecks: [
      {
        id: "counter-increment-button",
        action: "click",
        selector: "#increment-counter-btn",
        targetSelector: "#counter-result",
        expectTextContains: "Counter is now",
      },
      {
        id: "form-submit",
        action: "click",
        selector: "#submit-form-btn",
        fields: [
          { selector: "#userName", value: "Contract UI" },
        ],
        targetSelector: "#form-result",
        expectTextContains: "Form submitted successfully.",
      },
    ],
  },
  "03-persistence-plugin.ts": {
    uiMarkerAnyOf: ["Persistence Plugin Example", "Storage Concepts"],
    initLogAnyOf: ["PersistencePlugin initialized!", "Session initialized. Visit count:"],
    handlerExpectations: {
      savePreferences: { payload: { userName: "Contract E2E", theme: "dark", notificationsEnabled: true }, expectSuccess: true },
      clearPreferences: { payload: { reason: "contract-test" }, expectSuccess: true },
      recordAction: {
        payload: { action: "ContractTestAction" },
        expectSuccess: true,
        resultPathEquals: { action: "ContractTestAction" },
      },
    },
  },
  "04-ui-extensions-plugin.ts": {
    uiMarkerAnyOf: ["UI Extensions Plugin Example", "UI Extensions"],
    initLogAnyOf: ["UIExtensionsPlugin initialized!"],
    handlerExpectations: {
      quickSearch: { payload: { query: "kubernetes" }, expectSuccess: true, resultPathEquals: { view: "search" } },
      quickCreate: { payload: { kind: "item", name: "contract-item" }, expectSuccess: true, resultPathEquals: { view: "create" } },
      quickSettings: { payload: { tab: "general" }, expectSuccess: true, resultPathEquals: { view: "settings" } },
      showDashboard: { payload: { source: "contract" }, expectSuccess: true, resultPathEquals: { view: "dashboard" } },
      showReports: { payload: { source: "contract" }, expectSuccess: true, resultPathEquals: { view: "reports" } },
      showSettings: { payload: { source: "contract" }, expectSuccess: true, resultPathEquals: { view: "settings" } },
    },
  },
  "05-advanced-dom-plugin.ts": {
    uiMarkerAnyOf: ["Advanced DOM Example", "Health Table", "Operator Form"],
    initLogAnyOf: ["AdvancedDOMPlugin initialized"],
  },
  "06-error-handling-plugin.ts": {
    uiMarkerAnyOf: ["Error Handling Example", "Trigger Success Handler"],
    initLogAnyOf: ["ErrorHandlingPlugin initialized"],
    handlerExpectations: {
      simulateSuccess: { payload: { probe: "ok" }, expectSuccess: true, resultPathsTruthy: ["received", "at"] },
      simulateError: { payload: {}, expectSuccess: false, failureAnyOf: ["Simulated backend handler failure", "Intentional handler exception"] },
    },
  },
  "07-injected-libraries-demo.ts": {
    uiMarkerAnyOf: ["Injected Libraries Demo", "Injected Libraries Demo"],
    initLogAnyOf: ["InjectedLibrariesDemoPlugin initialized!"],
    handlerExpectations: {
      "demo.getPluginInfo": {
        payload: { id: "contract-plugin-id" },
        expectSuccess: true,
        resultPathEquals: { pluginId: "contract-plugin-id" },
        resultPathsTruthy: ["pluginName", "runtime"],
      },
    },
  },
  "08-privileged-actions-plugin.ts": {
    uiMarkerAnyOf: ["Privileged Actions Demo", "Run Dry-Run"],
    initLogAnyOf: ["PrivilegedActionsPlugin initialized"],
  },
  "09-operator-plugin.ts": {
    uiMarkerAnyOf: ["Operator Plugin Example"],
    initLogAnyOf: ["Operator plugin example initialized"],
  },
  "dom_elements_plugin.ts": {
    uiMarkerAnyOf: ["DOM Elements Example", "Example 1: Data Table"],
    initLogAnyOf: ["DOM Elements Example Plugin initialized!"],
  },
  "fixtures/advanced-ui-plugin.fixture.ts": {
    uiMarkerAnyOf: ["Fixture: Advanced UI"],
    initLogAnyOf: ["Advanced UI fixture initialized"],
  },
  "fixtures/error-handling-plugin.fixture.ts": {
    uiMarkerAnyOf: ["Fixture: Error Handling"],
    handlerExpectations: {
      "fixture:ok": { payload: { probe: "fixture-ok" }, expectSuccess: true, resultPathEquals: { success: true } },
      "fixture:fail": { payload: {}, expectSuccess: false, failureAnyOf: ["Intentional fixture handler failure"] },
    },
  },
  "fixtures/minimal-plugin.fixture.ts": {
    uiMarkerAnyOf: ["Fixture: Minimal Plugin"],
    initLogAnyOf: ["Minimal fixture initialized"],
  },
  "fixtures/operator-custom-tool-plugin.fixture.ts": {
    uiMarkerAnyOf: ["Fixture: Custom Operator Tool"],
    initLogAnyOf: ["Custom operator fixture initialized"],
    handlerExpectations: {
      "custom.previewRunnerStatus": { payload: {}, expectPrivilegedShape: true },
    },
  },
  "fixtures/operator-kubernetes-plugin.fixture.ts": {
    uiMarkerAnyOf: ["Fixture: Kubernetes Operator"],
    initLogAnyOf: ["Kubernetes operator fixture initialized"],
    handlerExpectations: {
      "kubectl.previewClusterObjects": { payload: {}, expectPrivilegedShape: true },
      "kubectl.inspectAndRestartWorkflow": { payload: {}, expectPrivilegedShape: true, expectWorkflowShape: true },
    },
  },
  "fixtures/operator-terraform-plugin.fixture.ts": {
    uiMarkerAnyOf: ["Fixture: Terraform Operator"],
    initLogAnyOf: ["Terraform operator fixture initialized"],
    handlerExpectations: {
      "terraform.previewPlan": { payload: {}, expectPrivilegedShape: true },
      "terraform.previewApplyWorkflow": { payload: {}, expectPrivilegedShape: true, expectWorkflowShape: true },
    },
  },
  "fixtures/storage-plugin.fixture.ts": {
    uiMarkerAnyOf: ["Fixture: Storage"],
  },
};

function getBehaviorSpec(entry) {
  const base = defaultSpecFromEntry(entry);
  const override = OVERRIDES[entry?.relativePath] || {};
  return {
    ...base,
    ...override,
    handlerExpectations: {
      ...(base.handlerExpectations || {}),
      ...(override.handlerExpectations || {}),
    },
    uiInteractionChecks: Array.isArray(override.uiInteractionChecks)
      ? override.uiInteractionChecks
      : (Array.isArray(base.uiInteractionChecks) ? base.uiInteractionChecks : []),
  };
}

module.exports = {
  getBehaviorSpec,
};
