import React, { useEffect, useRef } from "react";
import { Terminal } from '@xterm/xterm';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { AttachAddon } from '@xterm/addon-attach';
import { FitAddon } from '@xterm/addon-fit';
import "@xterm/xterm/css/xterm.css";

const TerminalComponent = () => {
    const terminalRef = useRef(null);
    const wsRef = useRef(null);

    useEffect(() => {
        const term = new Terminal();
        term.loadAddon(new WebLinksAddon());
        //const fitAddon = new FitAddon();
        //term.loadAddon(fitAddon);
        term.open(terminalRef.current);
        //fitAddon.fit();

        // Use internal WebSocket URI (no open ports)
        const socket = new WebSocket("ws://localhost/terminal");
        socket.onopen = () => console.log("WebSocket connected");

        const attachAddon = new AttachAddon(socket);
        term.loadAddon(attachAddon);

        wsRef.current = socket;

        return () => {
            socket.close();
            term.dispose();
        };
    }, []);

    return <div ref={terminalRef} style={{ width: "100%", height: "100%" }} />;
};

export default TerminalComponent;
