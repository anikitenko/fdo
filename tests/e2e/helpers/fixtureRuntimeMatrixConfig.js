const sdk = require("@anikitenko/fdo-sdk");

const SUPPORTED_FIXTURE_MATRIX_CONTRACT_VERSIONS = Object.freeze(["1"]);

function normalizeFixturePath(fixturePath) {
  const raw = String(fixturePath || "").trim().replace(/\\/g, "/").replace(/^\.\/+/, "");
  return raw.startsWith("examples/") ? raw.slice("examples/".length) : raw;
}

function normalizeUiMessageProbe(probe) {
  const handler = String(probe?.handler || "").trim();
  return {
    handler,
    description: String(probe?.description || "").trim(),
    content: probe && Object.prototype.hasOwnProperty.call(probe, "content") ? probe.content : {},
  };
}

function normalizeMatrixCase(entry) {
  const probes = entry?.probes && typeof entry.probes === "object" ? entry.probes : {};
  const uiMessageProbes = Array.isArray(probes.uiMessage) ? probes.uiMessage : [];
  const requiredCapabilities = Array.isArray(entry?.requiredCapabilities)
    ? Array.from(new Set(entry.requiredCapabilities.map((item) => String(item || "").trim()).filter(Boolean)))
    : [];

  return {
    id: String(entry?.id || "").trim(),
    title: String(entry?.title || "").trim(),
    description: String(entry?.description || "").trim(),
    fixturePath: normalizeFixturePath(entry?.fixturePath),
    probes: {
      init: probes.init !== false,
      render: probes.render !== false,
      renderOnLoad: !!probes.renderOnLoad,
      uiMessage: uiMessageProbes
        .map(normalizeUiMessageProbe)
        .filter((probe) => probe.handler.length > 0),
    },
    requiredCapabilities,
  };
}

function loadFixtureRuntimeMatrixContract() {
  if (typeof sdk.getFixtureRuntimeMatrix !== "function") {
    throw new Error(
      "Installed @anikitenko/fdo-sdk does not expose getFixtureRuntimeMatrix(). Update SDK to run fixture runtime matrix CI."
    );
  }

  const matrix = sdk.getFixtureRuntimeMatrix();
  const contractVersion = String(matrix?.contractVersion || "").trim();
  if (!SUPPORTED_FIXTURE_MATRIX_CONTRACT_VERSIONS.includes(contractVersion)) {
    throw new Error(
      `Unsupported SDK fixture runtime matrix contract version "${contractVersion || "unknown"}". ` +
      `Supported versions: ${SUPPORTED_FIXTURE_MATRIX_CONTRACT_VERSIONS.join(", ")}. ` +
      "Update FDO host CI matrix contract wiring or install a compatible @anikitenko/fdo-sdk release."
    );
  }

  const listedCases = typeof sdk.listFixtureRuntimeMatrixCases === "function"
    ? sdk.listFixtureRuntimeMatrixCases()
    : (Array.isArray(matrix?.cases) ? matrix.cases : []);
  const ids = Array.from(new Set((Array.isArray(listedCases) ? listedCases : [])
    .map((entry) => {
      if (entry && typeof entry === "object") {
        return String(entry.id || "").trim();
      }
      return String(entry || "").trim();
    })
    .filter(Boolean)));

  const fallbackCaseById = new Map(
    (Array.isArray(matrix?.cases) ? matrix.cases : [])
      .map((entry) => [String(entry?.id || "").trim(), entry])
      .filter(([id]) => id)
  );

  const cases = ids.map((id) => {
    const rawCase = typeof sdk.getFixtureRuntimeMatrixCase === "function"
      ? sdk.getFixtureRuntimeMatrixCase(id)
      : fallbackCaseById.get(id);
    if (!rawCase || typeof rawCase !== "object") {
      throw new Error(`Fixture runtime matrix case "${id}" could not be resolved from SDK.`);
    }
    const normalized = normalizeMatrixCase(rawCase);
    if (!normalized.fixturePath) {
      throw new Error(`Fixture runtime matrix case "${id}" is missing fixturePath.`);
    }
    if (!normalized.id) {
      throw new Error(`Fixture runtime matrix case with fixture "${normalized.fixturePath}" is missing id.`);
    }
    return normalized;
  });

  return {
    contractVersion,
    caseIds: ids,
    cases,
  };
}

module.exports = {
  SUPPORTED_FIXTURE_MATRIX_CONTRACT_VERSIONS,
  loadFixtureRuntimeMatrixContract,
  normalizeFixturePath,
};
