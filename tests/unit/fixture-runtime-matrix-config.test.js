const {
  loadFixtureRuntimeMatrixContract,
  SUPPORTED_FIXTURE_MATRIX_CONTRACT_VERSIONS,
} = require("../e2e/helpers/fixtureRuntimeMatrixConfig");

describe("fixture runtime matrix contract loader", () => {
  test("loads matrix cases from SDK contract exports", () => {
    const matrix = loadFixtureRuntimeMatrixContract();
    expect(SUPPORTED_FIXTURE_MATRIX_CONTRACT_VERSIONS).toContain(matrix.contractVersion);
    expect(Array.isArray(matrix.caseIds)).toBe(true);
    expect(Array.isArray(matrix.cases)).toBe(true);
    expect(matrix.cases.length).toBeGreaterThan(0);
    expect(matrix.cases[0]).toEqual(expect.objectContaining({
      id: expect.any(String),
      fixturePath: expect.any(String),
      probes: expect.objectContaining({
        init: expect.any(Boolean),
        render: expect.any(Boolean),
        renderOnLoad: expect.any(Boolean),
        uiMessage: expect.any(Array),
      }),
    }));
  });
});
