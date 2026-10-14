const STORAGE_KEY = 'fdo:ai-coding-estimates:v2';
const MAX_AGE = 30 * 24 * 60 * 60 * 1000;
const kinds = new Set(['code', 'style', 'data']);
const kindOf = path => /\.(css|scss|less)$/i.test(path) ? 'style' : /\.(json|ya?ml)$/i.test(path) ? 'data' : 'code';
const quantile = (values, fraction) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor((sorted.length - 1) * fraction)];
};
const validSample = (sample, now) => sample && kinds.has(sample.kind)
    && typeof sample.repair === 'boolean'
    && ['at', 'duration', 'chars', 'startup'].every(key => Number.isFinite(sample[key]))
    && sample.at <= now && sample.at >= now - MAX_AGE
    && sample.duration > 0 && sample.duration <= 6 * 60 * 60 * 1000
    && sample.chars >= 0 && sample.chars <= 5000000
    && sample.startup >= 0 && sample.startup <= sample.duration;

export function codingEstimateProfile(assistant = {}) {
    // Explicit allowlist: never serialize assistant credentials or prompt text.
    return JSON.stringify([assistant.provider, assistant.model, assistant.defaultThinkingMode,
        assistant.reasoningEffort, assistant.reasoningMaxTokens, assistant.streaming].map(value => String(value ?? '').slice(0, 200)));
}

function readHistory(storage, now) {
    try {
        const raw = storage?.getItem(STORAGE_KEY) || '[]';
        if (raw.length > 1000000) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter(entry => typeof entry?.profile === 'string' && entry.profile.length < 1500 && Array.isArray(entry.samples))
            .slice(-12).map(entry => ({profile: entry.profile,
                samples: entry.samples.filter(sample => validSample(sample, now)).slice(-40)
                    .map(({kind, repair, at, duration, chars, startup}) => ({kind, repair, at, duration, chars, startup}))})) : [];
    } catch { return []; }
}

