import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';

import Home from './Home.jsx';
import {PluginPage} from "./components/plugin/PluginPage.jsx";

function App() {
    return (
        <Router>
            <Routes>
                <Route path="/plugin/" element={<PluginPage />} />
                <Route path="*" element={<Home />} />
            </Routes>
        </Router>
    );
}

export default App;