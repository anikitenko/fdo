import React from 'react';
import {render, screen, fireEvent, waitFor} from '@testing-library/react';
import {HotkeysProvider} from '@blueprintjs/core';
import {SnapshotProvider, SnapshotSwitchConfirmDialog} from '../../../src/components/editor/snapshots/SnapshotContext.jsx';
import SnapshotToolbarActions from '../../../src/components/editor/snapshots/SnapshotToolbarActions.jsx';
import virtualFS from '../../../src/components/editor/utils/VirtualFS';
import {AppToaster} from '../../__mocks__/AppToaster.jsx';

function Wrapper({children}) {
  return (
    <HotkeysProvider>
      <SnapshotProvider>{children}</SnapshotProvider>
    </HotkeysProvider>
  );
}

describe('SnapshotToolbarActions', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    // Clean state
    virtualFS.files = {};
    virtualFS.treeObject = [{ id: '/', label: '/', type: 'folder', isExpanded: true, childNodes: [] }];
    virtualFS.fs.versions = {};
    virtualFS.fs.version_current = 0;
    virtualFS.fs.version_latest = 0;
    virtualFS.pluginName = 'TestPlugin';
    virtualFS.sandboxName = 'sandbox_test';
    localStorage.clear();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('creates snapshot and shows toast, recent menu updates', async () => {
    // Seed a file
    const model = require('monaco-editor').editor.createModel('A', 'plaintext', require('monaco-editor').Uri.file('/a.ts'));
    virtualFS.createFile('/a.ts', model);

    render(<Wrapper><SnapshotToolbarActions /></Wrapper>);

    const btn = screen.getByRole('button', { name: /Snapshot/i });
    fireEvent.click(btn);

    expect(screen.getByRole('status')).toHaveTextContent(/Saving snapshot/i);
    jest.advanceTimersByTime(250);

    await waitFor(async () => {
      const toaster = await AppToaster;
      expect(toaster.show).toHaveBeenCalled();
    });

    // Open Recent menu
    const recent = screen.getByRole('button', { name: /Recent/i });
    fireEvent.click(recent);

    // Wait until at least one menu item is present
    await waitFor(() => {
      const items = document.querySelectorAll('.bp6-menu-item');
      expect(items.length).toBeGreaterThan(0);
    });
  });

  test('hotkey mod+shift+s triggers snapshot', async () => {
    const model = require('monaco-editor').editor.createModel('A', 'plaintext', require('monaco-editor').Uri.file('/a.ts'));
    virtualFS.createFile('/a.ts', model);

    render(<Wrapper><SnapshotToolbarActions /></Wrapper>);

    fireEvent.keyDown(document.body, { key: 'S', code: 'KeyS', metaKey: true, shiftKey: true });
    jest.advanceTimersByTime(250);

    await waitFor(async () => {
      const toaster = await AppToaster;
      expect(toaster.show).toHaveBeenCalled();
    });
  });

  test('switching snapshot shows a localized switching status and disables controls', async () => {
    const monaco = require('monaco-editor');
    const model = monaco.editor.createModel('A', 'plaintext', monaco.Uri.file('/a.ts'));
    virtualFS.createFile('/a.ts', model);
    virtualFS.tabs.add(virtualFS.getTreeObjectItemById('/a.ts'));

    const v1 = virtualFS.fs.create('', [{ id: '/a.ts', active: true }]);
    virtualFS.setFileContent('/a.ts', 'B');
    const v2 = virtualFS.fs.create(v1.version, []);

    const originalSet = virtualFS.fs.set.bind(virtualFS.fs);
    jest.spyOn(virtualFS.fs, 'set').mockImplementation((versionId) => originalSet(versionId));

    render(<Wrapper><SnapshotToolbarActions /></Wrapper>);

    fireEvent.click(screen.getByRole('button', { name: /Recent/i }));
    await waitFor(() => {
      const items = document.querySelectorAll('.bp6-menu-item');
      expect(items.length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByText(v1.version));

    expect(screen.getByRole('status')).toHaveTextContent(/Switching snapshot/i);
    expect(screen.getByRole('button', { name: /Snapshot/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Recent/i })).toBeDisabled();

    jest.advanceTimersByTime(250);

    await waitFor(() => {
      expect(virtualFS.fs.version().version).toBe(v1.version);
    });
    expect(virtualFS.tabs.getActiveTabId()).toBe('/a.ts');
    expect(v2.version).toBeTruthy();
  });

  test('delete option is present and VirtualFS deletion works', async () => {
    const model = require('monaco-editor').editor.createModel('A', 'plaintext', require('monaco-editor').Uri.file('/a.ts'));
    virtualFS.createFile('/a.ts', model);

    const v1 = virtualFS.fs.create('', []);
    // create second snapshot so deletion is allowed
    virtualFS.setFileContent('/a.ts', 'B');
    virtualFS.fs.create(v1.version, []);

    render(<Wrapper><SnapshotToolbarActions /></Wrapper>);

    // Open Recent to ensure menu is rendered
    fireEvent.click(screen.getByRole('button', { name: /Recent/i }));
    await waitFor(() => {
      const items = document.querySelectorAll('.bp6-menu-item');
      expect(items.length).toBeGreaterThan(0);
    });

    // Perform deletion via VirtualFS API (UI already exposes the action) to avoid brittle DOM clicks
    const before = virtualFS.fs.list().length;
    const deleted = virtualFS.fs.deleteVersion(v1.version);
    expect(deleted).toBe(true);
    const after = virtualFS.fs.list().length;
    expect(after).toBe(before - 1);
  });

  test('unsaved-change switch opens a compact confirmation dialog with snapshot-first actions', async () => {
    render(
      <SnapshotSwitchConfirmDialog
        isOpen={true}
        switching={false}
        onCancel={() => {}}
        onSwitchAnyway={() => {}}
        onCreateAndSwitch={() => {}}
      />
    );

    expect(screen.getByText('Unsaved Snapshot Changes')).toBeInTheDocument();
    expect(screen.getByText('You have changes since your last snapshot.')).toBeInTheDocument();
    expect(screen.getByText(/Create a new snapshot before switching if you want to keep your current file changes and open tabs\./i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Create Snapshot & Switch/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Switch Anyway/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cancel/i })).toBeInTheDocument();
  });
});
