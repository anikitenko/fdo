import React, {useEffect, useState} from 'react';
import virtualFS from './utils/VirtualFS';
import ContextMenu from './context_menu/CONTEXT_MENU';

export default function MonacoEditorContextMenu({editor}) {
    const [context, setContext] = useState(null);

    useEffect(() => {
        const show = mouseEvent => {
            const event = mouseEvent?.event?.browserEvent ?? mouseEvent;
            event?.preventDefault?.();
            event?.stopPropagation?.();
            const modelPath = editor?.getModel?.()?.uri?.path;
            const contextElement = virtualFS.getTreeObjectItemById(modelPath) ||
                virtualFS.getTreeObjectItemById(virtualFS.tabs.getActiveTabId()) ||
                virtualFS.getTreeObjectItemById('/');
            const left = event?.clientX ?? mouseEvent?.event?.posx;
            const top = event?.clientY ?? mouseEvent?.event?.posy;
            if (Number.isFinite(left) && Number.isFinite(top)) {
                setContext({contextElement, offset: {left, top}});
            }
        };
        if (typeof editor?.onContextMenu === 'function') {
            const subscription = editor.onContextMenu(show);
            return () => subscription?.dispose?.();
        }

        const node = editor?.getDomNode?.();
        if (!node) return undefined;
        node.addEventListener('contextmenu', show);
        return () => node.removeEventListener('contextmenu', show);
    }, [editor]);

    if (!context) return null;
    return <ContextMenu
        contextElement={context.contextElement}
        offset={context.offset}
        editor={editor}
        onClose={() => setContext(null)}
    />;
}
