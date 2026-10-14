import {formatDuration, intervalToDuration} from 'date-fns';

const units = {xYears: 'y', xMonths: 'mo', xDays: 'd', xHours: 'h', xMinutes: 'm', xSeconds: 's'};
const compactLocale = {formatDistance: (token, count) => `${count}${units[token]}`};

export function formatElapsedDuration(elapsedMs = 0, {compact = false} = {}) {
    const value = Number(elapsedMs);
    const milliseconds = Number.isFinite(value) ? Math.max(0, Math.floor(value / 1000) * 1000) : 0;
    const duration = milliseconds ? intervalToDuration({start: 0, end: milliseconds}) : {seconds: 0};
    return formatDuration(duration, {zero: milliseconds === 0,
        ...(compact ? {locale: compactLocale} : {})});
}
