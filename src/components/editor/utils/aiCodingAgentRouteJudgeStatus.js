export function buildAiCodingRouteJudgeStatus(decision = {}) {
    if (!decision?.usedJudge) {
        return "";
    }
    switch (decision.reason) {
        case "judge-confirmed":
            return "Routing safety check confirmed the requested intent before execution.";
        case "judge-blocked-mutation":
            return "Routing safety check downgraded this request to analysis-only because the turn reads like a question or verification request.";
        case "mutating-route-conflict":
            return "Routing safety check detected conflicting mutating routes and downgraded to analysis-only.";
        case "judge-upgraded-deterministic":
            return "Routing safety check detected explicit edit intent and promoted the request to a concrete coding action.";
        case "judge-low-confidence":
            return "Routing safety check was low confidence, so FDO kept the safer route.";
        default:
            return "Routing safety check completed.";
    }
}

