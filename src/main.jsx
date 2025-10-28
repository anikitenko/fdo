import * as React from 'react';
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from "./App.jsx";
import {BlueprintProvider} from "@blueprintjs/core";

// Log React mount start
window.electron?.startup?.logMetric('react-mount-start');

// Webpack scripts are deferred by default, so DOM is ready when this runs
const rootElement = document.getElementById('root');

if (!rootElement) {
    console.error('root element not found! DOM state:', document.readyState);
    // Retry after a brief delay
    setTimeout(() => {
        const retryRoot = document.getElementById('root');
        if (retryRoot) {
            mountApp(retryRoot);
        } else {
            console.error('root element still not found after retry!');
        }
    }, 100);
} else {
    mountApp(rootElement);
}

function mountApp(element) {
    const root = createRoot(element);
    root.render(
        <StrictMode>
            <BlueprintProvider>
                <App/>
            </BlueprintProvider>
        </StrictMode>,
    );
    
    // Log React mount complete and app interactive after next frame
    requestAnimationFrame(() => {
        window.electron?.startup?.logMetric('react-mount-complete');
        window.electron?.startup?.logMetric('app-interactive');
    });
}
