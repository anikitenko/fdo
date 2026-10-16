// Self-contained: also serialized into the fixed, sandboxed preview bridge.
// This validates data only; it never interprets selectors, expressions or code.
export function normalizeMockBackendScenario(input) {
    if (!input || !['success','error'].includes(input.outcome)
        || !Number.isInteger(input.latencyMs) || input.latencyMs < 0 || input.latencyMs > 10000
        || typeof input.loadingText !== 'string' || !input.loadingText.trim() || input.loadingText.length > 2000) return null;
    if (input.requestText !== undefined && (typeof input.requestText !== 'string' || input.requestText.length > 2000)) return null;
    const display=input.display ?? 'json';
    if (!['json','text','length','summary','valueType','itemCount','topLevelKeys'].includes(display)) return null;
    let text;
    if (input.outcome === 'success') {
        if (typeof input.responseText !== 'string' || input.responseText.length > 16000) return null;
        try {
            const result=JSON.parse(input.responseText);
            if(input.preset === 'inspect-json' && result?.success === false) return {outcome:'error',latencyMs:input.latencyMs,loadingText:input.loadingText,text:typeof result.error === 'string' ? result.error.slice(0,16000) : 'Invalid JSON inspection response.'};
            const validField=value=>display === 'topLevelKeys' ? Array.isArray(value) && value.every(key=>typeof key === 'string') : ['length','itemCount'].includes(display) ? Number.isInteger(value) && value >= 0 : display === 'valueType' ? ['object','array','null','string','number','boolean'].includes(value) : typeof value === 'string';
            if(display === 'json') text=JSON.stringify(result,null,2);
            else if(!result || !Object.hasOwn(result,display) || !validField(result[display]))
                return {outcome:'error',latencyMs:input.latencyMs,loadingText:input.loadingText,text:'Missing or invalid response field: '+display+'.'};
            else text=display === 'topLevelKeys' ? JSON.stringify(result[display],null,2) : String(result[display]);
        } catch {return null;}
        if (text.length > 16000) return null;
    } else {
        if (typeof input.errorText !== 'string' || !input.errorText.trim() || input.errorText.length > 2000) return null;
        text = input.errorText;
    }
    return {outcome:input.outcome,latencyMs:input.latencyMs,loadingText:input.loadingText,text};
}
