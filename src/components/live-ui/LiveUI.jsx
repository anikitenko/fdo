import React from 'react';
import '@xyflow/react/dist/style.css';
import {FlowWithProvider} from "./FlowWithProvider.jsx";

export const LiveUI = () => {
    return (
        <div style={{width: '100vw', height: '100vh'}}>
            <FlowWithProvider />
        </div>
    );
}
