import {useCallback, useEffect, useRef, useState} from 'react';

export function usePluginVerification(plugin, enabled = true) {
    const [state, setState] = useState(null);
    const requestVersion = useRef(0);
    const id = plugin?.id;
    const refresh = useCallback(async () => {
        if (!enabled || !id) return;
        const version = ++requestVersion.current;
        setState(null);
        try {
            const result = await window.electron.plugin.verifySignature(id);
            if (version === requestVersion.current) setState({id, result});
        } catch (error) {
            if (version === requestVersion.current) setState({id, result: {success: false, error: error.message}});
        }
    }, [id, enabled]);

    useEffect(() => {
        if (!enabled || !id) {setState(null); return;}
        const onChanged = changedId => {if (changedId === id) void refresh();};
        const unsubscribe = window.electron.plugin.on?.signatureChanged?.(onChanged);
        window.addEventListener('focus', refresh);
        void refresh();
        return () => {
            ++requestVersion.current;
            window.removeEventListener('focus', refresh);
            if (typeof unsubscribe === 'function') unsubscribe();
            else window.electron.plugin.off?.signatureChanged?.(onChanged);
        };
    }, [plugin, id, enabled, refresh]);

    return state?.id === id ? state.result : null;
}
