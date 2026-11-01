// Input is already JSON-serialized. Preserve its quotes and backslash escapes;
// encode only literal characters that need protection when embedded in HTML.
const unsafeJsCharMap = {'<':'\\u003C','>':'\\u003E','/':'\\u002F','\u2028':'\\u2028','\u2029':'\\u2029'};
export const escapeUnsafeJsChars = value => value.replace(/[<>\/\u2028\u2029]/g, char => unsafeJsCharMap[char]);
