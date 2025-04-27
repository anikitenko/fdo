import { existsSync } from 'fs';

export default async function ValidatePlugin(filePath) {
    if (!existsSync(filePath)) {
        throw new Error(`Plugin file does not exist: ${filePath}`);
    }

    return true;
}
