const getLanguage = (filePath) => {
    if (/\.(?:ts|tsx|mts|cts)$/i.test(filePath)) return "typescript";
    if (/\.(?:js|jsx|mjs|cjs)$/i.test(filePath)) return "javascript";
    if (filePath.endsWith(".json")) return "json";
    if (filePath.endsWith(".md")) return "markdown";
    if (filePath.endsWith(".xml")) return "xml";
    if (filePath.endsWith(".html")) return "html";
    if (filePath.endsWith(".css")) return "css";
    return "plaintext";
}

export default getLanguage
