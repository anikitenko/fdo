const {acquireElectronPowerGuard} = require('../e2e/helpers/electronPowerGuard.cjs');

test('owns and releases only its native power assertion, once', async () => {
    const powerSaveBlocker = {start: jest.fn().mockReturnValue(7), stop: jest.fn()};
    const app = {evaluate: jest.fn((fn, arg) => fn({powerSaveBlocker}, arg))};
    const guard = await acquireElectronPowerGuard(app);
    expect(guard.id).toBe(7);
    expect(powerSaveBlocker.start).toHaveBeenCalledWith('prevent-display-sleep');
    await guard.release();
    await guard.release();
    expect(powerSaveBlocker.stop).toHaveBeenCalledTimes(1);
    expect(powerSaveBlocker.stop).toHaveBeenCalledWith(7);
});

test('does not conceal failure to acquire the assertion', async () => {
    const app = {evaluate: jest.fn().mockRejectedValue(new Error('Connection closed'))};
    await expect(acquireElectronPowerGuard(app)).rejects.toThrow('Connection closed');
});

test('lost automation cannot hang guard release and process cleanup', async () => {
    jest.useFakeTimers();
    try {
        const app = {evaluate: jest.fn().mockResolvedValueOnce(7).mockImplementationOnce(() => new Promise(() => {}))};
        const guard = await acquireElectronPowerGuard(app);
        const release = guard.release();
        await jest.advanceTimersByTimeAsync(2000);
        await expect(release).resolves.toBeUndefined();
    } finally { jest.useRealTimers(); }
});
