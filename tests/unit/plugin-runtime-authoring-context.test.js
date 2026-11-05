import {buildPluginRuntimeAuthoringContext,PLUGIN_RUNTIME_GUIDANCE} from '../../src/utils/plugins/authoring/pluginRuntimeAuthoringContext';
import {buildPluginAuthoringGuide} from '../../src/utils/plugins/authoring/pluginAuthoringGuide';
import {INVESTIGATION_CONTRACT} from '../../src/components/editor/utils/aiCodingAgentInvestigation';
import {buildPluginWorkerEnvironment} from '../../src/utils/plugins/security/pluginWorkerEnvironment';

test('AI runtime evidence describes effective HTTPS policy without serializing environment or settings',()=>{
    const grantedCapabilities=['system.network','system.network.https','system.network.scope.public-web-secure'];
    const context=buildPluginRuntimeAuthoringContext({grantedCapabilities,grantSource:'running-worker',
        hostEnv:{OPENAI_API_KEY:'synthetic-private'},environment:{HYPERSTACK_KEY:'synthetic-private'},settings:{password:'synthetic-private'}});
    expect(context.grantSource).toBe('running-worker');expect(context.grantedCapabilities).toEqual(grantedCapabilities);
    expect(context.network).toMatchObject({https:true,tcp:false,dns:false,scopes:[{scope:'public-web-secure'}]});
    expect(context.environment.inheritsHostEnvironment).toBe(false);
    expect(JSON.stringify(context)).not.toContain('synthetic-private');
    expect(JSON.stringify(context)).not.toContain('OPENAI_API_KEY');
    const env=buildPluginWorkerEnvironment({pluginHome:'/data/plugin',pluginCodeHome:'/code/plugin',runtimeEntry:'/cache/plugin.cjs',bootstrapEntry:'/cache/bootstrap.cjs',nodeModulesPath:'/app/node_modules',runtimePolicy:{},hostEnv:{}});
    for (const name of context.environment.publicPathVariables) expect(env[name]).toBeDefined();
    expect(buildPluginRuntimeAuthoringContext().grantSource).toBe('configured');
});

test('all-provider generation and investigation share the desktop boundary and HTTPS repair guidance',()=>{
    for (const prompt of [buildPluginAuthoringGuide(),INVESTIGATION_CONTRACT]) {
        expect(prompt).toContain(PLUGIN_RUNTIME_GUIDANCE);
        expect(prompt).toContain('not inherited');
        expect(prompt).toContain('possible host guard regression');
        expect(prompt).toContain('do not rewrite the plugin to raw sockets');
        expect(prompt).toContain('Declaring capabilities does not grant them');
    }
});
