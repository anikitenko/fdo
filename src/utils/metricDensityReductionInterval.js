export function metricDensityReductionInterval(durationMs) {
    let interval = 1000; // Default: return all data points
    if (durationMs > 15 * 60 * 1000) interval = 2000; // > 15 mins → every 2 sec
    if (durationMs > 30 * 60 * 1000) interval = 5000; // > 30 mins → every 5 sec
    if (durationMs > 60 * 60 * 1000) interval = 30000; // > 1 hour → every 30 sec
    if (durationMs > 2 * 60 * 60 * 1000) interval = 60000; // > 2 hours → every 1 min
    if (durationMs > 6 * 60 * 60 * 1000) interval = 300000; // > 6 hours → every 5 min
    return interval
}