import {parse} from '@babel/parser';

// Read declarations as data. An unpublished SDK checkout is never evidence
// that the plugin's installed runtime exports a decorator.
export function registrationDecoratorContract({runtimeExports = [], declaration = ''} = {}) {
    const functions = new Map();
    let optionsDeclaration = '';
    try {
        const ast = parse(declaration, {sourceType:'module',plugins:['typescript']});
        for (const statement of ast.program.body) {
            if (statement.type !== 'ExportNamedDeclaration') continue;
            const node = statement.declaration;
            if (['TSDeclareFunction','FunctionDeclaration'].includes(node?.type) && node.id) functions.set(node.id.name,declaration.slice(node.start,node.end));
            if (node?.type === 'TSTypeAliasDeclaration' && node.id.name === 'SharedFunctionOptions') optionsDeclaration = declaration.slice(node.start,node.end);
        }
    } catch { /* Unreadable declarations must not enable new SDK APIs. */ }
    const decorator = name => {
        const signature = functions.get(name) || '';
        return {available:runtimeExports.includes(name) && /:\s*MethodDecorator\s*;?\s*$/.test(signature),signature};
    };
    return {mode:'legacy-typescript',handler:decorator('handler'),sharedFunction:decorator('sharedFunction'),optionsDeclaration};
}

export function registrationDecoratorInstructions(contract = registrationDecoratorContract()) {
    const parts = ['SDK REGISTRATION DECORATORS — installed runtime and declarations only',
        'TypeScript legacy method decorators use experimentalDecorators:true (already enabled by FDO). Do not use stage-3 decorator contexts or class/property/static/accessor registration decorators. Keep init():void synchronous (an empty implementation is valid), render() synchronous, and construct the concrete SDK subclass once in the entry.'];
    if (contract.handler.available) parts.push(
        'Prefer @handler() for fixed instance backend handlers. It registers under the method name; @handler("alias") supplies the public UI_MESSAGE handler name. Registration occurs just before init(), after subclass fields initialize, once per instance. Methods are bound to the instance. Do not also register the same method manually in init(), and never call the method merely to register it. Never call the internal applyDecoratedRegistrations hook; the SDK owns it.',
        `Installed signature: ${contract.handler.signature}`);
    else parts.push('The installed SDK does not expose a verified handler decorator. Do not import/use @handler from a sibling checkout or newer documentation; register UI handlers using PluginRegistry.registerHandler in init().');
    if (contract.sharedFunction.available) parts.push(
        '@sharedFunction({service,version,description,method?,contract?}) exports an instance method. service is the service NAME, not providerId; the host supplies the installed provider identity. version is an integer major (1..9999). method defaults to the method name. contract is the single method contract {input,output}, not a method-name map. Use type-only SharedFunctionOptions/SharedLogicContext imports when needed.',
        'Decorated methods sharing a service/version are grouped into one registration: use the same description and distinct exported method names. Keep manual shared.register for dynamic services; never register the same service/version twice. Declare plugins.shared.provide for providers; consumers still need plugins.shared.use plus the exact plugins.shared.call.<installed-provider-id>.<service>.v<version> grant. Decorators never grant permissions, start providers or bypass approval/lifecycle cleanup.',
        `Installed signature: ${contract.sharedFunction.signature}`, contract.optionsDeclaration);
    else parts.push('The installed SDK does not expose a verified sharedFunction decorator. Use this.shared.register in synchronous init() when the installed SDK supports SharedLogic; preserve explicit permission and service contracts.');
    parts.push('@handler can be stacked with @handleError in either order when both exports are installed. handleError changes non-render results to {success,result}; preserve that envelope at callers. Shared methods already have a safe error boundary: do not add handleError unless its envelope is deliberately part of the shared contract. Reject reserved names and duplicate aliases; preserve inherited overrides. Browser event bindings remain defineRenderOnLoadActions, not registration decorators.');
    return parts.filter(Boolean).join('\n');
}
