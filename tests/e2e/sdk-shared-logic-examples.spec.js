const path = require('node:path');
const fs = require('node:fs');
const {test, expect, _electron: electron} = require('@playwright/test');
const {launchElectronApp, closeElectronApp, dismissBlueprintOverlays} = require('./helpers/electronApp');
const {discoverSdkExampleEntries, resolveSdkExamplesPath, compileSdkExample, deploySdkExample, selectPluginOpen,
  waitForPluginReady, waitForPluginUiRendered, getPluginUiState, removePlugin} = require('./helpers/sdkExamples');

// Release-candidate check against an explicitly selected SDK checkout/package.
// This avoids silently testing the older examples in FDO's pinned npm package.
test('shared examples render and the consumer button calls the provider', async () => {
  test.skip(!process.env.FDO_SDK_EXAMPLES_PATH, 'Set FDO_SDK_EXAMPLES_PATH to the SDK examples under validation.');
  test.setTimeout(120000);
  const entries = discoverSdkExampleEntries(resolveSdkExamplesPath());
  const declaredProviderId = 'website-availability-provider';
  const providerId = process.env.FDO_SHARED_TEST_PROVIDER_ID || declaredProviderId;
  const sdkPackage = process.env.FDO_SHARED_TEST_SDK_PACKAGE;
  const examples = [
    {file: '19-shared-logic-provider.ts', id: providerId,
      marker: 'This plugin exports website-availability v1.',
      grants: ['plugins.shared.provide', 'system.network', 'system.network.https', 'system.network.scope.public-web-secure']},
    {file: '20-shared-logic-consumer.ts', id: 'website-check-consumer',
      marker: 'The checkWebsite backend handler',
      grants: sdkPackage ? [] : ['plugins.shared.use', `plugins.shared.call.${providerId}.website-availability.v1`]},
  ];
  const app = await launchElectronApp(electron, {isolatedUserDataDir: true});
  const window = await app.firstWindow();
  const cspErrors = [];
  window.on('console', message => {
    if (/violates.*Content Security Policy|Refused to connect|Connecting to.*connect-src/i.test(message.text())) cspErrors.push(message.text());
  });
  try {
    for (const example of examples) {
      const entry = entries.find(item => item.relativePath === example.file);
      expect(entry, `Missing SDK example ${example.file} in ${path.resolve(resolveSdkExamplesPath())}`).toBeTruthy();
      let compiledContent = await compileSdkExample(entry);
      if (example.id === providerId && process.env.FDO_SHARED_REAL_NETWORK !== '1') {
        // Stub only the provider's external website. The UI bridge, two real
        // workers, service registration, permissions and shared call stay real.
        compiledContent = `globalThis.fetch = async (url, options) => {
          if (String(url) !== 'https://example.com/' || options.method !== 'HEAD') throw new Error('Unexpected website check');
          return {ok:true,status:200};
        };\n` + compiledContent;
      }
      await deploySdkExample(window, entry, {pluginName: example.id, capabilities: example.grants, compiledContent, deferActivation:!!sdkPackage});
      if (sdkPackage) {
        // Install the release-candidate SDK only inside isolated test plugins,
        // then sign their full contents again. Never change FDO's dependency.
        await window.evaluate(id => window.electron.plugin.deactivate(id), example.id);
        const {plugin} = await window.evaluate(id => window.electron.plugin.get(id), example.id);
        const sdkHome = path.join(plugin.home,'node_modules','@anikitenko','fdo-sdk');
        fs.mkdirSync(sdkHome,{recursive:true});
        fs.cpSync(path.join(sdkPackage,'dist'),path.join(sdkHome,'dist'),{recursive:true});
        fs.copyFileSync(path.join(sdkPackage,'package.json'),path.join(sdkHome,'package.json'));
        const signed = await window.evaluate(id => window.electron.plugin.sign(id,'root'),example.id);
        expect(signed.success).toBe(true);
        const started = await window.evaluate(id => window.electron.plugin.activate(id),example.id);
        expect(started.success,started.error).toBe(true);
        await waitForPluginReady(window,example.id);
      }
      await selectPluginOpen(window, example.id);
      await waitForPluginUiRendered(window, example.id);
      expect((await getPluginUiState(window, example.id)).iframeText).toContain(example.marker);
    }
    const consumer = window.frameLocator('iframe[data-plugin-id="website-check-consumer"]');
    if (sdkPackage) {
      const requestButton = consumer.getByRole('button',{name:'Request shared-service access'});
      const grants = async () => (await window.evaluate(id => window.electron.plugin.get(id),'website-check-consumer')).plugin.capabilities;
      const openReview = async () => {
        await dismissBlueprintOverlays(window);
        await window.getByRole('button',{name:/Plugins Activated:/i}).click();
        await window.getByRole('button',{name:'Manage plugins'}).click();
        await window.getByRole('tab').filter({hasText:'20-shared-logic-consumer.ts'}).click();
      };
      const closeReview = async () => {
        await window.locator('.bp6-dialog-header .bp6-dialog-close-button').click();
        await expect(window.getByTestId('shared-logic-access-review')).toHaveCount(0);
      };
      await requestButton.click();
      await expect(consumer.getByRole('status')).toContainText('Access request created');
      expect(await grants()).toEqual([]);
      await openReview();
      await window.getByRole('button',{name:'Dismiss shared-service request'}).click();
      await expect(window.getByRole('button',{name:'Dismiss shared-service request'})).toHaveCount(0);
      expect(await grants()).toEqual([]);
      // A direct user action adds access without creating another pending request.
      await window.getByRole('button',{name:'Show details',exact:true}).click();
      await window.getByRole('button',{name:'Add shared-service access',exact:true}).first().click();
      const access = window.getByTestId('shared-logic-access-review');
      await expect(access.getByLabel('Installed shared service')).toHaveValue(`${providerId}/website-availability/v1`);
      await expect(access.getByLabel('Consumer provider ID')).toHaveValue(declaredProviderId);
      await expect(access.getByLabel('Installed shared service')).toBeInViewport({ratio:1});
      expect(await grants()).toEqual([]);
      await window.screenshot({animations:'disabled',path:test.info().outputPath('shared-access-binding.png')});
      await access.getByRole('button',{name:'Add shared-service access',exact:true}).click();
      const expectedGrants = [...new Set(['plugins.shared.use',`plugins.shared.call.${declaredProviderId}.website-availability.v1`,`plugins.shared.call.${providerId}.website-availability.v1`])];
      await expect.poll(grants).toEqual(expectedGrants);
      const saved = (await window.evaluate(() => window.electron.plugin.get('website-check-consumer'))).plugin;
      expect(saved.sharedLogicRequests).toEqual([]);
      if (providerId !== declaredProviderId) expect(saved.sharedLogicBindings).toContainEqual({providerId:declaredProviderId,name:'website-availability',version:1,installedProviderId:providerId});
      await closeReview();
      await waitForPluginReady(window,'website-check-consumer');
      await selectPluginOpen(window,'website-check-consumer');
      await waitForPluginUiRendered(window,'website-check-consumer');
    }
    const policy = await consumer.locator('head meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
    expect(policy).not.toMatch(/connect-src [^;]*https:/);
    // Development builds publish maps; emulate DevTools loading one in the
    // inspected iframe's context, independently of the guarded plugin fetch API.
    const maps = policy.match(/static:\/\/host\/[\w.-]+\.js\.map/g) || [];
    if (maps.length) {
      const session = await window.context().newCDPSession(window);
      try {
        const {root} = await session.send('DOM.getDocument');
        const {nodeId} = await session.send('DOM.querySelector', {nodeId:root.nodeId, selector:'iframe[data-plugin-id="website-check-consumer"]'});
        const {node} = await session.send('DOM.describeNode', {nodeId});
        const {resource} = await session.send('Network.loadNetworkResource', {
          frameId:node.frameId, url:maps.find(url => url.includes('plugin_host.')) || maps[0],
          options:{disableCache:true, includeCredentials:false},
        });
        if (resource.stream) await session.send('IO.close', {handle:resource.stream});
        expect(resource.success, JSON.stringify(resource)).toBe(true);
      } finally { await session.detach(); }
    }
    let repairedRegistryFile;
    if (sdkPackage && providerId !== declaredProviderId) {
      // Reproduce old approval records: both exact grants exist, but no binding.
      // Only the isolated test profile is changed here.
      const profile = await app.evaluate(({app}) => app.getPath('userData'));
      repairedRegistryFile = path.join(profile, 'plugins.json');
      const legacy = JSON.parse(fs.readFileSync(repairedRegistryFile, 'utf8'));
      legacy.plugins.find(plugin => plugin.id === 'website-check-consumer').sharedLogicBindings = [];
      fs.writeFileSync(repairedRegistryFile, JSON.stringify(legacy));
    }
    const button = consumer.getByRole('button', {name: 'Check website', exact: true});
    const result = consumer.getByRole('status');
    await button.click();
    await expect(result).toHaveText('Available — HTTP 200 (checked by the shared provider).', {timeout:15000});
    if (repairedRegistryFile) {
      const repaired = JSON.parse(fs.readFileSync(repairedRegistryFile,'utf8')).plugins.find(plugin => plugin.id === 'website-check-consumer');
      expect(repaired.sharedLogicBindings).toContainEqual({providerId:declaredProviderId,name:'website-availability',version:1,installedProviderId:providerId});
    }

    expect(cspErrors).toEqual([]);
    await expect(button).toBeEnabled();

    await consumer.getByLabel('HTTPS website URL').fill('http://example.com');
    await button.click();
    await expect(result).toHaveText('Enter an HTTPS URL without embedded credentials.');

    await window.evaluate(id => window.electron.plugin.deactivate(id), providerId);
    await consumer.getByLabel('HTTPS website URL').fill('https://example.com');
    await button.click();
    await expect(result).toContainText('The shared provider is unavailable.');
    await expect(button).toBeEnabled();
    await expect.poll(async () => {
      const notifications = await window.evaluate(() => window.electron.notifications.get());
      return JSON.stringify(notifications);
    }).toContain('Shared provider is not running');
  } finally {
    for (const example of examples.slice().reverse()) await removePlugin(window, example.id).catch(() => {});
    await closeElectronApp(app);
  }
});
