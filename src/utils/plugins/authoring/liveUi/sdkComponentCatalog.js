export const SDK_COMPONENT_ADAPTERS = Object.freeze({
    'fdo.dialog':'createDialog', 'fdo.confirmation-dialog':'createConfirmationDialog', 'fdo.popover':'createPopover',
    'fdo.progress-bar':'createProgressBar', 'fdo.toast':'createToast', 'fdo.inline-alert':'createInlineAlert',
    'fdo.toast-region':'createToastRegion', 'fdo.async-action-button':'createAsyncActionButton',
    'fdo.tabs':'createTabs', 'fdo.disclosure':'createDisclosure', 'fdo.accordion':'createAccordion',
});
export function sdkComponentDefaults(identity, id, name) {
    switch(identity) {
        case 'fdo.progress-bar': return {id,label:'Progress',value:0,max:100};
        case 'fdo.toast': case 'fdo.inline-alert': return {id,title:'New ' + name,message:'Your message',variant:'info'};
        case 'fdo.toast-region': return {id,label:'Notifications',body:''};
        case 'fdo.async-action-button': return {id,label:'Run action',pendingLabel:'Working…',successLabel:'Done',disabled:true};
        case 'fdo.tabs': return {id,label:'Settings',items:[{key:'general',label:'General',body:''},{key:'advanced',label:'Advanced',body:''}]};
        case 'fdo.accordion': return {id,label:'Details',items:[{key:'first',title:'First section',body:'',open:true},{key:'second',title:'Second section',body:''}]};
        case 'fdo.disclosure': return {id,title:'Details',body:'',open:true};
        default: return {id,title:'New ' + name,body:''};
    }
}
// Availability comes from the installed, schema-validated contract. Metadata
// advertising an unfamiliar component never enables source generation.
export function sdkComponentCatalog(contract) {
    if (!/^1\.\d+\.\d+$/.test(contract?.contractVersion || '')) return [];
    return (contract.components || []).map(item=>({identity:item.identity,name:item.name,create:item.create,mount:item.mount,
        signatures:item.signatures,slots:(item.slots || []).map(slot=>slot.name),
        supported:SDK_COMPONENT_ADAPTERS[item.identity] === item.create && item.preview?.markupOnly === true && item.preview?.handlers === false && item.preview?.backendExecution === false}));
}
