import { HashRouter, Route, Routes } from 'react-router-dom';

import {Home} from './Home.jsx';
import {EditorPage} from "./components/editor/EditorPage.jsx";
import {LiveUI} from "./components/live-ui/LiveUI.jsx";

function App() {
    return (
        <HashRouter>
            <Routes>
                <Route path="/live-ui" element={<LiveUI />} />
                <Route path="/editor" element={<EditorPage />} />
                <Route path="/" exact element={<Home />} />
            </Routes>
        </HashRouter>
    );
}

export default App;