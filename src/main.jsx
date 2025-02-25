import * as React from 'react';
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from "./App.jsx";
import {BlueprintProvider} from "@blueprintjs/core";

const root = createRoot(document.getElementById('root'));
root.render(
    <StrictMode>
        <BlueprintProvider>
            <App/>
        </BlueprintProvider>
    </StrictMode>,
);
