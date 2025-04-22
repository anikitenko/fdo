import ReactDOM from 'react-dom/client';
import React from 'react';
import {HashRouter, Route, Routes} from 'react-router-dom';
import {PluginPage} from "./components/plugin/PluginPage.jsx";

const root = ReactDOM.createRoot(document.getElementById('plugin-root'));

root.render(
    <HashRouter>
        <Routes>
            <Route path="*" element={<PluginPage/>}/>
        </Routes>
    </HashRouter>
);
