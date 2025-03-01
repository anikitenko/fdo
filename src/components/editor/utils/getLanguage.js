const getLanguage = (filePath) => {
    if (filePath.endsWith(".ts") || filePath.endsWith(".tsx")) return "typescript";
    if (filePath.endsWith(".js") || filePath.endsWith(".mjs")) return "javascript";
    if (filePath.endsWith(".json")) return "json";
    if (filePath.endsWith(".md")) return "markdown";
    if (filePath.endsWith(".xml")) return "xml";
    if (filePath.endsWith(".html")) return "html";
    if (filePath.endsWith(".css")) return "css";
    return "plaintext";
}

export default getLanguage