// React Testing Library and BlueprintJS helpers setup
try {
  // Optional: custom matchers, skip if not installed in CI
  // eslint-disable-next-line import/no-extraneous-dependencies
  require('@testing-library/jest-dom');
} catch (e) {
  // Silently continue if jest-dom is not available
}
// Provider integration tests use Node's native fetch and Web Streams.
// Only install DOM helpers for suites running in jsdom.
if (typeof document !== 'undefined' && document.body) {
  const { configure } = require('@testing-library/react');

  configure({ asyncUtilTimeout: 3000 });

  // Ensure Blueprint portal root exists when needed
  beforeAll(() => {
    const portal = document.createElement('div');
    portal.setAttribute('id', 'bp6-portal-root');
    document.body.appendChild(portal);
  });
}
