import React, { Suspense, lazy } from 'react';
import { HashRouter, Route, Routes } from 'react-router-dom';

import {Home} from './Home.jsx';
const EditorPage = lazy(() => import('./components/editor/EditorPage.jsx'));
const LiveUI = lazy(() => import('./components/live-ui/LiveUI.jsx'));

function App() {
    return (
        <HashRouter>
            <Suspense fallback={null}>
                <Routes>
                    <Route path="/live-ui" element={<LiveUI />} />
                    <Route path="/editor" element={<EditorPage />} />
                    <Route path="/" exact element={<Home />} />
                </Routes>
            </Suspense>
        </HashRouter>
    );
}

export default App;