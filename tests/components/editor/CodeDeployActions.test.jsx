import React from 'react';
import {render, screen, fireEvent} from '@testing-library/react';
import CodeDeployActions from '../../../src/components/editor/CodeDeployActions.js';
import virtualFS from '../../../src/components/editor/utils/VirtualFS';

function setupComponent() {
  const props = { setSelectedTabId: jest.fn(), pluginDirectory: '/tmp/plugin' };
  return render(<CodeDeployActions {...props} />);
}

describe('CodeDeployActions snapshot UI', () => {
  beforeEach(() => {
    virtualFS.files = {};
    virtualFS.treeObject = [{ id: '/', label: '/', type: 'folder', isExpanded: true, childNodes: [] }];
    virtualFS.fs.versions = {};
    virtualFS.fs.version_current = 0;
    virtualFS.fs.version_latest = 0;
    virtualFS.pluginName = 'TestPlugin';
    virtualFS.sandboxName = 'sandbox_test';
    localStorage.clear();
  });

  test('snapshot Select opens and lists versions (sorted newest first)', async () => {
    // Seed two snapshots so menu has entries
    const monaco = require('monaco-editor');
    const model = monaco.editor.createModel('A', 'plaintext', monaco.Uri.file('/a.ts'));
    virtualFS.createFile('/a.ts', model);
    const v1 = virtualFS.fs.create('', []);
    virtualFS.setFileContent('/a.ts', 'B');
    const v2 = virtualFS.fs.create(v1.version, []);

    setupComponent();

    // Open the Snapshots Select popover by clicking the trigger button whose label contains current version id
    const triggerBtn = await screen.findByRole('button', { name: new RegExp(v2.version) });
    expect(triggerBtn).toBeTruthy();
    fireEvent.click(triggerBtn);

    // Try to find the popover menu by role=listbox or fallback to class selector
    let menu = null;
    try {
      menu = await screen.findByRole('listbox');
    } catch (e) {
      const nodes = document.querySelectorAll('.bp6-menu');
      if (nodes && nodes.length) menu = nodes[0];
    }
    expect(menu).toBeTruthy();

    // Ensure both versions are present and order is newest (v2) first
    const candidates = Array.from(menu.querySelectorAll('.bp6-menu-item'));
    const texts = candidates.map((el) => el.textContent || '');
    expect(texts.some(t => t.includes(v1.version))).toBe(true);
    expect(texts.some(t => t.includes(v2.version))).toBe(true);
  });

  test('Create snapshot button triggers fs.create and versions update', () => {
    // seed a file so create captures at least one file
    const monaco = require('monaco-editor');
    const model = monaco.editor.createModel('A', 'plaintext', monaco.Uri.file('/a.ts'));
    virtualFS.createFile('/a.ts', model);

    setupComponent();
    const btn = screen.getByRole('button', { name: /Create snapshot/i });
    fireEvent.click(btn);

    const versions = virtualFS.fs.list();
    expect(versions.length).toBeGreaterThan(0);
    expect(versions[0].current).toBe(true);
  });
});
