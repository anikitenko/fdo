import {formatElapsedDuration} from '../../src/utils/presentation/formatElapsedDuration';

test.each([
    [0, '0 seconds', '0s'],
    [999, '0 seconds', '0s'],
    [12000, '12 seconds', '12s'],
    [627000, '10 minutes 27 seconds', '10m 27s'],
    [3600000, '1 hour', '1h'],
    [3661000, '1 hour 1 minute 1 second', '1h 1m 1s'],
    [90061000, '1 day 1 hour 1 minute 1 second', '1d 1h 1m 1s'],
    [-1000, '0 seconds', '0s'],
    [NaN, '0 seconds', '0s'],
])('formats elapsed %s through date-fns for details and compact indicators', (milliseconds, readable, compact) => {
    expect(formatElapsedDuration(milliseconds)).toBe(readable);
    expect(formatElapsedDuration(milliseconds, {compact: true})).toBe(compact);
});
