import React from 'react';
import {render, screen, fireEvent, waitFor, act} from '@testing-library/react';
import CodeDeployActions from '../../../src/components/editor/CodeDeployActions.js';
import virtualFS from '../../../src/components/editor/utils/VirtualFS';

jest.mock('../../../src/components/editor/utils/runTests', () => jest.fn(() => Promise.resolve({ success: true })));
jest.mock('../../../src/components/editor/utils/build', () => jest.fn(async () => ({success: true})));
jest.mock('../../../src/components/AppToaster.jsx', () => ({AppToaster: {show: jest.fn()}}));
const build = require('../../../src/components/editor/utils/build');
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

  test('keeps deployment stages visible until the host finishes', async () => {
    let progress;
    let finish;
    window.electron.plugin.on = {...window.electron.plugin.on, deployProgress: jest.fn(fn => { progress = fn; })};
    window.electron.plugin.off = {...window.electron.plugin.off, deployProgress: jest.fn()};
    window.electron.settings.certificates.getRoot = jest.fn(async () => [{label: 'root'}]);
    jest.spyOn(virtualFS.build, 'getMetadata').mockResolvedValue({name: 'TestPlugin'});
    jest.spyOn(virtualFS.build, 'getEntrypoint').mockReturnValue('dist/index.cjs');
    jest.spyOn(virtualFS.build, 'getContent').mockReturnValue('module.exports = {};');
    window.electron.plugin.deployToMainFromEditor = jest.fn(() => new Promise(resolve => {finish = resolve;}));
    const {unmount} = setupComponent();
    fireEvent.click(screen.getByRole('button', {name: 'Deploy'}));
    await waitFor(() => expect(window.electron.plugin.deployToMainFromEditor).toHaveBeenCalled());
    expect(runTests.mock.invocationCallOrder[0]).toBeLessThan(build.mock.invocationCallOrder[0]);
    const {AppToaster} = require('../../../src/components/AppToaster.jsx');
    expect(AppToaster.show).toHaveBeenCalledWith(expect.objectContaining({timeout: 0}), 'plugin-deployment');
    const {requestId} = window.electron.plugin.deployToMainFromEditor.mock.calls[0][0];
    act(() => progress({requestId: 'other', progress: 99, message: 'Unrelated'}));
    expect(screen.queryByText('Unrelated')).toBeNull();
    act(() => progress({requestId, progress: 70, message: 'Signing plugin…'}));
    expect(screen.getByRole('status').textContent).toContain('Signing plugin…');
    expect(screen.getByRole('button', {name: 'Run Tests'})).toBeDisabled();
    await act(async () => finish({success: true}));
    expect(screen.getByRole('status').textContent).toContain('Deployment complete');
    expect(screen.getByRole('button', {name: 'Deploy'})).not.toBeDisabled();
    unmount();
    expect(window.electron.plugin.off.deployProgress).toHaveBeenCalledWith(progress);
    jest.restoreAllMocks();
  });

  test('shows running tests before compilation starts', async () => {
    let finishTests;
    runTests.mockImplementationOnce(() => new Promise(resolve => {finishTests = resolve;}));
    setupComponent();
    fireEvent.click(screen.getByRole('button', {name: 'Deploy'}));
    expect(screen.getByRole('status').textContent).toContain('Running plugin tests');
    expect(build).not.toHaveBeenCalled();
    const {AppToaster} = require('../../../src/components/AppToaster.jsx');
    await waitFor(() => expect(AppToaster.show).toHaveBeenCalledWith(
      expect.objectContaining({timeout: 0}), 'plugin-deployment'
    ));
    await act(async () => finishTests({success: false, error: 'Failed test'}));
    expect(build).not.toHaveBeenCalled();
    await waitFor(() => expect(AppToaster.show).toHaveBeenCalledWith(
      expect.objectContaining({intent: 'danger', timeout: 5000}), 'plugin-deployment'
    ));
  });

  test('blocks compilation and deployment when tests fail', async () => {
    runTests.mockResolvedValueOnce({success: false, error: 'Assertion failed'});
    window.electron.plugin.deployToMainFromEditor = jest.fn();
    setupComponent();
    fireEvent.click(screen.getByRole('button', {name: 'Deploy'}));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Assertion failed'));
    expect(build).not.toHaveBeenCalled();
    expect(window.electron.plugin.deployToMainFromEditor).not.toHaveBeenCalled();
    expect(screen.getByRole('button', {name: 'Deploy'})).not.toBeDisabled();
  });

  test('stops deployment when compilation fails and releases the button', async () => {
    build.mockResolvedValueOnce({success: false, error: 'Invalid source'});
    window.electron.plugin.deployToMainFromEditor = jest.fn();
    setupComponent();
    fireEvent.click(screen.getByRole('button', {name: 'Deploy'}));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Invalid source'));
    expect(window.electron.plugin.deployToMainFromEditor).not.toHaveBeenCalled();
    expect(screen.getByRole('button', {name: 'Deploy'})).not.toBeDisabled();
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
