import React from 'react';
import {FDO_AI_MARK_STYLES} from '../../utils/ai/assistant/fdoAiIdentity';

/** Decorative beside a label; provide label when used on its own. */
export default function FdoAiMark({active = false, ambient = false, phase = 'responding', size = 24, label, className = '', ...props}) {
    /** @type {React.CSSProperties & {'--fdo-ai-size': string}} */
    const markStyle = {'--fdo-ai-size': `${size}px`};

    return <>
        <style>{FDO_AI_MARK_STYLES}</style>
        <span {...props} className={`fdo-ai-mark ${className}`} data-active={active ? 'true' : 'false'}
            data-phase={phase}
            data-ambient={ambient ? 'true' : 'false'}
            style={markStyle} role={label ? 'img' : undefined}
            aria-label={label} aria-hidden={label ? undefined : true} />
    </>;
}
