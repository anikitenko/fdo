/** @jest-environment node */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {registrationDecoratorContract,registrationDecoratorInstructions} from '../../src/utils/sdk/registrationDecoratorContract';
import {readRegistrationDecoratorContract} from '../../src/utils/sdk/installedRegistrationDecorators';
import {validatePluginWorkspaceSdkContract} from '../../src/utils/sdk/pluginWorkspaceSdkContract';
import {repairPluginBootstrap} from '../../src/utils/plugins/validation/workspacePluginBootstrap';

const declaration = `export type SharedFunctionOptions = {service:string;version:number;description:string;method?:string;contract?:{input:unknown;output:unknown}};
export declare function handler(name?:string):MethodDecorator;
export declare function sharedFunction(options:SharedFunctionOptions):MethodDecorator;`;
const runtimeExports = ['FDO_SDK','handler','sharedFunction'];
const validate = content => validatePluginWorkspaceSdkContract([{path:'/index.ts',content}],{runtimeExports});

test('requires both installed runtime exports and matching legacy decorator declarations', () => {
    const contract = registrationDecoratorContract({runtimeExports,declaration});
    expect(contract.handler.available).toBe(true);expect(contract.sharedFunction.available).toBe(true);
    const instructions = registrationDecoratorInstructions(contract);
    for (const term of ['just before init()', 'once per instance', 'same description', 'Decorators never grant', '{success,result}', 'defineRenderOnLoadActions', 'SharedFunctionOptions']) expect(instructions).toContain(term);
    for (const options of [{runtimeExports:[],declaration},{runtimeExports,declaration:''},{runtimeExports,declaration:'export declare function handler():void;'}]) {
        const unsupported = registrationDecoratorContract(options);
        expect(unsupported.handler.available).toBe(false);
        expect(registrationDecoratorInstructions(unsupported)).toContain('register UI handlers using PluginRegistry.registerHandler in init()');
        expect(registrationDecoratorInstructions(unsupported)).not.toContain('@sharedFunction({');
    }
});

test('reads only the selected installed package declarations, and handles old SDKs', () => {
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'fdo-registration-contract-'));
    try {
        const pkg=path.join(root,'package.json');
        fs.writeFileSync(pkg,JSON.stringify({types:'dist/@types/index.d.ts'}));
        const requireSdk={resolve:()=>pkg};
        expect(readRegistrationDecoratorContract(requireSdk,runtimeExports).handler.available).toBe(false);
        fs.mkdirSync(path.join(root,'dist/@types/decorators'),{recursive:true});
        fs.writeFileSync(path.join(root,'dist/@types/decorators/Registration.d.ts'),declaration);
        expect(readRegistrationDecoratorContract(requireSdk,runtimeExports).sharedFunction.available).toBe(true);
        expect(readRegistrationDecoratorContract(requireSdk,[]).sharedFunction.available).toBe(false);
    } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('accepts aliases, namespace imports, grouped methods and method decorators without removing bootstrap startup', () => {
    const content=`import {FDO_SDK,handler as onUI,sharedFunction as share} from '@anikitenko/fdo-sdk';
    export default class Plugin extends FDO_SDK {
      init():void {}
      @onUI() echo(input:unknown){return input;}
      @onUI('inspect.alias') inspect(){return 'ok';}
      @share({service:'checks',version:1,description:'Checks'}) check(input:unknown){return input;}
      @share({service:'checks',version:1,description:'Checks',method:'status'}) status(){return true;}
    }`;
    expect(validate(content)).toEqual([]);
    const repaired=repairPluginBootstrap({path:'/index.ts',content});
    expect(repaired.content).toContain('new Plugin();');
    expect(repaired.content).toContain('@onUI()');
    expect(validate(`import * as sdk from '@anikitenko/fdo-sdk';class Plugin{@sdk.handler() check(){}}`)).toEqual([]);
    expect(validatePluginWorkspaceSdkContract([{path:'/index.ts',content}],{runtimeExports:['FDO_SDK']})).toEqual([
        expect.stringContaining('does not provide "handler"'),expect.stringContaining('does not provide "sharedFunction"'),
    ]);
});

test.each([
    ["@handler check(){}", 'decorator factory'],
    ["@handler() static check(){}", 'instance methods only'],
    ["@handler() get check(){return 1;}", 'instance methods only'],
    ["@handler('__sdk.getDiagnostics') check(){}", 'non-reserved'],
    ["@handler('same') one(){} @handler('same') two(){}", 'Duplicate decorated handler'],
    ["@handler('one') @handler('two') check(){}", 'Duplicate @handler'],
    ["@sharedFunction({service:'plugins.shared.call.provider.service.v1',version:1,description:'Check'}) check(){}", 'valid service name'],
    ["@sharedFunction({service:'checks',version:0,description:'Check'}) check(){}", 'integer service major'],
    ["@sharedFunction({service:'checks',version:1,description:''}) check(){}", 'nonempty'],
    ["@sharedFunction({service:'checks',version:1,description:'Check',method:'then'}) check(){}", 'non-reserved'],
    ["@sharedFunction({service:'checks',version:1,description:'One'}) one(){} @sharedFunction({service:'checks',version:1,description:'Two'}) two(){}", 'same description'],
    ["@sharedFunction({service:'checks',version:1,description:'Check',method:'check'}) one(){} @sharedFunction({service:'checks',version:1,description:'Check',method:'check'}) two(){}", 'Duplicate shared method'],
])('diagnoses certain registration errors without executing or rewriting code: %s', (body, message) => {
    expect(validate(`import {handler,sharedFunction} from '@anikitenko/fdo-sdk';class Plugin {${body}}`)).toEqual(expect.arrayContaining([expect.stringContaining(message)]));
});

test('does not guess dynamic metadata, validate other libraries or confuse inherited aliases', () => {
    expect(validate(`import {handler,sharedFunction} from '@anikitenko/fdo-sdk';declare const options:any;
    class Base{@handler('same') check(){}}
    class Child extends Base{@handler('same') check(){} @sharedFunction(options) exported(){}}
    `)).toEqual([]);
    expect(validate(`import {handler} from 'other-library';class Plugin{@handler static check(){}}`)).toEqual([]);
    const guide='# Example\n\n```ts\nimport {handler} from "@anikitenko/fdo-sdk";\nclass Plugin{@handler() static check(){}}\n```';
    expect(validatePluginWorkspaceSdkContract([{path:'/SKILL.md',content:guide}],{runtimeExports})).toEqual([expect.stringContaining('/SKILL.md:5: SDK_REGISTRATION_DECORATOR')]);
});
