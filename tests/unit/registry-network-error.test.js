/** @jest-environment node */
import {registryNetworkError} from '../../src/utils/system/registryNetworkError';
test.each([
    ['ENOTFOUND','could not resolve'],['EAI_AGAIN','could not resolve'],
    ['UND_ERR_CONNECT_TIMEOUT','timed out'],['UNABLE_TO_GET_ISSUER_CERT_LOCALLY','TLS certificate'],
    ['EPERM','was denied'],['ECONNRESET','could not connect'],
])('describes %s without revealing a URL path or credentials', (code,message)=>{
    const original=new TypeError('fetch failed',{cause:Object.assign(new Error('internal private detail'),{code})});
    const error=registryNetworkError(original,'https://user:secret@registry.example.test/private?token=secret');
    expect(error.message).toContain(message);expect(error.message).toContain('registry.example.test');
    expect(error.message).not.toMatch(/secret|private|internal/);expect(error.cause).toBe(original);
});
test('preserves application failures and validation messages',()=>{
    const error=new Error('Invalid registry signature');
    expect(registryNetworkError(error,'https://registry.example.test')).toBe(error);
});
