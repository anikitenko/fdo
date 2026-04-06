describe("codex heartbeat contract", () => {
    test("heartbeat stream delta shape is non-content and renderer-safe", () => {
        const heartbeat = {
            requestId: "req-1",
            type: "heartbeat",
            content: " ",
        };

        expect(heartbeat.type).toBe("heartbeat");
        expect(heartbeat.content).toBe(" ");
        expect(/\S/.test(heartbeat.content)).toBe(false);
    });
});
