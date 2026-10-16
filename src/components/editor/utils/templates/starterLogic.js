// These source templates run in the virtual plugin workspace; workspace typecheck tests validate them.
// language=TEXT
export const UTILITY_LOGIC = `export type Inspection = {valid: boolean; message: string};
export function inspectJson(source: string): Inspection {
    if (!source.trim()) return {valid: false, message: 'Paste JSON before inspecting.'};
    try {
        const value: unknown = JSON.parse(source);
        const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
        const keys = value !== null && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : [];
        const count = Array.isArray(value) ? value.length : keys.length;
        return {valid: true, message: 'Valid JSON · ' + type + '\\nTop-level items: ' + count + (keys.length ? '\\nKeys: ' + keys.join(', ') : '')};
    } catch (error) { return {valid: false, message: 'Invalid JSON: ' + (error instanceof Error ? error.message : String(error))}; }
}
`;
// language=TEXT
export const SERVICE_LOGIC = `export type Environment = 'staging' | 'production';
export type ServiceStatus = {environment: Environment; mode: 'demo'; services: {name: string; status: string}[]};
export function readEnvironment(value: unknown): Environment {
    if (value !== 'staging' && value !== 'production') throw new Error('Choose staging or production.');
    return value;
}
// Replace this adapter when integrating a real service. No network or credentials are used here.
export async function loadServiceStatus(environment: Environment): Promise<ServiceStatus> {
    const selected = readEnvironment(environment);
    return {environment: selected, mode: 'demo', services: [
        {name: 'API', status: 'Healthy'}, {name: 'Worker', status: selected === 'production' ? 'Healthy' : 'Maintenance'},
    ]};
}
`;
export const DASHBOARD_LOGIC = `export function dashboardCards(view: string) {
    return view === 'activity' ? [{name: 'Latest deployment', value: 'Demo release 1.0'}, {name: 'Recent checks', value: '12 passed'}]
        : [{name: 'Services', value: '3 healthy'}, {name: 'Queue', value: '0 pending'}, {name: 'Deployments', value: '1 demo release'}];
}
`;
