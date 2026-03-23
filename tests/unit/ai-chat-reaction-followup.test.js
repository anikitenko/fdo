import {
    buildRoutingPromptForIntentAnalysis,
    coerceReactionFollowUpIntent,
    shouldLockReactionFollowUpToSessionRoute,
} from "../../src/ipc/ai/ai_chat_core.js";
import { resolveTurnIntent } from "../../src/ipc/ai/tools/index.js";

describe("AI chat reaction follow-up runtime guard", () => {
    test("punctuation-only follow-up on active FDO thread is coerced and locked to session route", () => {
        const sessionRouting = {
            activeRoute: "fdo",
            activeTaskShape: "retrieval_grounded_help",
            activeScope: "general",
            routeConfidence: 0.4,
        };
        const deterministicIntent = {
            route: "general",
            routeReason: "no-follow-up-signal",
            routeCandidates: [],
            scope: "general",
            taskShape: "general_chat",
            confidence: 0.18,
        };

        const intent = coerceReactionFollowUpIntent("??", sessionRouting, deterministicIntent);

        expect(intent.route).toBe("fdo");
        expect(intent.routeReason).toBe("session-route");
        expect(intent.scope).toBe("general");
        expect(intent.taskShape).toBe("retrieval_grounded_help");
        expect(intent.confidence).toBeGreaterThanOrEqual(0.85);

        expect(
            shouldLockReactionFollowUpToSessionRoute("??", sessionRouting, deterministicIntent, intent)
        ).toBe(true);
    });

    test("non-reaction prompt does not get locked to session route", () => {
        const sessionRouting = {
            activeRoute: "fdo",
            activeTaskShape: "retrieval_grounded_help",
            activeScope: "plugins",
            routeConfidence: 0.9,
        };
        const deterministicIntent = {
            route: "fdo",
            routeReason: "direct",
            routeCandidates: ["fdo"],
            scope: "plugins",
            taskShape: "retrieval_grounded_help",
            confidence: 0.92,
        };

        const intent = coerceReactionFollowUpIntent("what about plugin manifests?", sessionRouting, deterministicIntent);

        expect(intent).toBe(deterministicIntent);
        expect(
            shouldLockReactionFollowUpToSessionRoute(
                "what about plugin manifests?",
                sessionRouting,
                deterministicIntent,
                intent
            )
        ).toBe(false);
    });

    test("reaction-only reply can inherit FDO route from reply-target context", () => {
        const routingPrompt = buildRoutingPromptForIntentAnalysis(
            "??",
            "Replying to user message:\nokay.. and can you please tell where in FDO I can improve chat with AI?"
        );

        const intent = resolveTurnIntent(routingPrompt, [], null);

        expect(intent.route).toBe("fdo");
    });

    test("non-reaction prompt does not use reply-target context for intent analysis", () => {
        const routingPrompt = buildRoutingPromptForIntentAnalysis(
            "give me golang snippet",
            "Replying to user message:\nhow is weather in Lutsk today?"
        );

        expect(routingPrompt).toBe("give me golang snippet");
    });
});
