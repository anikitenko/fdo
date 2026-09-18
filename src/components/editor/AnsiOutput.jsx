import React from "react";

const colors = ["#202124", "#ff7b72", "#7ee787", "#e3b341", "#79c0ff", "#d2a8ff", "#76e3ea", "#e6edf3"];

// Interpret SGR formatting as React styles, never as HTML from the plugin process.
export function AnsiOutput({text}) {
    const segments = [];
    let style = {};
    let offset = 0;
    const value = String(text ?? "");
    const codes = /\x1b\[([0-9;]*)m/g;
    let match;
    while ((match = codes.exec(value))) {
        if (match.index > offset) segments.push({text: value.slice(offset, match.index), style: {...style}});
        for (const code of (match[1] || "0").split(";").map(Number)) {
            if (code === 0) style = {};
            else if (code === 1) style.fontWeight = "bold";
            else if (code === 2) style.opacity = 0.7;
            else if (code === 3) style.fontStyle = "italic";
            else if (code === 4) style.textDecoration = "underline";
            else if (code === 22) { delete style.fontWeight; delete style.opacity; }
            else if (code === 23) delete style.fontStyle;
            else if (code === 24) delete style.textDecoration;
            else if (code === 39) delete style.color;
            else if (code === 49) delete style.backgroundColor;
            else if (code >= 30 && code <= 37) style.color = colors[code - 30];
            else if (code >= 90 && code <= 97) style.color = code === 90 ? "#8b949e" : colors[code - 90];
            else if (code >= 40 && code <= 47) style.backgroundColor = colors[code - 40];
        }
        offset = codes.lastIndex;
    }
    if (offset < value.length) segments.push({text: value.slice(offset), style});
    return <span style={{whiteSpace: "pre-wrap", fontFamily: "monospace"}}>
        {segments.map((segment, index) => <span key={index} style={segment.style}>{segment.text}</span>)}
    </span>;
}
