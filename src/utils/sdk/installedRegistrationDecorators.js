import fs from 'node:fs';
import path from 'node:path';
import Module from 'node:module';
import {getHostPluginNodeModulesPath} from '../plugins/runtime/pluginRuntimeBundle';
import {registrationDecoratorContract} from './registrationDecoratorContract';

export function readRegistrationDecoratorContract(requireSdk, runtimeExports) {
    let declaration = '';
    try {
        const packagePath = requireSdk.resolve('@anikitenko/fdo-sdk/package.json');
        const manifest = JSON.parse(fs.readFileSync(packagePath,'utf8'));
        const typesRoot = path.dirname(path.resolve(path.dirname(packagePath),manifest.types || 'dist/@types/index.d.ts'));
        const file = path.join(typesRoot,'decorators','Registration.d.ts');
        // Keep prompt evidence bounded even if an SDK declaration is malformed.
        if (fs.statSync(file).size <= 32768) declaration = fs.readFileSync(file,'utf8');
    } catch { /* Existing SDKs legitimately have no Registration.d.ts. */ }
    return registrationDecoratorContract({runtimeExports,declaration});
}

export function installedRegistrationDecorators() {
    try {
        const requireSdk = Module.createRequire(path.join(getHostPluginNodeModulesPath(),'fdo-registration-contract.cjs'));
        return readRegistrationDecoratorContract(requireSdk,Object.getOwnPropertyNames(requireSdk('@anikitenko/fdo-sdk')));
    } catch {return registrationDecoratorContract();}
}
