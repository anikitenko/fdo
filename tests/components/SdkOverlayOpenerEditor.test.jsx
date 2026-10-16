import React from 'react';
import {render,screen,fireEvent} from '@testing-library/react';
import {SdkOverlayOpenerEditor} from '../../src/components/live-ui/SdkOverlayOpenerEditor';
test('connect and disconnect expose only host-approved targets',()=>{
    const onPropose=jest.fn(),element={overlayOpener:{editable:true,status:'connected',targetId:'settings',targets:[{id:'settings',label:'Settings'},{id:'details',label:'Details'}]}};
    render(<SdkOverlayOpenerEditor element={element} onPropose={onPropose}/>);
    fireEvent.change(screen.getByLabelText('Overlay to open'),{target:{value:'details'}});
    expect(onPropose).toHaveBeenCalledWith({kind:'connect-overlay-opener',targetId:'details'});
    fireEvent.click(screen.getByRole('button',{name:'Disconnect overlay opener'}));
    expect(onPropose).toHaveBeenLastCalledWith({kind:'disconnect-overlay-opener'});
});

test('confirmation requires choosing an explicit result action before proposing',()=>{
    const onPropose=jest.fn(),element={overlayOpener:{editable:true,status:'available',targetId:'',targets:[{id:'confirm',label:'Confirmation',identity:'fdo.confirmation-dialog'}],resultTargets:[{id:'result',label:'Result'}]}};
    render(<SdkOverlayOpenerEditor element={element} onPropose={onPropose}/>);
    fireEvent.change(screen.getByLabelText('Overlay to open'),{target:{value:'confirm'}});
    expect(onPropose).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:'Preview confirmation flow'})).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Confirmation result element'),{target:{value:'result'}});
    fireEvent.change(screen.getByLabelText('Confirmed result text'),{target:{value:'Saved'}});
    fireEvent.click(screen.getByRole('button',{name:'Preview confirmation flow'}));
    expect(onPropose).toHaveBeenCalledWith({kind:'connect-overlay-opener',targetId:'confirm',confirmTargetId:'result',confirmText:'Saved'});
});
