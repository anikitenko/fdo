// Reproduces the live sequence: a consumer is accepted before its dependency;
// the dependency's source repair overflows, helpers complete, then its export
// changes. Keep the consumer and helpers intact during the final correction.
const consumer = {path: '/render.tsx', contract: 'Import renderDashboard from ./ui/dashboard and export render'};
const parent = {path: '/ui/dashboard.ts', contract: 'Export renderDashboard(): string'};
const helper = {path: '/ui/dashboard-content.ts', contract: 'Export renderDashboardContent(): string'};
const consumerSource = 'import {renderDashboard} from "./ui/dashboard";\nexport const render = () => renderDashboard();';
const missingImport = 'import {title} from "./dashboard-types";\nexport const renderDashboard = () => title;';
const wrongExport = 'export const renderDashboardContent = () => "Dashboard";';
const repaired = 'import {renderDashboardContent} from "./dashboard-content";\nexport const renderDashboard = () => renderDashboardContent();';
const encoded = (path, content) => JSON.stringify({path, lines: content.split('\n')});
module.exports = {consumer, parent, helper, wrongExport, missingImport, repaired, encoded,
    replies: [
        {content: JSON.stringify({files: [consumer, parent]})},
        {content: encoded(consumer.path, consumerSource)},
        {content: encoded(parent.path, missingImport)},
        {content: '', finishReason: 'length'},
        {content: JSON.stringify({files: [helper]})},
        {content: encoded(helper.path, wrongExport)},
        {content: encoded(parent.path, wrongExport)},
        {content: encoded(parent.path, repaired)},
    ]};
