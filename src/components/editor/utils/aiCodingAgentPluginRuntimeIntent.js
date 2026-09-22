function normalizePrompt(prompt = "") {
    return String(prompt || "").trim().toLowerCase();
}

function hasQuotedPluginReference(prompt = "") {
    const raw = String(prompt || "");
    return /"[^"]+"\s+plugin\b/i.test(raw) || /'[^']+'\s+plugin\b/i.test(raw);
}

function emptyRuntimeIntent() {
    return {
        shouldProbe: false,
        wantsLogs: false,
        wantsActivate: false,
        wantsDeactivate: false,
        wantsInit: false,
        wantsRender: false,
        wantsRestart: false,
    };
}

export function detectAiPluginRuntimeIntent(prompt = "") {
    const normalized = normalizePrompt(prompt);
    if (!normalized) {
        return emptyRuntimeIntent();
    }

    // A creation request may naturally describe the UI to render, a verified
    // SDK icon, or an eventual open sidebar. Those are implementation details,
    // not a request to run lifecycle actions against the currently open plugin.
    // Probing here can fail before the new workspace even exists and pollute the
    // provider context with an unrelated runtime error.
    const isPluginCreationRequest = /\b(?:create|build|generate|scaffold|implement|make)\b[\s\S]{0,100}\bplugin\b/.test(normalized);
    if (isPluginCreationRequest) {
        return emptyRuntimeIntent();
    }

    const mentionsPlugin = /\bplugin\b/.test(normalized) || hasQuotedPluginReference(prompt);
    const asksLifecycle =
        /\b(enable|activate|disable|deactivate|stop|restart|reload)\b/.test(normalized)
        || /\b(run|start|open)\s+(?:the\s+)?plugin\b(?!\s+tests?\b)/.test(normalized)
        || /\bplugin\s+(?:run|start|open)\b/.test(normalized);
    const asksVerification = /\b(check|verify|confirm|diagnos(?:e|is)|trace)\b/.test(normalized);
    // Reading/showing source or UI content is not a request to inspect runtime logs.
    const asksLogs = /\b(log|logs|stderr|stdout|trace)\b/.test(normalized);
    const asksRuntimeVerification = asksVerification && /\b(log|logs|trace|loaded|ready|init|render|ui|runtime)\b/.test(normalized);

    const wantsRestart = /\b(restart|reload)\b/.test(normalized);
    const wantsDeactivate = /\b(disable|deactivate|stop|turn off)\b/.test(normalized);
    const wantsActivate = wantsRestart || /\b(run|start|enable|activate|open)\b/.test(normalized);
    const wantsInit = /\b(init|initialize)\b/.test(normalized) || asksVerification || asksLogs;
    const wantsRender = /\b(render|ui|screen|open)\b/.test(normalized) || asksVerification;

    const shouldProbe = mentionsPlugin && (asksLifecycle || asksRuntimeVerification || asksLogs);

    return {
        shouldProbe,
        wantsLogs: asksLogs || asksVerification || asksLifecycle,
        wantsActivate: shouldProbe && wantsActivate,
        wantsDeactivate: shouldProbe && wantsDeactivate,
        wantsInit: shouldProbe && wantsInit,
        wantsRender: shouldProbe && wantsRender,
        wantsRestart: shouldProbe && wantsRestart,
    };
}
