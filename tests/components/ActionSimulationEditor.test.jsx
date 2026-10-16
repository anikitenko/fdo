import React from 'react';
import {render,screen,fireEvent} from '@testing-library/react';
import {ActionSimulationEditor} from '../../src/components/live-ui/ActionSimulationEditor';

test('mock controls validate editable JSON and delays, preserve input and send data without source edits',()=>{
    const onSend = jest.fn();
    const {rerender} = render(<ActionSimulationEditor onSend={onSend}/>);
    fireEvent.click(screen.getByRole('button',{name:'Run local action'}));
    expect(onSend).toHaveBeenLastCalledWith({type:'fdo-ui-run-local'});
    fireEvent.change(screen.getByLabelText('Simulation mode'),{target:{value:'mock'}});
    fireEvent.change(screen.getByLabelText('Mock response JSON'),{target:{value:'invalid'}});
    expect(screen.getByRole('button',{name:'Run mock request'})).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Mock response JSON'),{target:{value:'{"nested":{"value":"<b>literal</b>"}}'}});
    fireEvent.change(screen.getByLabelText('Mock latency (ms)'),{target:{value:'10001'}});
    expect(screen.getByRole('button',{name:'Run mock request'})).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Mock latency (ms)'),{target:{value:'250'}});
    fireEvent.click(screen.getByRole('button',{name:'Run mock request'}));
    expect(onSend).toHaveBeenLastCalledWith({type:'fdo-ui-run-mock',scenario:{outcome:'success',responseText:'{"nested":{"value":"<b>literal</b>"}}',errorText:'The simulated request failed.',loadingText:'Loading…',latencyMs:250}});
    fireEvent.change(screen.getByLabelText('Mock outcome'),{target:{value:'error'}});
    fireEvent.change(screen.getByLabelText('Mock error message'),{target:{value:''}});
    expect(screen.getByRole('button',{name:'Run mock request'})).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Mock error message'),{target:{value:'Offline'}});
    fireEvent.click(screen.getByRole('button',{name:'Reset simulation'}));
    expect(onSend).toHaveBeenLastCalledWith({type:'fdo-ui-reset-local'});
    rerender(<ActionSimulationEditor onSend={onSend} disabled status="loading"/>);
    expect(screen.getByRole('button',{name:'Run mock request'})).toBeDisabled();
    expect(screen.getByRole('button',{name:'Reset simulation'})).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Mock request loading…');
});

test('backend-created actions only offer mock execution with the typed default response',()=>{
    const onSend=jest.fn();
    render(<ActionSimulationEditor onSend={onSend} backend={{handler:'visualTextBackend1',text:'Request'}}/>);
    expect(screen.getByText('Backend action preview',{exact:true})).toBeVisible();
    expect(screen.queryByRole('button',{name:'Run local action'})).toBeNull();
    expect(screen.getByLabelText('Simulation mode').options).toHaveLength(1);
    expect(JSON.parse(screen.getByLabelText('Mock response JSON').value)).toEqual({success:true,text:'Request',length:7});
    fireEvent.click(screen.getByRole('button',{name:'Run mock request'}));
    expect(onSend).toHaveBeenCalledWith(expect.objectContaining({type:'fdo-ui-run-mock'}));
});

test('mock request fixtures can drive an echo response without modifying authored input or invoking a backend',()=>{
    const onSend=jest.fn();
    render(<ActionSimulationEditor onSend={onSend} backend={{handler:'visualTextBackend1',text:'Authored',inputId:'input',inputLabel:'Request'}}/>);
    fireEvent.change(screen.getByLabelText('Mock request text'),{target:{value:'<b>Fixture</b>'}});
    fireEvent.change(screen.getByLabelText('Mock response source'),{target:{value:'echo'}});
    expect(screen.getByLabelText('Mock response JSON')).toHaveAttribute('readonly');
    expect(JSON.parse(screen.getByLabelText('Mock response JSON').value)).toEqual({success:true,text:'<b>Fixture</b>',length:14});
    fireEvent.click(screen.getByRole('button',{name:'Run mock request'}));
    expect(onSend).toHaveBeenCalledWith(expect.objectContaining({type:'fdo-ui-run-mock',scenario:expect.objectContaining({requestText:'<b>Fixture</b>',responseText:JSON.stringify({success:true,text:'<b>Fixture</b>',length:14},null,2)})}));
});

test('JSON fixture mode derives inspection responses and malformed input is a simulated error',()=>{
    const onSend=jest.fn();
    render(<ActionSimulationEditor onSend={onSend} backend={{preset:'inspect-json',handler:'visualJsonBackend1',text:'{}',display:'topLevelKeys'}}/>);
    fireEvent.change(screen.getByLabelText('Mock response source'),{target:{value:'echo'}});
    fireEvent.change(screen.getByLabelText('Mock request text'),{target:{value:'{"<b>key</b>":1,"nested":{"value":2}}'}});
    expect(JSON.parse(screen.getByLabelText('Mock response JSON').value)).toMatchObject({success:true,valueType:'object',itemCount:2,topLevelKeys:['<b>key</b>','nested']});
    fireEvent.change(screen.getByLabelText('Mock request text'),{target:{value:'bad'}});
    fireEvent.click(screen.getByRole('button',{name:'Run mock request'}));
    expect(onSend).toHaveBeenLastCalledWith(expect.objectContaining({scenario:expect.objectContaining({outcome:'error',errorText:expect.stringContaining('Invalid JSON:')})}));
});
