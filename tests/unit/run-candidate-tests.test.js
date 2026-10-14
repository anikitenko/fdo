import {runCandidateTests} from '../../src/components/editor/utils/runCandidateTests';
import virtualFS from '../../src/components/editor/utils/VirtualFS';
jest.mock('../../src/components/editor/utils/VirtualFS', () => ({__esModule: true, default: {build: {
    setInProgress: jest.fn(), addMessage: jest.fn(), stopProgress: jest.fn(),
}}}));
test('publishes pending status and final test output without applying candidate files', async () => {
    const candidate = {latestContent: {'/test.ts': 'test source'}};
    const run = jest.fn(async data => {
        expect(data).toBe(candidate);
        expect(virtualFS.build.addMessage).toHaveBeenCalledWith(expect.stringContaining('not applied'), false, 'test');
        return {success: false, output: 'AssertionError: wrong result'};
    });
    await runCandidateTests(candidate, run);
    expect(virtualFS.build.addMessage).toHaveBeenCalledWith('AssertionError: wrong result', true, 'test');
    expect(virtualFS.build.stopProgress).toHaveBeenCalled();
});
test('clears running state after a runner exception', async () => {
    await expect(runCandidateTests({}, async () => { throw new Error('disconnected'); })).rejects.toThrow('disconnected');
    expect(virtualFS.build.stopProgress).toHaveBeenCalled();
});
