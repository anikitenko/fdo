const COLORS = ['#22b8f0', '#51cf66', '#fcc419', '#ff6b6b', '#b197fc', '#f783ac'];

// Keep the plugin API data-only. React components and callbacks stay host-owned.
export function normalizeChartConfig(config) {
    if (!config || !['line', 'area', 'bar', 'pie'].includes(config.type)) throw new Error('Unknown chart type.');
    const {data, series, xKey} = config;
    if (typeof xKey !== 'string' || !xKey || !Array.isArray(data) || data.length > 10000
        || !Array.isArray(series) || !series.length || series.length > 12) throw new Error('Invalid chart data or series.');
    if (config.type === 'pie' && series.length !== 1) throw new Error('Pie charts require one series.');
    const keys = new Set([xKey]);
    const normalizedSeries = series.map((item, index) => {
        if (!item || typeof item.key !== 'string' || !item.key || keys.has(item.key)) throw new Error('Chart keys must be distinct.');
        keys.add(item.key);
        if (item.color !== undefined && !/^#[a-fA-F0-9]{6}$/.test(item.color)) throw new Error('Use six-digit hex chart colors.');
        return {key: item.key, label: String(item.label ?? item.key), color: item.color ?? COLORS[index % COLORS.length]};
    });
    const rows = data.map(row => {
        if (!row || !['string', 'number'].includes(typeof row[xKey]) || (typeof row[xKey] === 'number' && !Number.isFinite(row[xKey]))) throw new Error('Each chart row needs an xKey label.');
        const values = [[xKey, row[xKey]]];
        for (const item of normalizedSeries) {
            const value = row[item.key] ?? null;
            if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || (config.type === 'pie' && value < 0))) throw new Error('Chart values must be finite numbers or null.');
            values.push([item.key, value]);
        }
        return Object.fromEntries(values);
    });
    const height = config.height ?? 280;
    if (!Number.isFinite(height) || height < 120 || height > 1600) throw new Error('Chart height must be between 120 and 1600 pixels.');
    return {type: config.type, data: rows, series: normalizedSeries, xKey, height,
        label: String(config.label ?? 'Chart'), theme: config.theme === 'light' ? 'light' : 'dark',
        stacked: config.stacked === true, legend: config.legend !== false};
}
