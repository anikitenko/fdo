export function buildAiCodingAgentStatusMessage({
    phase = "working",
    externalReferenceEnabled = false,
    sdkKnowledgeEnabled = false,
    includeProjectContext = false,
    issueDiagnosis = "",
} = {}) {
    const sources = [];
    if (externalReferenceEnabled) sources.push("reference URL");
    if (sdkKnowledgeEnabled) sources.push("bundled FDO SDK");
    if (includeProjectContext) sources.push("current project files");

    const sourceLine = sources.length > 0
        ? `Sources: ${sources.join(", ")}.`
        : "Sources: current request only.";
    const diagnosisLine = issueDiagnosis ? `\n${issueDiagnosis}` : "";

    switch (phase) {
        case "retrieval":
            return `Analyzing request context.\n${sourceLine}${diagnosisLine}`;
        case "reference":
            return `Analyzing the reference product and extracting implementation-relevant details.\n${sourceLine}${diagnosisLine}`;
        case "generation":
            return `Generating the implementation response.\n${sourceLine}${diagnosisLine}`;
        default:
            return `Working on the request.\n${sourceLine}${diagnosisLine}`;
    }
}
