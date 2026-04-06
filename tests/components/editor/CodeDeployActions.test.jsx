import React from 'react';
import {render, screen, fireEvent} from '@testing-library/react';
import CodeDeployActions from '../../../src/components/editor/CodeDeployActions.js';
import virtualFS from '../../../src/components/editor/utils/VirtualFS';

jest.mock('../../../src/components/editor/utils/runTests', () => jest.fn(() => Promise.resolve({ success: true })));
const runTests = require('../../../src/components/editor/utils/runTests');

function setupComponent() {
  const props = { setSelectedTabId: jest.fn(), currentSelectedTabId: 'output', pluginDirectory: '/tmp/plugin' };
  return render(<CodeDeployActions {...props} />);
}

describe('CodeDeployActions snapshot UI', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    virtualFS.files = {};
    virtualFS.treeObject = [{ id: '/', label: '/', type: 'folder', isExpanded: true, childNodes: [] }];
    virtualFS.fs.versions = {};
    virtualFS.fs.version_current = 0;
    virtualFS.fs.version_latest = 0;
    virtualFS.pluginName = 'TestPlugin';
    virtualFS.sandboxName = 'sandbox_test';
    localStorage.clear();
  });

  test('renders snapshot section with timeline entry point', async () => {
    setupComponent();

    expect(screen.getByRole('button', { name: /Open Snapshot Timeline/i })).toBeTruthy();
  });

  test('renders action buttons for tests, compile, deploy, and save', () => {
    setupComponent();
    expect(screen.getByRole('button', { name: /Run Tests/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Compile/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Deploy/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Save & Close/i })).toBeTruthy();
  });

  test('Run Tests button switches to output and invokes bundled test runner flow', async () => {
    const setSelectedTabId = jest.fn();
    render(<CodeDeployActions setSelectedTabId={setSelectedTabId} currentSelectedTabId="output" pluginDirectory="/tmp/plugin" />);

    fireEvent.click(screen.getByRole('button', { name: /Run Tests/i }));

    expect(setSelectedTabId).toHaveBeenCalledWith('tests');
    expect(runTests).toHaveBeenCalled();
  });

  test('Run Tests keeps the AI Coding Agent tab visible when already selected', async () => {
    const setSelectedTabId = jest.fn();
    render(<CodeDeployActions setSelectedTabId={setSelectedTabId} currentSelectedTabId="ai-agent" pluginDirectory="/tmp/plugin" />);

    fireEvent.click(screen.getByRole('button', { name: /Run Tests/i }));

    expect(setSelectedTabId).not.toHaveBeenCalled();
    expect(runTests).toHaveBeenCalled();
  });
});
