import * as monaco from "monaco-editor";

export function buildAiCodingProblemsContext(models = []) {
    const relevantModels = Array.isArray(models) ? models.filter(Boolean) : [];
    if (relevantModels.length === 0) {
        return "";
    }

    const markers = relevantModels.flatMap((model) => (
        monaco.editor.getModelMarkers({ resource: model.uri }).map((marker) => ({
            path: model.uri.toString(true).replace("file://", ""),
            marker,
        }))
    ));

    if (markers.length === 0) {
        return "";
    }

    const lines = markers.slice(0, 20).map(({ path, marker }) => (
        `${path}:${marker.startLineNumber}:${marker.startColumn} [${marker.severity}] ${marker.message}`
    ));

    return `Current editor problems:\n${lines.join("\n")}\n\n`;
}

