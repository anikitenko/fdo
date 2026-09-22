export function isAiCodingOutputLimitError(value) {
    return /^(?:Assistant stream response\.incomplete:\s*)?(?:max_output_tokens|max_tokens)\s*$/i.test(String(value?.message || value || "").trim());
}

// Restart once from the original task. Never concatenate a truncated answer
// with its replacement or quietly increase the provider's token budget.
export async function withCodingOutputRecovery({prompt, run, onRetry, isCancelled = () => false}) {
    try {
        return await run(prompt, 0);
    } catch (error) {
        if (!isAiCodingOutputLimitError(error) || isCancelled()) throw error;
        await onRetry();
        if (isCancelled()) throw error;
        return run(`${prompt}\n\nOUTPUT-LIMIT RECOVERY\nThe previous attempt exceeded the response limit and was not applied. Restart from the original task above. Return a compact, complete, self-contained answer within the same output budget. Preserve every requested feature, interaction, validation, style and test. Reduce repetition and explanatory prose; do not replace functionality with placeholders. Follow the originally requested response format: include all required files in full for full-file responses, or all complete patch blocks for patch responses. Do not continue the partial answer or assume any of it was applied.`, 1);
    }
}
