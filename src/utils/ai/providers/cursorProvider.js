import {Cursor} from '@cursor/sdk';

// Catalog access validates credentials without spending an inference request.
export async function listCursorModels(apiKey) {
    if (!String(apiKey || '').trim()) throw new Error('A Cursor user or service-account API key is required.');
    let timer;
    try {
        const models = await Promise.race([Cursor.models.list({apiKey}), new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('Cursor model discovery timed out. Check your connection and retry.')), 30000);
        })]);
        return models.filter(model => model.id).map(model => ({
            value: model.id, label: model.displayName || model.id, provider: 'cursor',
            modelMetadata: {modalities: model.modalities, inputModalities: model.inputModalities, input_modalities: model.input_modalities,
                architecture: model.architecture, capabilities: model.capabilities,
                selection: {id: model.id, params: (model.parameters || []).map(parameter => ({
                id: parameter.id, value: (parameter.id === 'optimize_for'
                    ? parameter.values.find(item => item.value === 'balanced') || parameter.values[0]
                    : parameter.values[0])?.value,
            })).filter(parameter => parameter.value != null)}},
        }));
    } catch (error) {
        throw new Error(String(error?.message || error).split(apiKey).join('[REDACTED]'));
    } finally {clearTimeout(timer);}
}

export async function inspectCursorModel({apiKey, model}) {
    const models = await listCursorModels(apiKey);
    const selected = models.find(item => item.value === model);
    if (!selected) throw new Error('The selected model is not available for this Cursor API key. Reload the model list and select an offered model.');
    return selected;
}
