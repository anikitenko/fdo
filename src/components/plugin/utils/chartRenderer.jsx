import React from 'react';
import {createRoot} from 'react-dom/client';
import {Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis} from 'recharts';

const PIE_COLORS = ['#22b8f0', '#51cf66', '#fcc419', '#ff6b6b', '#b197fc', '#f783ac'];

export function PluginChart({config}) {
    const {type, data, series, xKey, height, label, theme, stacked, legend} = config;
    const ink = theme === 'light' ? '#334155' : '#cbd5e1';
    const tooltip = <Tooltip contentStyle={{backgroundColor: theme === 'light' ? '#ffffff' : '#10202e', border: '1px solid #64748b', color: ink}} itemStyle={{color: ink}} labelStyle={{color: ink}}/>;
    let chart;
    if (type === 'pie') {
        chart = <PieChart accessibilityLayer>{tooltip}{legend && <Legend/>}
            <Pie data={data.map((row, index) => ({name: row[xKey], value: row[series[0].key], fill: PIE_COLORS[index % PIE_COLORS.length]}))}
                dataKey="value" nameKey="name" isAnimationActive={false}/>
        </PieChart>;
    } else {
        const Chart = {line: LineChart, area: AreaChart, bar: BarChart}[type];
        const Series = {line: Line, area: Area, bar: Bar}[type];
        chart = <Chart data={data} accessibilityLayer margin={{top: 12, right: 20, bottom: 8, left: 8}}>
            <CartesianGrid stroke={ink} strokeOpacity={0.15} vertical={false}/>
            <XAxis dataKey={xKey} tick={{fill: ink}} tickLine={false}/>
            <YAxis tick={{fill: ink}} tickLine={false}/>
            {tooltip}{legend && <Legend/>}
            {series.map(item => <Series key={item.key} dataKey={item.key} name={item.label} stroke={item.color} fill={item.color}
                fillOpacity={type === 'area' ? 0.2 : 1} stackId={stacked && type !== 'line' ? 'total' : undefined}
                isAnimationActive={false} dot={type === 'line' ? false : undefined}/>) }
        </Chart>;
    }
    return <div role="figure" aria-label={label} style={{width: '100%', minWidth: 0, height, color: ink}}>
        {data.length ? <ResponsiveContainer width="100%" height="100%" minWidth={1}>{chart}</ResponsiveContainer>
            : <p role="status">No chart data available.</p>}
    </div>;
}

export function mountChart(element, config) {
    const root = createRoot(element);
    root.render(<PluginChart config={config}/>);
    return {update(next) {root.render(<PluginChart config={next}/>);}, dispose() {root.unmount();}};
}
