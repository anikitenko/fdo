// A unique literal component ID survives offset and preview-node-ID changes.
// Ambiguous/computed identities use their source call location instead.
export function sdkComponentContextKey(element,elements=[]) {
    const component=element?.sdkComponent;
    if(!component) return '';
    const file=element.location?.path || element.structure?.file || '';
    const peers=elements.filter(item=>item.sdkComponent && item.sdkComponent.identity===component.identity && item.sdkComponent.instanceId===component.instanceId && (item.location?.path || item.structure?.file || '')===file);
    const identity=component.instanceIdLiteral && component.instanceId && peers.length===1 ? ['id',component.instanceId] : ['source',element.structure?.start ?? element.location?.line,element.location?.column];
    return JSON.stringify([file,component.identity,...identity]);
}
