import {isAiCodingTransientError} from '../../src/utils/ai/assistant/aiCodingTransientRecovery';
import {cliCodingResponseDeadline} from '../../src/utils/ai/generation/cliCodingResponseDeadline';
beforeEach(() => jest.useFakeTimers());
afterEach(() => {jest.clearAllTimers(); jest.useRealTimers();});
const setup = (options, timeout = 90000) => {
    const child = {kill: jest.fn()}; const reject = jest.fn();
    const deadline = cliCodingResponseDeadline({provider: 'codex-cli', firstResponseTimeoutMs: timeout}, child, reject, options);
    return {child, reject, deadline};
};
test('MCP completion resumes the full configured idle allowance', async () => {
    const {child, reject, deadline} = setup();
    deadline.content(); jest.advanceTimersByTime(20000); deadline.toolStarted('call-1');
    jest.advanceTimersByTime(60000); expect(child.kill).not.toHaveBeenCalled();
    deadline.toolCompleted('call-1'); jest.advanceTimersByTime(89000); expect(child.kill).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1001); await Promise.resolve();
    expect(child.kill).toHaveBeenCalledTimes(1); expect(reject).toHaveBeenCalledTimes(1);
    expect(reject.mock.calls[0][0].message).toContain('stopped sending response events for 90 seconds');
    expect(reject.mock.calls[0][0].code).toBe('mcp_request_timeout');
    expect(isAiCodingTransientError(reject.mock.calls[0][0])).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
});
test('each parallel tool retains its original bound; duplicate starts do not extend it', () => {
    const {child, reject, deadline} = setup(); deadline.content(); deadline.toolStarted('one');
    jest.advanceTimersByTime(20000); deadline.toolStarted('two'); deadline.toolStarted('one');
    jest.advanceTimersByTime(30000); deadline.toolCompleted('two');
    jest.advanceTimersByTime(25001);
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(reject.mock.calls[0][0]).toMatchObject({code: 'mcp_tool_timeout'});
    expect(isAiCodingTransientError(reject.mock.calls[0][0])).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
});
test('completing one concurrent MCP call does not resume idle checks while another is running', () => {
    const {child, deadline} = setup(); deadline.content(); deadline.toolStarted('one'); deadline.toolStarted('two');
    jest.advanceTimersByTime(10000); deadline.toolCompleted('one');
    jest.advanceTimersByTime(50000); expect(child.kill).not.toHaveBeenCalled();
    deadline.toolCompleted('two'); deadline.content(); deadline.clear();
    jest.advanceTimersByTime(300000); expect(child.kill).not.toHaveBeenCalled(); expect(jest.getTimerCount()).toBe(0);
});
test('active MCP work cannot exceed the total completion deadline', async () => {
    const {child, reject, deadline} = setup({toolTimeoutMs: 75000}, 10000);
    deadline.content(); deadline.toolStarted('one'); jest.advanceTimersByTime(30001); await Promise.resolve();
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(reject.mock.calls[0][0].message).toContain('did not finish within 30 seconds');
    expect(jest.getTimerCount()).toBe(0);
});
test('progress without an answer never resets the first-response deadline', async () => {
    const {child, reject, deadline} = setup();
    jest.advanceTimersByTime(50000); deadline.activity();
    jest.advanceTimersByTime(40001); await Promise.resolve();
    expect(child.kill).toHaveBeenCalledTimes(1); expect(reject).toHaveBeenCalledTimes(1);
    expect(reject.mock.calls[0][0].message).toContain('first-response deadline');
    expect(jest.getTimerCount()).toBe(0);
});
test('clear removes tool timers and late events cannot rearm them', () => {
    const {child, reject, deadline} = setup(); deadline.content(); deadline.toolStarted('one'); deadline.clear();
    deadline.toolStarted('late'); deadline.toolCompleted('one'); deadline.content(); deadline.activity();
    jest.advanceTimersByTime(400000); expect(child.kill).not.toHaveBeenCalled(); expect(reject).not.toHaveBeenCalled(); expect(jest.getTimerCount()).toBe(0);
});

test('native reasoning before visible text grants bounded extra time and resumes idle checks when the phase completes', () => {
    const {child, deadline} = setup();
    jest.advanceTimersByTime(80000); deadline.reasoning({id: 'reasoning-1', started: true});
    jest.advanceTimersByTime(60000); expect(child.kill).not.toHaveBeenCalled();
    deadline.content(); jest.advanceTimersByTime(60000); expect(child.kill).not.toHaveBeenCalled();
    deadline.reasoning({id: 'reasoning-1', completed: true}); deadline.content(); deadline.clear();
    expect(jest.getTimerCount()).toBe(0);
});


test('native turn activity keeps hidden reasoning alive beyond the initial wait and still respects the absolute budget', async()=>{
    const {child,reject,deadline}=setup({},240000);deadline.generationStarted();
    jest.advanceTimersByTime(300000);expect(child.kill).not.toHaveBeenCalled();
    deadline.generationStarted();jest.advanceTimersByTime(420001);await Promise.resolve();
    expect(child.kill).toHaveBeenCalledTimes(1);expect(reject.mock.calls[0][0].code).toBe('generation_timeout');
});
test('tools before the answer extend the first wait while retaining their own deadline',()=>{
    const {child,deadline}=setup();jest.advanceTimersByTime(50000);deadline.toolStarted('before');
    jest.advanceTimersByTime(60000);expect(child.kill).not.toHaveBeenCalled();deadline.toolCompleted('before');deadline.content();deadline.clear();
    expect(jest.getTimerCount()).toBe(0);
});
test('text-only CLI generation waits for hidden reasoning without visible progress',()=>{
    const {child,deadline}=setup();deadline.bufferedBeforeAnswer();jest.advanceTimersByTime(180000);expect(child.kill).not.toHaveBeenCalled();
    deadline.content();deadline.clear();expect(jest.getTimerCount()).toBe(0);
});

test('a silent continuation survives the former 100-second cutoff, resumes, and still times out when stalled', async () => {
    const {child, reject, deadline} = setup({}, 300000);
    deadline.content();
    jest.advanceTimersByTime(200000);
    expect(child.kill).not.toHaveBeenCalled();
    deadline.content();
    jest.advanceTimersByTime(299999);
    expect(child.kill).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1); await Promise.resolve();
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(reject.mock.calls[0][0].message).toContain('stopped sending response events for 300 seconds');
    expect(jest.getTimerCount()).toBe(0);
});
