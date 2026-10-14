const {test, expect, _electron: electron} = require('@playwright/test');
const {launchElectronApp, closeElectronApp} = require('./helpers/electronApp');
const {exerciseWorkbench} = require('./helpers/workbenchUserAcceptance.cjs');

// Independent small products: no SDK imports, test roles, prescribed class
// names or module structure. Exercise the acceptance harness itself offline.
async function mountProduct(page, {links = false, brokenJson = false} = {}) {
  await page.setContent('<main></main>');
  await page.evaluate(({links, brokenJson}) => {
    const main = document.querySelector('main');
    let favourite = false;
    const control = (label, action) => {
      const node = document.createElement(links ? 'a' : 'button');
      if (links) { node.href = '#'; node.setAttribute('role', 'button'); }
      node.textContent = label;
      node.onclick = event => {event.preventDefault(); action();};
      main.append(node);
      return node;
    };
    const input = label => {
      const wrapper = document.createElement('label');
      wrapper.textContent = label;
      const field = document.createElement('textarea');
      wrapper.append(field); main.append(wrapper); return field;
    };
    const output = () => {const node = document.createElement('output'); node.style.whiteSpace = 'pre-wrap'; main.append(node); return node;};
    const open = title => {main.replaceChildren(); const h = document.createElement('h1'); h.textContent = title; main.append(h); control('Back to dashboard', dashboard);};
    function json() {
      open('JSON Formatter'); const field = input('JSON input'); const result = output();
      control('Format JSON', () => {try {result.textContent = JSON.stringify(JSON.parse(field.value), null, 4);} catch {result.textContent = brokenJson ? 'Ready' : 'Invalid JSON';}});
      control('Favourite tool', () => {favourite = true;});
    }
    function text() {
      open('Text tools'); const field = input('Text input'); const result = output();
      control('Uppercase', () => {result.textContent = `${field.value.toUpperCase()} — Words: ${field.value.trim().split(/\s+/).length}`;});
      control('Lowercase', () => {result.textContent = field.value.toLowerCase();});
      control('Title case', () => {result.textContent = field.value.replace(/\b\w/g, value => value.toUpperCase());});
    }
    function data() {
      open('URL tools'); const field = input('URL input'); const result = output();
      const select = document.createElement('select'); select.setAttribute('aria-label', 'Operation');
      select.add(new Option('Encode URL', 'opaque-a')); select.add(new Option('Decode URL', 'opaque-b')); main.append(select);
      control('Run', () => {result.textContent = select.value === 'opaque-a' ? encodeURIComponent(field.value) : decodeURIComponent(field.value);});
    }
    function seo() {
      open('HTML analysis'); const field = input('HTML input'); const result = output();
      control('Analyze', () => {const doc = new DOMParser().parseFromString(field.value, 'text/html'); result.textContent = `${doc.title}; Missing alt: ${doc.querySelectorAll('img:not([alt])').length}`;});
    }
    function images() {
      open('Image information'); const field = input('SVG input'); const result = output();
      control('Inspect', () => {const svg = new DOMParser().parseFromString(field.value, 'image/svg+xml').documentElement; result.textContent = `${svg.getAttribute('width')} × ${svg.getAttribute('height')}`;});
    }
    function social() {
      open('Social preview'); const title = input('Title'); const description = input('Description'); const url = input('URL'); const result = output();
      control('Generate preview', () => {result.textContent = `${title.value} ${description.value} ${url.value}`;});
    }
    function library() {
      open('Tool library'); const field = input('Search tools'); const entry = control('JSON Formatter', json);
      field.oninput = () => {entry.hidden = !'json formatter'.includes(field.value.toLowerCase());};
    }
    function space() {open('Personal space'); if (favourite) control('JSON Formatter', json); control('Close', dashboard);}
    function dashboard() {
      main.replaceChildren();
      control('JSON Formatter', json); control(links ? 'Text tools' : 'Text & Content', text);
      control('Development & Data', data); control('Web & SEO', seo); control('Images & Media', images);
      control('Social & Platforms', social); control('Tool library', library); control('Personal space', space);
    }
    dashboard();
  }, {links, brokenJson});
}
for (const links of [false, true]) {
  test(`accepts functional accessible UI without prescribed selectors (links=${links})`, async () => {
    const app = await launchElectronApp(electron, {isolatedUserDataDir: true});
    try {
      const page = await app.firstWindow();
      await mountProduct(page, {links});
      const captures = [];
      await exerciseWorkbench(page, expect, async name => captures.push(name));
      expect(captures).toEqual(['dashboard', 'formatter', 'text-content', 'web-seo', 'images-media', 'social-platforms', 'library', 'personal-space']);
    } finally {await closeElectronApp(app);}
  });
}
test('rejects a decorative formatter that never shows invalid-input feedback', async () => {
  const app = await launchElectronApp(electron, {isolatedUserDataDir: true});
  try {
    const page = await app.firstWindow();
    await mountProduct(page, {brokenJson: true});
    const captures = [];
    await expect(exerciseWorkbench(page, expect.configure({timeout: 300}), async name => captures.push(name))).rejects.toThrow();
    expect(captures).toEqual(['dashboard', 'formatter']);
  } finally {await closeElectronApp(app);}
});
