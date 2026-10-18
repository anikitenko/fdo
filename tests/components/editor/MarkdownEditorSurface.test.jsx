import React, {useEffect} from 'react';
import {act, fireEvent, render, screen} from '@testing-library/react';
import MarkdownEditorSurface from '../../../src/components/editor/MarkdownEditorSurface';

function model(content) {
    const listeners = new Set();
    return {getValue:() => content, setValue:value => {content = value; listeners.forEach(callback => callback());},
        onDidChangeContent:callback => {listeners.add(callback); return {dispose:() => listeners.delete(callback)};}, listeners};
}

test('renders live Markdown in split/preview views without remounting the editor or losing file-specific modes', () => {
    const doc = model('# Workspace\n\n| Name | State |\n| --- | --- |\n| Tools | Ready |');
    const mounted = jest.fn();
    function Editor() {useEffect(() => {mounted();}, []); return <div>Monaco editor</div>;}
    const {rerender, unmount} = render(<MarkdownEditorSurface filePath="/README.md" model={doc}><Editor/></MarkdownEditorSurface>);
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name:'Split'}));
    expect(screen.getByRole('heading', {name:'Workspace'})).toBeVisible();
    expect(screen.getByRole('table')).toBeVisible();
    act(() => doc.setValue('# Updated workspace'));
    expect(screen.getByRole('heading', {name:'Updated workspace'})).toBeVisible();
    fireEvent.click(screen.getByRole('button', {name:'Preview', exact:true}));
    expect(screen.getByText('Monaco editor')).not.toBeVisible();
    rerender(<MarkdownEditorSurface filePath="/logic.ts" model={model('const value = 1;')}><Editor/></MarkdownEditorSurface>);
    expect(screen.queryByRole('button', {name:'Preview', exact:true})).not.toBeInTheDocument();
    expect(screen.getByText('Monaco editor')).toBeVisible();
    expect(doc.listeners.size).toBe(0);
    rerender(<MarkdownEditorSurface filePath="/README.md" model={doc}><Editor/></MarkdownEditorSurface>);
    expect(screen.getByRole('button', {name:'Preview', exact:true})).toHaveAttribute('aria-pressed','true');
    expect(screen.getByRole('heading', {name:'Updated workspace'})).toBeVisible();
    expect(mounted).toHaveBeenCalledTimes(1);
    unmount(); expect(doc.listeners.size).toBe(0);
});

test('shows empty documents and keeps raw HTML inert; links do not change the editor route', () => {
    const doc = model('');
    window.electron.system.openExternal = jest.fn();
    render(<MarkdownEditorSurface filePath="/notes.MARKDOWN" model={doc}><div>Editor</div></MarkdownEditorSurface>);
    fireEvent.click(screen.getByRole('button', {name:'Preview', exact:true}));
    expect(screen.getByText('Nothing to preview')).toBeVisible();
    act(() => doc.setValue('# Heading\n\n[Jump](#heading) [Website](https://example.com)\n\n<script>alert(1)</script>\n<iframe src="https://example.com"></iframe>'));
    const preview = screen.getByRole('region');
    expect(preview.querySelector('script,iframe')).toBeNull();
    const previousHash = window.location.hash;
    fireEvent.click(screen.getByRole('link', {name:'Jump'}));
    expect(window.location.hash).toBe(previousHash);
    fireEvent.click(screen.getByRole('link', {name:'Website'}));
    expect(window.electron.system.openExternal).toHaveBeenCalledWith('https://example.com');
});
test('split scrolling follows both panes without feeding programmatic scrolls back into each other', () => {
    let top=0, listener;
    const dispose=jest.fn(), editor={layout:jest.fn(),getScrollHeight:()=>1100,getLayoutInfo:()=>({height:100}),getScrollTop:()=>top,
        onDidScrollChange:callback=>{listener=callback;return {dispose};},setScrollTop:jest.fn(value=>{top=value;listener({scrollTopChanged:true});})};
    const {unmount}=render(<MarkdownEditorSurface filePath="/README.md" model={model('# Long file')} editor={editor}><div>Editor</div></MarkdownEditorSurface>);
    fireEvent.click(screen.getByRole('button',{name:'Split'}));
    const preview=screen.getByRole('region');
    Object.defineProperties(preview,{scrollHeight:{configurable:true,value:2100},clientHeight:{configurable:true,value:100}});
    act(()=>{top=500;listener({scrollTopChanged:true});});
    expect(preview.scrollTop).toBe(1000);
    fireEvent.scroll(preview); expect(editor.setScrollTop).not.toHaveBeenCalled();
    preview.scrollTop=1500; fireEvent.scroll(preview);
    expect(editor.setScrollTop).toHaveBeenCalledTimes(1); expect(top).toBe(750);
    unmount();expect(dispose).toHaveBeenCalled();
});
