import ReactDOM from 'react-dom/client';
import React from 'react';
import {HashRouter, Route, Routes} from 'react-router-dom';
import {PluginPage} from "./components/plugin/PluginPage.jsx";

// Check if we're in a plugin window (has plugin-root element)
const rootElement = document.getElementById('plugin-root');

if (rootElement) {
    // We're in a plugin window - mount React
    const root = ReactDOM.createRoot(rootElement);
    
    root.render(
        <HashRouter>
            <Routes>
                <Route path="*" element={<PluginPage/>}/>
            </Routes>
        </HashRouter>
    );
} else {
    // We're in main window - this is expected when both entry points load in index.html
    // Do nothing (no error, no warning - this is intentional)
}
