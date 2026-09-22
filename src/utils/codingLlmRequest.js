export function sendCodingLlmRequest(llm, prompt, image = null, requestOptions = {}) {
    return llm.chat(prompt, {...requestOptions, stream: true, image});
}
