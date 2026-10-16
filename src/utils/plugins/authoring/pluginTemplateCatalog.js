// Shared by the creation dialog and workspace scaffolder. No Electron dependencies.
export const PLUGIN_TEMPLATES = Object.freeze([
    {value: 'blank', title: 'Blank', icon: 'document', description: 'A small plugin with a working status action. Build your own workflow.', features: ['Status action', 'Render tests', 'Development guide']},
    {value: 'utility', title: 'Local utility', icon: 'code', description: 'Inspect JSON locally with a labelled editor and clear success/error feedback.', features: ['Input → result', 'Pure logic module', 'No external access']},
    {value: 'service', title: 'Service monitor', icon: 'cloud', description: 'A service adapter, environment selector, loading feedback and results. Starts with labelled demo data.', features: ['Demo adapter', 'Error handling', 'No credentials needed']},
    {value: 'dashboard', title: 'Dashboard', icon: 'dashboard', description: 'A responsive operations overview with status cards, refresh, quick actions and a sidebar menu.', features: ['Responsive cards', 'Quickbar + sidebar', 'Demo metrics']},
    {value: 'dialogs', title: 'Styled dialogs', icon: 'application', description: 'A settings dialog with layered CSS, accessible form controls, validation and local save feedback.', features: ['Native modal dialog', 'CSS states + media rules', 'Local settings']},
    {value: 'splitGrid', title: 'Resizable workspace', icon: 'panel-stats', description: 'A Split Grid dashboard with a draggable divider, keyboard resizing and stacked panels on narrow screens.', features: ['Injected Split Grid', 'Accessible divider', 'Quickbar + sidebar']},
    {value: 'horDivided', title: 'Side-by-side workspace', icon: 'panel-stats', description: 'A dashboard with a contextual panel beside the main workspace, stacking on narrow screens.', features: ['Two-column layout', 'Quickbar + sidebar', 'Responsive styles']},
    {value: 'verDivided', title: 'Stacked workspace', icon: 'panel-table', description: 'A dashboard with a summary panel above the main workspace.', features: ['Stacked layout', 'Quickbar + sidebar', 'Responsive styles']},
]);
export function resolvePluginTemplate(value) {
    return PLUGIN_TEMPLATES.find(template => template.value === value) || PLUGIN_TEMPLATES[0];
}
