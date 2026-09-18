describe("live AI test request budget", () => {
    let reserve;
    beforeEach(() => {
        jest.resetModules();
        reserve = require("../../src/utils/liveAiTestBudget").reserveLiveAiTestRequest;
    });
    test("does not change normal application behavior", () => {
        for (let i = 0; i < 60; i++) reserve({FDO_E2E: "0", FDO_E2E_LIVE_AI: "1"});
    });
    test("blocks requests after the configured limit", () => {
        const env = {FDO_E2E: "1", FDO_E2E_LIVE_AI: "1", FDO_TEST_AI_MAX_REQUESTS: "2"};
        reserve(env);
        reserve(env);
        expect(() => reserve(env)).toThrow("limit reached (2)");
    });
    test.each(["0", "51", "NaN", "1.5"])("rejects invalid limit %s", limit => {
        expect(() => reserve({FDO_E2E: "1", FDO_E2E_LIVE_AI: "1", FDO_TEST_AI_MAX_REQUESTS: limit})).toThrow("integer from 1 to 50");
    });
});
