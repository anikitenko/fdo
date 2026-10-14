import {createCodingEstimator, codingEstimateProfile} from '../../src/utils/ai/assistant/aiCodingEstimate';

const assistant = {provider: 'provider-a', model: 'model-a', defaultThinkingMode: 'off'};
const stage = (index, total = 10, extra = {}) => ({path: `/file${index}.ts`, index, total, ...extra});
const storage = () => {
    let value = null;
    return {getItem: jest.fn(() => value), setItem: jest.fn((_, next) => { value = next; })};
};
function learn(estimator, {start = 0, count = 3, duration = 60000, chars = 6000} = {}) {
    for (let i = 0; i < count; i++) {
        const at = start + i * duration;
        estimator.stage(stage(i + 1, Math.max(10, count)), at);
        estimator.chunk('x'.repeat(chars / 2), at + 10000);
        estimator.chunk('x'.repeat(chars / 2), at + duration - 1000);
        estimator.complete(`/file${i + 1}.ts`, at + duration);
    }
}

test('learns only completed files and includes the last file in history', () => {
    const db = storage();
    const estimator = createCodingEstimator({assistant, storage: db, now: 0});
    expect(estimator.estimate(0).state).toBe('unknown');
    estimator.stage(stage(1), 0);
    expect(estimator.estimate(0).state).toBe('learning');
    estimator.stage(stage(2), 60000); // An interrupted file is not a sample.
    expect(db.setItem).not.toHaveBeenCalled();
    learn(estimator);
    expect(JSON.parse(db.getItem())[0].samples).toHaveLength(3);
    estimator.stage(stage(4), 180000);
    expect(estimator.estimate(180000)).toMatchObject({state: 'estimated', basis: 'recent file timings', samples: 3});
});

test('reuses matching history and isolates model and thinking configuration', () => {
    const db = storage();
    learn(createCodingEstimator({assistant, storage: db, now: 0}));
    const next = createCodingEstimator({assistant, storage: db, now: 200000});
    next.stage(stage(1), 200000);
    expect(next.estimate(200000).state).toBe('estimated');
    for (const change of [{model: 'model-b'}, {provider: 'provider-b'}, {defaultThinkingMode: 'on'}]) {
        const different = createCodingEstimator({assistant: {...assistant, ...change}, storage: db, now: 200000});
        different.stage(stage(1), 200000);
        expect(different.estimate(200000).state).toBe('learning');
    }
});

test('live throughput changes the current-file range; buffered bursts do not', () => {
    const estimator = createCodingEstimator({assistant, now: 0});
    learn(estimator);
    estimator.stage(stage(4, 4), 180000);
    estimator.chunk('x'.repeat(1000), 190000);
    expect(estimator.estimate(190000).basis).toBe('recent file timings');
    estimator.chunk('x'.repeat(1000), 200000);
    const slow = estimator.estimate(200000);
    expect(slow.basis).toContain('live response speed');
    estimator.chunk('x'.repeat(2000), 205000);
    const faster = estimator.estimate(205000);
    expect(faster.highMs).toBeLessThan(slow.highMs);
    expect(estimator.estimate(240001).state).toBe('stalled');
});

test('retry resets streamed characters while preserving spent time; resets and duplicate completions are safe', () => {
    const db = storage();
    const estimator = createCodingEstimator({assistant, storage: db, now: 0});
    estimator.stage(stage(1), 0);
    estimator.chunk('rejected', 10000);
    estimator.resetAttempt(20000);
    estimator.chunk('accepted', 30000);
    estimator.complete('/file1.ts', 60000);
    estimator.complete('/file1.ts', 60001);
    expect(JSON.parse(db.getItem())[0].samples).toEqual([
        {kind: 'code', repair: false, at: 60000, duration: 60000, chars: 8, startup: 30000},
    ]);
});

test('reports oversized and slow responses without promising zero time', () => {
    const estimator = createCodingEstimator({assistant, now: 0});
    learn(estimator);
    estimator.stage(stage(4, 4), 180000);
    expect(estimator.estimate(300000).state).toBe('slow');
    estimator.chunk('x'.repeat(5000), 310000);
    estimator.chunk('x'.repeat(5000), 320000);
    expect(estimator.estimate(320000).state).toBe('outgrown');
    estimator.stage(null);
    expect(estimator.estimate(320000).state).toBe('unknown');
});

test('bounds history, expires old samples and never stores code or credentials', () => {
    const db = storage();
    const estimator = createCodingEstimator({assistant: {...assistant, apiKey: 'secret'}, storage: db, now: 0});
    learn(estimator, {count: 45});
    const saved = db.getItem();
    expect(JSON.parse(saved)[0].samples).toHaveLength(40);
    expect(saved).not.toContain('secret');
    expect(saved).not.toContain('/file');
    expect(saved).not.toContain('xxxx');
    expect(codingEstimateProfile({...assistant, apiKey: 'secret'})).toBe(codingEstimateProfile(assistant));
    const expired = createCodingEstimator({assistant, storage: db, now: 40 * 86400000});
    expired.stage(stage(1), 40 * 86400000);
    expect(expired.estimate(40 * 86400000).state).toBe('learning');
});

test('ignores corrupt or unavailable storage and invalid stage events', () => {
    for (const db of [{getItem: () => '{'}, {getItem: () => { throw new Error('disabled'); }, setItem: () => { throw new Error('full'); }}]) {
        const estimator = createCodingEstimator({assistant, storage: db, now: 0});
        learn(estimator);
        estimator.stage({index: 0, total: 3});
        expect(estimator.estimate().state).toBe('unknown');
    }
});

test('shows a central estimate with confidence and moves the range into details', () => {
    const estimator = createCodingEstimator({assistant, now: 0});
    learn(estimator);
    estimator.stage(stage(4), 180000);
    const result = estimator.estimate(180000);
    expect(result.text).toBe('About 7 min remaining · Low confidence');
    expect(result.text).not.toContain('–');
    expect(result.details).toContain('Observed range:');
    expect(result.progress).toBe('3 of 10 files complete in this pass');
    expect(result.typicalMs).toBeGreaterThanOrEqual(result.lowMs);
    expect(result.typicalMs).toBeLessThanOrEqual(result.highMs);
});

test('confidence improves with consistent comparable observations', () => {
    const estimator = createCodingEstimator({assistant, now: 0});
    learn(estimator, {count: 8});
    estimator.stage(stage(9), 480000);
    expect(estimator.estimate(480000).confidence).toBe('High');
});

test('inconsistent timings suppress the central countdown', () => {
    const estimator = createCodingEstimator({assistant, now: 0});
    let at = 0;
    for (const duration of [60000, 600000, 60000, 600000, 60000, 600000]) {
        estimator.stage(stage(1), at);
        estimator.complete('/file1.ts', at + duration);
        at += duration;
    }
    estimator.stage(stage(7), at);
    const result = estimator.estimate(at);
    expect(result.state).toBe('unpredictable');
    expect(result.text).toBe('Timing is still unpredictable');
    expect(result.typicalMs).toBeUndefined();
    expect(result.details).toContain('vary substantially');
});
