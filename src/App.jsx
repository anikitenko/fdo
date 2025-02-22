import { HashRouter, Route, Routes } from 'react-router-dom';

import Home from './Home.jsx';
import {PluginPage} from "./components/plugin/PluginPage.jsx";
import {EditorPage} from "./components/editor/EditorPage.jsx";

function App() {
    return (
        <HashRouter>
            <Routes>
                <Route path="/plugin" element={<PluginPage />} />
                <Route path="/editor" element={<EditorPage />} />
                <Route path="/" exact element={<Home />} />
            </Routes>
        </HashRouter>
    );
}

export default App;