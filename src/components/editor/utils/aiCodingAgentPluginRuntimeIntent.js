function normalizePrompt(prompt = "") {
    return String(prompt || "").trim().toLowerCase();
}

function hasQuotedPluginReference(prompt = "") {
    const raw = String(prompt || "");
    return /"[^"]+"\s+plugin\b/i.test(raw) || /'[^']+'\s+plugin\b/i.test(raw);
}

export function detectAiPluginRuntimeIntent(prompt = "") {
    const normalized = normalizePrompt(prompt);
    if (!normalized) {
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

    const mentionsPlugin = /\bplugin\b/.test(normalized) || hasQuotedPluginReference(prompt);
    const asksLifecycle =
        /\b(enable|activate|disable|deactivate|stop|restart|reload)\b/.test(normalized)
        || /\b(run|start|open)\s+(?:the\s+)?plugin\b(?!\s+tests?\b)/.test(normalized)
        || /\bplugin\s+(?:run|start|open)\b/.test(normalized);
    const asksVerification = /\b(check|verify|confirm|diagnos(?:e|is)|trace)\b/.test(normalized);
    const asksLogs = /\b(log|logs|stderr|stdout|trace|checkout|check out|read|show|view)\b/.test(normalized);
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
