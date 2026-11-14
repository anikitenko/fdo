/** @jest-environment node */
import {watchRegistryPlugin} from '../../src/utils/plugins/security/registryVerificationWatch';
beforeEach(()=>jest.useFakeTimers());afterEach(()=>jest.useRealTimers());
test.each(['revoked','offline'])('stops a running plugin after %s verification',async(reason)=>{
    const blocked=jest.fn(),verify=reason==='offline'?jest.fn(async()=>{throw new Error('offline');}):jest.fn(async()=>({success:false,error:'revoked'}));
    const stop=watchRegistryPlugin({verify,isCurrent:()=>true,blocked});
    await jest.advanceTimersByTimeAsync(300000);expect(blocked).toHaveBeenCalledWith({success:false,error:reason});stop();
});
test('does not kill a replacement worker when the old verification resolves late',async()=>{
    let resolve,current=true;const blocked=jest.fn(),verify=jest.fn(()=>new Promise(done=>{resolve=done;}));
    const stop=watchRegistryPlugin({verify,isCurrent:()=>current,blocked});await jest.advanceTimersByTimeAsync(300000);
    await jest.advanceTimersByTimeAsync(300000);expect(verify).toHaveBeenCalledTimes(1);
    current=false;resolve({success:false,error:'revoked'});await Promise.resolve();expect(blocked).not.toHaveBeenCalled();stop();
});
test('cleanup cancels future checks and ignores an in-flight result',async()=>{
    let resolve;const blocked=jest.fn(),verify=jest.fn(()=>new Promise(done=>{resolve=done;}));
    const stop=watchRegistryPlugin({verify,isCurrent:()=>true,blocked});await jest.advanceTimersByTimeAsync(300000);stop();
    resolve({success:false,error:'revoked'});await Promise.resolve();await jest.advanceTimersByTimeAsync(900000);
    expect(verify).toHaveBeenCalledTimes(1);expect(blocked).not.toHaveBeenCalled();
});
