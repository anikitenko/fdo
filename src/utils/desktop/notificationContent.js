// Shared by main-process history and renderer feedback. Keep technical output
// in details, while the summary explains the outcome and the next useful step.
export function pluginDisplayName(plugin, fallback = 'Plugin') {
    const value = plugin?.metadata?.name || plugin?.gitops?.declaredId || plugin?.name || plugin?.id;
    if (typeof value !== 'string' || !value.trim()) return fallback;
    return value.replace(/^gitops_[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}_/i, '').trim();
}

export function diagnosticText(value) {
    let text = value instanceof Error ? value.stack || value.message : String(value ?? '');
    text = text.replace(/^Error:\s*/, '').replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '').replace(/^Error:\s*/, '');
    return text
        .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[private key removed]')
        .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[credentials removed]@')
        .replace(/([?&](?:access_token|token|api_key|key|signature|password|secret)=)[^\s&#]+/gi, '$1[redacted]')
        .replace(/(authorization\s*[:=]\s*)(?:Bearer|Basic)\s+[^\s,;]+/gi, '$1[redacted]')
        .replace(/(["']?(?:api[_-]?key|secret[_-]?key|password|access[_-]?token)["']?\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1[redacted]')
        .slice(0, 30000);
}

export function failureNotification({title, message, error, details, source = 'system', ...metadata}) {
    return {title, message, type: 'danger', source, ...metadata,
        details: [details, diagnosticText(error)].filter(Boolean).join('\n')};
}

export function operationError(context, error, fallback = 'Try again. Open the relevant settings if the problem continues.') {
    const detail = diagnosticText(error).split('\n')[0];
    return `${context}${detail ? `: ${detail}` : '.'} ${fallback}`;
}

export function publishNotification({title, message = '', type = 'primary', ...metadata}) {
    // A successful operation must remain successful if notification storage fails.
    try {
        return Promise.resolve(globalThis.window?.electron?.notifications?.add?.(title, message, type, metadata))
            .catch(() => {console.error('Could not save the notification.');});
    } catch {console.error('Could not save the notification.'); return Promise.resolve();}
}
