// Simple runtime feature flag for Snapshot UI
// Priority order:
// 1) explicit window.__SNAPSHOTS_ENABLED boolean
// 2) localStorage key 'snapshots.enabled' === 'true'
// 3) environment variable injected at build time (if DefinePlugin is used): process.env.FDO_SNAPSHOTS === 'on'

export function isSnapshotsEnabled() {
  try {
    if (typeof window !== 'undefined' && typeof window.__SNAPSHOTS_ENABLED === 'boolean') {
      return window.__SNAPSHOTS_ENABLED === true;
    }
  } catch (_) {}

  try {
    if (typeof localStorage !== 'undefined') {
      const ls = localStorage.getItem('snapshots.enabled');
      if (ls === 'true') return true;
      if (ls === 'false') return false;
    }
  } catch (_) {}

  try {
    if (typeof process !== 'undefined' && process.env && typeof process.env.FDO_SNAPSHOTS === 'string') {
      return process.env.FDO_SNAPSHOTS === 'on';
    }
  } catch (_) {}

  return false;
}
