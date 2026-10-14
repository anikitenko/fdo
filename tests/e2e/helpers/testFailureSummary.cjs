function excerpt(text, limit) {
  if (text.length <= limit) return text;
  const marker = '\n[large assertion payload omitted]\n';
  const room = Math.max(0, limit - marker.length);
  return text.slice(0, Math.ceil(room * .6)) + marker + text.slice(-Math.floor(room * .4));
}

// Node's spec reporter can print a whole rendered page twice for one failed
// assertion. Allocate space per failure instead of truncating the entire log
// before the second test's diagnostic. Full output remains in the artifact.
function summarizeTestFailures(output, limit = 12000, files = {}) {
  const clean = String(output || '').replace(/\x1b\[[0-9;]*m/g, '');
  const blocks = clean.split(/\n(?=test at )/);
  if (blocks.length < 2) return excerpt(clean, limit);
  const failures = blocks.slice(1);
  const kept = failures.slice(0, 40);
  const header = `Failed test diagnostics: ${failures.length}.${failures.length > kept.length ? ` Showing ${kept.length}; full output is retained in the result artifact.` : ''}\n`;
  const budget = Math.floor((limit - header.length - kept.length * 2) / kept.length);
  return header + kept.map(block => {
    const location = block.match(/^test at (.+?):\d+:\d+/);
    if (location) {
      const stem = location[1].replace(/^\//, '').replace(/\.[cm]?[jt]sx?$/, '');
      const matches = Object.keys(files).filter(file => file.replace(/^\//, '').replace(/\.[cm]?[jt]sx?$/, '') === stem);
      if (matches.length === 1) block = block.replace(location[0], `test in ${matches[0]} (compiled location: ${location[0].slice(8)})`);
    }
    const lines = block.split('\n')
      .filter(line => !/^\s+at /.test(line))
      .map(line => excerpt(line, 300));
    return excerpt(lines.join('\n').trim(), budget);
  }).join('\n\n');
}

module.exports = {summarizeTestFailures};
