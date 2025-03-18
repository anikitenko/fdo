export const generateActionId = (actionName) => {
    return actionName
        .toLowerCase()                      // Convert to lowercase
        .replace(/[^a-z0-9\s-]/gi, '')      // Remove special characters except space and dash
        .trim()                             // Remove leading/trailing spaces
        .replace(/\s+/g, '-')               // Replace spaces with dashes
        .replace(/-+/g, '-');               // Remove duplicate dashes
};