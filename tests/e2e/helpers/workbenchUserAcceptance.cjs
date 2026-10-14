// Evaluate rendered product behavior, never source selectors or SDK call shapes.
async function exerciseWorkbench(frame, expect, capture) {
  const visible = locator => locator.filter({visible: true});
  const control = name => visible(frame.getByRole('button', {name}).or(frame.getByRole('link', {name})));
  const click = async name => { await expect(control(name).first()).toBeVisible(); await control(name).first().click(); };
  const input = name => visible(frame.getByRole('textbox', {name})).and(frame.locator('input:not([readonly]), textarea:not([readonly]), [contenteditable="true"]')).first();
  const output = async () => {
    const values = await visible(frame.locator('textarea[readonly], input[readonly]')).evaluateAll(nodes => nodes.map(node => node.value));
    return [await frame.locator('body').innerText(), ...values].join('\n');
  };
  const result = async pattern => { await expect.poll(output).toMatch(pattern); };
  const back = () => click(/back|dashboard|home/i);
  const operation = async (name, action) => {
    const select = visible(frame.getByRole('combobox')).first();
    if (await select.count()) {
      const options = await select.locator('option').evaluateAll(nodes => nodes.map(node => ({label: node.label, value: node.value})));
      const option = options.find(option => name.test(option.label));
      expect(option, `No understandable operation matching ${name}`).toBeTruthy();
      await select.selectOption(option.value);
      await click(action);
    } else await click(name);
  };
  await capture('dashboard');
  await click(/json formatter|format json/i);
  await input(/json|input/i).fill('{"probe":7}');
  await click(/format|run/i);
  await result(/\{\s*\n\s*"probe"\s*:\s*7/);
  await capture('formatter');
  await input(/json|input/i).fill('{broken');
  await click(/format|run/i);
  await result(/invalid|error|unexpected|malformed/i);
  await back();

  await click(/text.*content|text tools|text transform/i);
  await input(/text|input|content/i).fill('hello world');
  await operation(/upper/i, /run|convert|transform|apply/i);
  await result(/HELLO WORLD/);
  await result(/(?:words?(?:\s+count)?\s*:?\s*2|2\s*words?)/i);
  await operation(/lower/i, /run|convert|transform|apply/i);
  await result(/hello world/);
  await operation(/title/i, /run|convert|transform|apply/i);
  await result(/Hello World/);
  await capture('text-content');
  await back();

  await click(/development.*data|data tools|url encod/i);
  await input(/url|input|data|text/i).fill('hello world&x=1');
  await operation(/encod/i, /run|convert|apply|encode/i);
  await result(/hello%20world%26x%3D1/i);
  await input(/url|input|data|text/i).fill('hello%20world%26x%3D1');
  await operation(/decod/i, /run|convert|apply|decode/i);
  await result(/hello world&x=1/);
  await back();

  await click(/web.*seo|html.*analy|seo/i);
  await input(/html|input/i).fill('<title>Acceptance Probe</title><meta name="description" content="Local page"><h1>Hello</h1><a href="/">Home</a><img src="x">');
  await click(/analy|inspect|run/i);
  await result(/Acceptance Probe/);
  await result(/alt|image description/i);
  await capture('web-seo');
  await back();

  await click(/images?.*media|image.*info|image.*inspect/i);
  await input(/svg|image|data|input/i).fill('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"></svg>');
  await click(/inspect|analy|run/i);
  await result(/120/);
  await result(/80/);
  await capture('images-media');
  await back();

  await click(/social.*platform|social.*preview|social/i);
  await input(/title/i).fill('Local preview probe');
  await input(/description/i).fill('No remote request needed');
  await input(/url|link/i).fill('https://example.invalid/local-preview');
  await click(/preview|generate|run/i);
  await result(/Local preview probe/);
  await result(/No remote request needed/);
  await capture('social-platforms');
  await back();

  await click(/library|all tools/i);
  const search = visible(frame.getByRole('searchbox').or(frame.getByRole('textbox', {name: /search/i}))).first();
  await search.fill('no-matching-tool-74821');
  await expect(control(/json formatter|format json/i)).toHaveCount(0);
  await search.fill('JSON');
  await expect(control(/json formatter|format json/i).first()).toBeVisible();
  await capture('library');
  await click(/json formatter|format json/i);
  await expect(input(/json|input/i)).toBeVisible();
  // Exercise an actual favourite action, then find it again in personal space.
  await click(/favourite|favorite|save tool/i);
  await back();
  await click(/personal space|my space|saved tools|favourites|favorites/i);
  await result(/json formatter/i);
  await capture('personal-space');
  await click(/close|back|dashboard|home/i);
  await click(/personal space|my space|saved tools|favourites|favorites/i);
  await click(/json formatter|format json/i);
  await expect(input(/json|input/i)).toBeVisible();
  await back();
}

module.exports = {exerciseWorkbench};
