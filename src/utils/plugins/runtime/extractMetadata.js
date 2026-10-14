export async function extractMetadata(content) {
    // Find ALL { ... } blocks
    const objectMatches = content.match(/{[\s\S]*?}/g);
    if (!objectMatches) return null;

    for (const objectContent of objectMatches) {
        const fields = {
            name: matchField(objectContent, 'name'),
            version: matchField(objectContent, 'version'),
            author: matchField(objectContent, 'author'),
            description: matchField(objectContent, 'description'),
            icon: matchField(objectContent, 'icon'),
        };

        // Check that all fields exist
        if (Object.values(fields).every(Boolean)) {
            return fields;
        }
    }

    return null; // No valid metadata block found
}

function matchField(objectContent, fieldName) {
    const fieldRegex = new RegExp(
        `${fieldName}\\s*:\\s*["'\`](.*?)["'\`]`,
        'is' // i = case-insensitive, s = dotAll (allow \n)
    );
    const match = objectContent.match(fieldRegex);
    return match ? match[1] : undefined;
}
