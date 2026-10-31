import React from 'react';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import PluginExportDialog from '../../src/components/plugin/PluginExportDialog';
const plugin={id:'plugin-a',name:'Availability'};
const report={contractVersion:'1.0.0',requirements:[],adapters:[],warnings:['Configure cloud access.'],blockers:[]};
beforeEach(()=>{window.electron.plugin={previewExport:jest.fn().mockResolvedValue({success:true,token:'review-token',report}),exportAs:jest.fn().mockResolvedValue({success:true,path:'/tmp/plugin.zip'})};});
test('archive export preserves the plugin format and reports its saved location',async()=>{
    render(<PluginExportDialog plugin={plugin} onClose={jest.fn()}/>);
    fireEvent.click(screen.getByRole('button',{name:'Export plugin archive'}));
    await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('/tmp/plugin.zip'));
    expect(window.electron.plugin.exportAs).toHaveBeenCalledWith('plugin-a',{format:'archive',token:undefined});
    expect(window.electron.plugin.previewExport).not.toHaveBeenCalled();
});
test('web export waits for host analysis and uses the reviewed snapshot token',async()=>{
    render(<PluginExportDialog plugin={plugin} onClose={jest.fn()}/>);
    fireEvent.change(screen.getByLabelText('Export format'),{target:{value:'web'}});
    expect(screen.getByRole('button',{name:'Export web application'})).toBeDisabled();
    await screen.findByText('Application conversion prepared');
    fireEvent.click(screen.getByRole('button',{name:'Export web application'}));
    await waitFor(()=>expect(window.electron.plugin.exportAs).toHaveBeenCalledWith('plugin-a',{format:'web',token:'review-token'}));
});
test('conversion blockers keep web export disabled while the report can still be saved',async()=>{
    window.electron.plugin.previewExport.mockResolvedValue({success:true,token:'blocked-review',report:{...report,blockers:['Replace the desktop tray with web controls.']}});
    render(<PluginExportDialog plugin={plugin} onClose={jest.fn()}/>);
    fireEvent.change(screen.getByLabelText('Export format'),{target:{value:'web'}});
    await screen.findByText('Replace the desktop tray with web controls.');
    expect(screen.getByRole('button',{name:'Export web application'})).toBeDisabled();
    fireEvent.click(screen.getByRole('button',{name:'Save conversion report'}));
    await waitFor(()=>expect(window.electron.plugin.exportAs).toHaveBeenCalledWith('plugin-a',{format:'report',token:'blocked-review'}));
});
test('failed saves and canceled native dialogs retain the chosen format for retry',async()=>{
    window.electron.plugin.exportAs.mockResolvedValueOnce({success:false,error:'Plugin source changed. Review again.'}).mockResolvedValueOnce({success:true,canceled:true});
    render(<PluginExportDialog plugin={plugin} onClose={jest.fn()}/>);
    fireEvent.click(screen.getByRole('button',{name:'Export plugin archive'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('Review again');
    fireEvent.click(screen.getByRole('button',{name:'Export plugin archive'}));
    await waitFor(()=>expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(screen.queryByText('Saved to')).not.toBeInTheDocument();
});

test('missing exporter support has an owned recovery plan and a work-package path rather than a review loop',async()=>{
    const message='Provide container tools or a remote execution service and remap executable, argument, environment and working-directory policies.';
    window.electron.plugin.previewExport.mockResolvedValue({success:true,token:'migration-token',report:{...report,blockers:[message],adapters:[{id:'process',status:'blocked',description:message}],
        locations:[{file:'/backend.ts',line:207,adapter:'process',symbol:'createScopedProcessExecActionRequest'}],requirements:[{capability:'system.process.exec',adapter:'process',status:'blocked',description:message}]}});
    render(<PluginExportDialog plugin={plugin} onClose={jest.fn()}/>);
    fireEvent.change(screen.getByLabelText('Export format'),{target:{value:'web'}});
    await screen.findByText('Web migration required');
    expect(screen.queryByText(/Resolve the items below/)).not.toBeInTheDocument();
    expect(screen.getByRole('region',{name:'Migration tasks'})).toHaveTextContent('FDO exporter / web backend engineer');
    expect(screen.getByRole('region',{name:'Migration tasks'})).toHaveTextContent('/backend.ts:207');
    expect(screen.getByText(/Reviewing unchanged source will not resolve/)).toBeVisible();
    fireEvent.click(screen.getByRole('button',{name:'Export migration work package'}));
    await waitFor(()=>expect(window.electron.plugin.exportAs).toHaveBeenCalledWith('plugin-a',{format:'migration',token:'migration-token'}));
});

test('copying a migration brief does not run an agent or modify grants, and permission review is explicit',async()=>{
    const writeText=jest.fn().mockResolvedValue();Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText}});
    window.electron.plugin.previewExport.mockResolvedValue({success:true,token:'permission-token',report:{...report,blockers:['Capability storage is declared but is not approved for this plugin. Review its grants before exporting.']}});
    const onReviewCapabilities=jest.fn();render(<PluginExportDialog plugin={plugin} onClose={jest.fn()} onReviewCapabilities={onReviewCapabilities}/>);
    fireEvent.change(screen.getByLabelText('Export format'),{target:{value:'web'}});
    await screen.findByText('Web migration required');
    fireEvent.click(screen.getByRole('button',{name:'Copy migration brief'}));
    await waitFor(()=>expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Do not mark the export ready by disabling capabilities')));
    expect(onReviewCapabilities).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'Review capabilities'}));expect(onReviewCapabilities).toHaveBeenCalledTimes(1);
    expect(window.electron.plugin.exportAs).not.toHaveBeenCalled();
});

test('tool choices and authentication setup are visible before saving the application project',async()=>{
    window.electron.plugin.previewExport.mockResolvedValue({success:true,token:'tool-review',report:{...report,toolchain:{baseImage:'node:24-bookworm-slim',tools:[{id:'azure-cli',version:'^2.91.0',installer:{type:'azure-cli'},source:'declared',authentication:{methods:['device-code','managed-identity']}}],unresolved:[{scope:'cloud-tools',reason:'Declare the actual tools.'}],warnings:['Configure tools.']}}});
    render(<PluginExportDialog plugin={plugin} onClose={jest.fn()}/>);
    fireEvent.change(screen.getByLabelText('Export format'),{target:{value:'web'}});
    await screen.findByText('Complete tool requirements before building');
    expect(screen.getByText('azure-cli')).toBeVisible();expect(screen.getByText('^2.91.0')).toBeVisible();expect(screen.getByText(/Authenticate separately: device-code, managed-identity/)).toBeVisible();
    expect(screen.getByRole('button',{name:'Export web application'})).toBeEnabled();
});
