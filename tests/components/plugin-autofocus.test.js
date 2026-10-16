import React from 'react';
import {withoutPluginAutofocus} from '../../src/components/plugin/utils/pluginAutofocus';

test('normalization removes blocked HTML autofocus, preserving values, focus handlers and ordinary text',()=>{
    const html='<label>autofocus<input AUTOFOCUS="autofocus" value="Keep" onfocus="custom()"></label><textarea autofocus>Text</textarea>';
    const clean=withoutPluginAutofocus(html,React,document);
    const template=document.createElement('template');template.innerHTML=clean;
    expect(template.content.querySelector('[autofocus]')).toBeNull();
    expect(template.content.querySelector('input').value).toBe('Keep');
    expect(template.content.querySelector('input').getAttribute('onfocus')).toBe('custom()');
    expect(template.content.querySelector('textarea').textContent).toBe('Text');
    expect(withoutPluginAutofocus('Plain autofocus text',React,document)).toBe('Plain autofocus text');
    expect(html).toContain('AUTOFOCUS');
});

test('React intrinsic nodes lose autofocus without mutating elements or user callbacks',()=>{
    const onFocus=jest.fn();
    const input=React.createElement('input',{autoFocus:true,onFocus,value:'Keep',readOnly:true});
    const root=React.createElement('main',{},input,React.createElement('div',{dangerouslySetInnerHTML:{__html:'<input autofocus>'}}));
    const clean=withoutPluginAutofocus(root,React,document);
    expect(clean.props.children[0].props.autoFocus).toBeUndefined();
    expect(clean.props.children[0].props.onFocus).toBe(onFocus);
    expect(clean.props.children[0].props.value).toBe('Keep');
    expect(clean.props.children[1].props.dangerouslySetInnerHTML.__html).toBe('<input>');
    expect(input.props.autoFocus).toBe(true);
    const literal=React.createElement('p',{},'<input autofocus> is an example');
    expect(withoutPluginAutofocus(literal,React,document)).toBe(literal);
    const Component=()=>null;
    const custom=React.createElement(Component,{autoFocus:true});
    expect(withoutPluginAutofocus(custom,React,document)).toBe(custom);
    // Serialized use must remain self-contained, including recursive calls.
    const serialized=new Function('return ('+withoutPluginAutofocus.toString()+')')();
    expect(serialized(root,React,document).props.children[0].props.autoFocus).toBeUndefined();
});
