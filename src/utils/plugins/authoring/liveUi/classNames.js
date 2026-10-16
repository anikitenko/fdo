// Shared by the visual form and host planner: this is the supported authoring
// subset, not a claim to implement CSS's full escaped identifier grammar.
export function classNameError(name) {
    if (typeof name !== 'string' || !name) return 'Enter a class name, for example primary-button.';
    if (name.length > 80) return 'Keep the class name to 80 characters or fewer.';
    if (['constructor', 'prototype', '__proto__'].includes(name)) return 'This name is reserved. Choose a descriptive name such as primary-button.';
    if (name.startsWith('.')) return 'Leave out the leading dot: use primary-button, not .primary-button.';
    if (/\s/.test(name)) return 'Use one class name without spaces. Separate words with hyphens, for example primary-button.';
    if (!/^[a-zA-Z]/.test(name)) return 'Start the class name with a letter, for example button-2.';
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(name)) return 'Use only letters, numbers, hyphens or underscores. Leave out CSS selectors and punctuation.';
    return '';
}
