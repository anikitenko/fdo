import {installChartRenderer} from '../../src/components/plugin/utils/chartBridge';
import {normalizeChartConfig} from '../../src/components/plugin/utils/chartConfig';

const config = () => ({type: 'area', xKey: 'day', data: [{day: 'Mon', cost: 12}, {day: 'Tue', cost: null}], series: [{key: 'cost'}]});
let bridge;
afterEach(() => {bridge?.dispose(); document.body.replaceChildren();});
function fixture(loader) {
    const chart = {update: jest.fn(), dispose: jest.fn()};
    const mountChart = jest.fn(() => chart);
    const load = loader ?? jest.fn(async () => ({mountChart}));
    bridge = installChartRenderer(window, load);
    const element = document.createElement('div'); document.body.append(element);
    return {element, load, chart, mountChart};
}
test('charts load on demand, snapshot data, update and release roots exactly once', async () => {
    const {element, load, chart, mountChart} = fixture();
    expect(load).not.toHaveBeenCalled();
    const source = config();
    const controller = await window.FDOCharts.create(element, source);
    source.data[0].cost = 999;
    expect(mountChart.mock.calls[0][1].data[0].cost).toBe(12);
    await expect(window.FDOCharts.create(element, config())).rejects.toThrow('already mounted');
    controller.update({...config(), type: 'bar', stacked: true});
    expect(chart.update.mock.calls[0][0].type).toBe('bar');
    expect(() => controller.update({...config(), data: [{day: 'Mon', cost: NaN}]})).toThrow('finite numbers');
    expect(chart.update).toHaveBeenCalledTimes(1);
    controller.dispose(); controller.dispose();
    expect(chart.dispose).toHaveBeenCalledTimes(1);
    expect(() => controller.update(config())).toThrow('disposed');
    await window.FDOCharts.create(element, config());
    expect(load).toHaveBeenCalledTimes(1);
});
test('removed chart containers are cleaned up automatically', async () => {
    const {element, chart} = fixture();
    await window.FDOCharts.create(element, config());
    element.remove();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(chart.dispose).toHaveBeenCalledTimes(1);
});
test('pending creation cannot mount in a removed view and failed loads can retry', async () => {
    let resolve;
    const mountChart = jest.fn();
    const {element} = fixture(() => new Promise(done => {resolve = done;}));
    const creating = window.FDOCharts.create(element, config());
    await expect(window.FDOCharts.create(element, config())).rejects.toThrow('already mounted');
    element.remove(); resolve({mountChart});
    await expect(creating).rejects.toThrow('removed');
    expect(mountChart).not.toHaveBeenCalled();
    bridge.dispose();
    const load = jest.fn().mockRejectedValueOnce(new Error('chunk unavailable')).mockResolvedValue({mountChart: () => ({dispose() {}})});
    const second = fixture(load);
    await expect(window.FDOCharts.create(second.element, config())).rejects.toThrow('chunk unavailable');
    await expect(window.FDOCharts.create(second.element, config())).resolves.toBeDefined();
});
test('page teardown closes all charts and rejects new mounts', async () => {
    const {element, chart} = fixture();
    const api = window.FDOCharts;
    await api.create(element, config());
    window.dispatchEvent(new Event('pagehide'));
    expect(chart.dispose).toHaveBeenCalledTimes(1);
    expect(window.FDOCharts).toBeUndefined();
    await expect(api.create(element, config())).rejects.toThrow('connected');
});
test('rejects invalid chart configuration and handles empty and missing data honestly', () => {
    expect(normalizeChartConfig({...config(), data: []}).data).toEqual([]);
    expect(normalizeChartConfig({...config(), data: [{day: 'Mon'}]}).data[0].cost).toBeNull();
    for (const invalid of [null, {...config(), type: 'graph'}, {...config(), height: 0},
        {...config(), series: [{key: 'cost', color: 'url(example)'}]}, {...config(), data: [{day: 'Mon', cost: Infinity}]},
        {...config(), series: [{key: 'day'}]}, {...config(), data: Array(10001).fill({day: 'Mon', cost: 1})},
        {...config(), type: 'pie', data: [{day: 'Mon', cost: -1}]}]) {
        expect(() => normalizeChartConfig(invalid)).toThrow();
    }
});


test('teardown during lazy loading prevents a late React root', async () => {
    let resolve;
    const mountChart = jest.fn();
    const {element} = fixture(() => new Promise(done => {resolve = done;}));
    const creating = window.FDOCharts.create(element, config());
    bridge.dispose();
    resolve({mountChart});
    await expect(creating).rejects.toThrow('removed');
    expect(mountChart).not.toHaveBeenCalled();
});
