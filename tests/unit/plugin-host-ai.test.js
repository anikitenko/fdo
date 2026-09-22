jest.mock("../../src/utils/store", () => ({
    settings: {
        get: jest.fn(),
    },
}));

const mockChat = jest.fn(async () => ({content: "ok"}));

jest.mock("../../src/utils/aiProviderClient", () => {
    return jest.fn().mockImplementation(() => ({
        chat: mockChat,
    }));
});

import {settings} from "../../src/utils/store";
import {
    handleHostAiAssistantsListRequest,
    handleHostAiRequest,
    listHostAiAssistants,
} from "../../src/utils/pluginHostAi";

describe("plugin host ai", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        settings.get.mockImplementation((key) => {
            if (key === "ai.chat") {
                return [
                    {id: "chat-2", name: "Zulu", provider: "openai", model: "gpt-4.1", default: false, updatedAt: "2026-01-01T00:00:00.000Z"},
                    {id: "chat-1", name: "Alpha", provider: "openai", model: "gpt-4.1", default: true, updatedAt: "2026-01-02T00:00:00.000Z"},
                ];
            }
            if (key === "ai.coding") {
                return [
                    {id: "code-1", name: "Builder", provider: "anthropic", model: "claude-3-7-sonnet", default: false, updatedAt: "2026-01-01T00:00:00.000Z", apiKey: "k-1"},
                ];
            }
            return [];
        });
    });

    test("lists assistants with deterministic default-first ordering", async () => {
        const assistants = listHostAiAssistants({});
        expect(assistants.map((item) => item.id)).toEqual(["chat-1", "code-1", "chat-2"]);
    });

    test("enforces capabilities for assistants list handler", async () => {
        const denied = await handleHostAiAssistantsListRequest({}, {grantedCapabilities: []});
        expect(denied).toEqual(expect.objectContaining({
            ok: false,
            code: "AI_CAPABILITY_DENIED",
        }));
    });

    test("routes request to assistant selected by assistantId and returns task-shaped payload", async () => {
        mockChat.mockResolvedValueOnce({content: "feat: add AI bridge"});
        const response = await handleHostAiRequest({
            task: "commit-message",
            assistantId: "chat-1",
            prompt: "Generate commit message",
        }, {
            grantedCapabilities: ["system.ai", "system.ai.request"],
        });

        expect(response).toEqual(expect.objectContaining({
            ok: true,
            commitMessage: "feat: add AI bridge",
            assistantId: "chat-1",
        }));
    });

    test("returns degraded response when provider is unavailable for request routing", async () => {
        settings.get.mockImplementation((key) => {
            if (key === "ai.chat") return [];
            if (key === "ai.coding") {
                return [
                    {id: "code-codex", name: "Codex", provider: "codex-cli", model: "gpt-5-codex", default: true},
                ];
            }
            return [];
        });

        const response = await handleHostAiRequest({
            task: "summarize-command-output",
            assistantId: "code-codex",
        }, {
            grantedCapabilities: ["system.ai", "system.ai.request"],
        });

        expect(response).toEqual(expect.objectContaining({
            ok: false,
            code: "AI_PROVIDER_UNAVAILABLE",
            degraded: true,
        }));
    });

    test("treats Gemini CLI as unavailable for host-side plugin AI routing", async () => {
        settings.get.mockImplementation((key) => {
            if (key === "ai.chat") return [];
            if (key === "ai.coding") {
                return [
                    {id: "code-gemini", name: "Gemini CLI", provider: "gemini-cli", model: "gemini-2.5-pro", default: true},
                ];
            }
            return [];
        });

        const response = await handleHostAiRequest({
            task: "summarize-command-output",
            assistantId: "code-gemini",
        }, {
            grantedCapabilities: ["system.ai", "system.ai.request"],
        });

        expect(response).toEqual(expect.objectContaining({
            ok: false,
            code: "AI_PROVIDER_UNAVAILABLE",
            degraded: true,
        }));
    });
});
