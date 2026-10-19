// Structural equivalent of SDK DOMStyleMap, also usable while SDK declarations
// are loading in Monaco. Numeric CSS values are emitted verbatim, not given px.
export const PLUGIN_CSS_TYPES = 'declare module "*.css" { interface StyleMap { [key: string]: string | number | null | undefined | StyleMap; } const styles: Record<string, StyleMap>; export default styles; }';

// Available only in deployed plugin frontend callbacks, not backend render().
const PLUGIN_BASE_UI_TYPES = 'interface FDOTerminalView {write(data: Uint8Array, consumed?: () => void): void; onData(callback: (text: string) => void): {dispose(): void}; onResize(callback: (size: {rows: number; columns: number}) => void): {dispose(): void}; getSize(): {rows: number; columns: number}; focus(): void; reset(): void; dispose(): void;} interface Window {FDOTerminal?: {readonly ready: boolean; create(element: HTMLElement, options?: {term?: string; rows?: number; columns?: number}): FDOTerminalView};} interface Window { loadFdoUi(): Promise<typeof import("@anikitenko/fdo-sdk/ui")>; }';

export const PLUGIN_CHART_TYPES = `interface FDOChartConfig {
    type: 'line' | 'area' | 'bar' | 'pie';
    data: Array<Record<string, string | number | null>>;
    xKey: string;
    series: Array<{key: string; label?: string; color?: string}>;
    height?: number;
    label?: string;
    theme?: 'dark' | 'light';
    stacked?: boolean;
    legend?: boolean;
}
interface FDOChartController {update(config: FDOChartConfig): void; dispose(): void;}
interface Window {FDOCharts: {readonly version: 1; create(element: HTMLElement, config: FDOChartConfig): Promise<FDOChartController>};}
`;

export const PLUGIN_UI_TYPES = PLUGIN_BASE_UI_TYPES + "\n" + PLUGIN_CHART_TYPES;
