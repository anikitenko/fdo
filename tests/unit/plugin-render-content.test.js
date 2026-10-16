import {samePluginRenderContent} from '../../src/components/plugin/utils/pluginRenderContent';
test('same-length markup and action changes are delivered; exact duplicate payloads are recognized',()=>{
    const prefix='x'.repeat(200),original={render:prefix+'<p>First</p>',onLoad:'() => doFirst()'};
    expect(samePluginRenderContent(original,{...original})).toBe(true);
    expect(samePluginRenderContent(original,{...original,render:prefix+'<p>Other</p>'})).toBe(false);
    expect(samePluginRenderContent(original,{...original,onLoad:'() => doOther()'})).toBe(false);
    expect(samePluginRenderContent(null,original)).toBe(false);
});
