// Structural equivalent of SDK DOMStyleMap, also usable while SDK declarations
// are loading in Monaco. Numeric CSS values are emitted verbatim, not given px.
export const PLUGIN_CSS_TYPES = 'declare module "*.css" { interface StyleMap { [key: string]: string | number | null | undefined | StyleMap; } const styles: Record<string, StyleMap>; export default styles; }';

// Available only in deployed plugin frontend callbacks, not backend render().
export const PLUGIN_UI_TYPES = 'interface Window { loadFdoUi(): Promise<typeof import("@anikitenko/fdo-sdk/ui")>; }';
