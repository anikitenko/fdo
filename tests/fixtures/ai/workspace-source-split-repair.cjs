const consumer = {path: '/render.tsx', contract: 'Export render using renderDashboard'};
const root = {path: '/features/tools/dashboard.tsx', contract: 'Export renderDashboard(): string with the dashboard cards', visualReference: true};
const library = {path: '/features/tools/library.tsx', contract: 'Export renderLibrary(): string'};
const tail = {path: '/tail.ts', contract: 'Export ready'};
const workspaceFiles = [{path: '/features/tools/Dashboard-cards.tsx', content: 'export const existing = true;'}];
const encode = (path, content) => JSON.stringify({path, lines: content.split('\n')});
const composition = 'import {renderCards} from "./dashboard-cards-2";\nexport const renderDashboard = (): string => renderCards();';
const expectedPaths = [consumer.path, '/features/tools/dashboard-cards-2.tsx', root.path, library.path, tail.path];
const replies = [
    {content: JSON.stringify({files: [consumer, root, library, tail]})},
    {content: encode(consumer.path, 'import {renderDashboard} from "./features/tools/dashboard";\nexport const render = (): string => renderDashboard();')},
    {content: '.partial', finishReason: 'length'},
    // Both split replies in the live failure repeated retained inventories.
    // Replace the second inventory request with responsibility-only recovery.
    {content: JSON.stringify({files: [root, library, consumer, tail]})},
    {content: JSON.stringify({helpers: [{name: 'cards', contract: 'Export renderCards(): string with the dashboard cards'}]})},
    {content: encode(expectedPaths[1], 'export const renderCards = (): string => "<section>Tools</section>";')},
    {content: encode(root.path, composition)},
    {content: encode(library.path, 'export const renderLibrary = (): string => "<aside>Library</aside>";')},
    {content: encode(tail.path, 'export const ready = true;')},
];
module.exports = {root, consumer, tail, replies, workspaceFiles, expectedPaths, composition, repairIndex: 4,
    repairHeading: 'FOCUSED MODULE DECOMPOSITION RETRY'};
