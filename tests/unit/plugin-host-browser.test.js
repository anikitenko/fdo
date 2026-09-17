import {handleHostBrowserOpenRequest} from "../../src/utils/pluginHostBrowser";

describe("plugin host browser broker", () => {
    test("opens allowed https url via host shell bridge", async () => {
        const openExternal = jest.fn(async () => true);
        const response = await handleHostBrowserOpenRequest({
            url: "https://example.com/docs",
            policy: "trusted-content-link",
        }, {
            openExternal,
            pluginId: "plugin-browser",
        });

        expect(openExternal).toHaveBeenCalledWith("https://example.com/docs");
        expect(response).toEqual(expect.objectContaining({
            ok: true,
            url: "https://example.com/docs",
            policy: "trusted-content-link",
            correlationId: expect.any(String),
        }));
    });

    test("rejects unsupported protocols", async () => {
        const openExternal = jest.fn(async () => true);
        const response = await handleHostBrowserOpenRequest({
            url: "file:///etc/passwd",
            policy: "trusted-content-link",
        }, {
            openExternal,
            pluginId: "plugin-browser",
        });

        expect(openExternal).not.toHaveBeenCalled();
        expect(response).toEqual(expect.objectContaining({
            ok: false,
            code: "BROWSER_OPEN_PROTOCOL_UNSUPPORTED",
            correlationId: expect.any(String),
        }));
    });
});