export function createCodingEstimator({assistant, storage, now = Date.now()} = {}) {
    const profile = codingEstimateProfile(assistant);
    const history = readHistory(storage, now).find(entry => entry.profile === profile)?.samples || [];
    const session = [];
    let current = null;
    const clearStream = () => {
        if (current) Object.assign(current, {chars: 0, firstAt: null, lastAt: null, points: []});
    };
    return {
        stage(stage, time = Date.now()) {
            if (!stage) { current = null; return; }
            const {index, total, path} = stage;
            if (!Number.isInteger(index) || !Number.isInteger(total) || index < 1 || total < index || typeof path !== 'string') {
                current = null; return;
            }
            if (current?.path === path && current.index === index) {
                current.total = total;
                current.repair ||= !!stage.repair;
                clearStream();
                return;
            }
            current = {index, total, path, kind: kindOf(path), repair: !!stage.repair, startedAt: time};
            clearStream();
        },
        resetAttempt() { clearStream(); },
        chunk(text, time = Date.now()) {
            if (!current || typeof text !== 'string' || !text.length) return;
            current.firstAt ??= time;
            current.lastAt = time;
            current.chars += text.length;
            // One point per second bounds memory and avoids per-token renders.
            const last = current.points.at(-1);
            if (last && time - last.at < 1000) last.chars = current.chars;
            else current.points.push({at: time, chars: current.chars});
            current.points = current.points.filter(point => time - point.at <= 20000).slice(-21);
        },
        complete(path, time = Date.now()) {
            if (!current || current.path !== path) return;
            const sample = {kind: current.kind, repair: current.repair, at: time,
                duration: time - current.startedAt, chars: current.chars,
                startup: (current.firstAt ?? time) - current.startedAt};
            current = null;
            if (!validSample(sample, time)) return;
            session.push(sample);
            if (session.length > 40) session.shift();
            try {
                const entries = readHistory(storage, time);
                const prior = entries.find(entry => entry.profile === profile)?.samples || [];
                storage?.setItem(STORAGE_KEY, JSON.stringify([...entries.filter(entry => entry.profile !== profile),
                    {profile, samples: [...prior, sample].slice(-40)}].slice(-12)));
            } catch { /* Disabled/full storage must never interrupt coding. */ }
        },
        estimate(time = Date.now()) {
            if (!current) return {state: 'unknown', text: 'Finish estimate unavailable until file generation is underway.'};
            const describe = result => ({...result,
                progress: `${current.index - 1} of ${current.total} files complete in this pass`,
            });
            const all = [...history, ...session].filter(sample => validSample(sample, time));
            const matching = all.filter(sample => sample.kind === current.kind && sample.repair === current.repair);
            const selected = (matching.length >= 3 ? matching : all).slice(-20);
            if (selected.length < 2) return describe({state: 'learning', text: 'Estimating remaining time from the first few files…'});
            // Prefer recent, comparable files and give this request extra weight.
            const samples = [...selected, ...session.filter(sample => selected.includes(sample)).slice(-8)];
            const durations = samples.map(sample => sample.duration);
            const median = quantile(durations, .5);
            const lower = Math.min(median * .7, quantile(durations, .2));
            const upper = Math.max(median * 1.6, quantile(durations, .9));
            const elapsed = Math.max(0, time - current.startedAt);
            const first = current.points[0], last = current.points.at(-1);
            const span = first && last ? last.at - first.at : 0;
            const rate = span >= 5000 ? (last.chars - first.chars) / span : 0;
            const sizes = selected.filter(sample => sample.chars > 0).map(sample => sample.chars);
            let currentLow = Math.max(0, lower - elapsed);
            let currentHigh = Math.max(0, upper - elapsed);
            let currentTypical = Math.max(0, median - elapsed);
            let speedAdjustment = 1;
            let basis = 'recent file timings';
            if (current.lastAt !== null && time - current.lastAt > 30000) {
                return describe({state: 'stalled', text: 'Waiting for more response text. Remaining-time estimate is paused.'});
            }
            if (rate > 0 && sizes.length >= 3) {
                const expected = quantile(sizes, .5), large = Math.max(expected * 1.5, quantile(sizes, .9));
                if (current.chars >= large) return describe({state: 'outgrown', text: 'This file is larger than recent responses. Updating the estimate when it completes.'});
                // Buffered bursts have no measured rate. Size predicts only this
                // file, never completion percentage or correctness.
                currentLow = Math.max(0, expected * .7 - current.chars) / rate;
                currentHigh = Math.max(0, large - current.chars) / rate;
                currentTypical = Math.max(0, expected - current.chars) / rate;
                // Blend the live speed with historical total duration rather
                // than assuming the current rate lasts for the entire task.
                const projected = quantile(samples.map(sample => sample.startup), .5) + expected / rate;
                speedAdjustment = Math.max(.5, Math.min(2, .7 + .3 * projected / median));
                basis = 'live response speed and recent file timings';
            } else if (elapsed > upper) {
                return describe({state: 'slow', text: 'This file is taking longer than recent files. Updating the estimate when it completes.'});
            }
            const future = current.total - current.index;
            const lowMs = currentLow + future * lower * speedAdjustment;
            const highMs = Math.max(lowMs, currentHigh + future * upper * speedAdjustment);
            const low = Math.max(1, Math.ceil(lowMs / 60000));
            const high = Math.max(low + 1, Math.ceil(highMs / 60000));
            // Confidence describes consistency of observations, not a promise
            // of completion. Do not derive it from the padded display range.
            const observed = selected.map(sample => sample.duration);
            const spread = quantile(observed, .9) / Math.max(1, quantile(observed, .2));
            const comparable = matching.length >= 3;
            const confidence = comparable && selected.length >= 8 && spread <= 1.5 ? 'High'
                : comparable && selected.length >= 4 && spread <= 2.5 ? 'Medium' : 'Low';
            const reason = spread > 2.5 ? 'Recent file times vary substantially.'
                : !comparable || selected.length < 4 ? 'Only a few comparable files have completed.'
                    : 'Recent comparable file times are reasonably consistent.';
            const details = `Observed range: ${low}–${high} min for remaining files. Based on ${basis} (${selected.length} completed files). ${reason} Validation and repairs may add time.`;
            if (selected.length >= 5 && spread >= 4) return describe({state: 'unpredictable', confidence: 'Low',
                lowMs, highMs, basis, samples: selected.length, details, text: 'Timing is still unpredictable'});
            const typicalMs = Math.max(lowMs, Math.min(highMs, currentTypical + future * median * speedAdjustment));
            const timeText = typicalMs < 60000 ? 'Less than a minute remaining'
                : `About ${Math.round(typicalMs / 60000)} min remaining`;
            return describe({state: 'estimated', lowMs, highMs, typicalMs, confidence, basis, samples: selected.length, details,
                text: `${timeText} · ${confidence} confidence`});
        },
    };
}
