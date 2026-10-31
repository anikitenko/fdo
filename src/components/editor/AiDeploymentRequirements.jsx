import React, {useEffect,useRef,useState} from 'react';
import PropTypes from 'prop-types';
import DeploymentRequirements from '../plugin/DeploymentRequirements';
import {workspaceDeployment} from '../../utils/plugins/deployment/workspaceDeployment';
// Keep source parsing off token-stream renders. Changes are read from the current
// editor workspace, not from an old AI response or the installed plugin copy.
export default function AiDeploymentRequirements({workspaceId,readFiles,onAsk,onOpenSource,onManage,disabled}) {
    const reader=useRef(readFiles);reader.current=readFiles;
    const [context,setContext]=useState(null);
    useEffect(()=>{
        let previous='';
        const refresh=()=>{try{const files=reader.current(),key=JSON.stringify(files);if(key!==previous){previous=key;setContext(workspaceDeployment(files));}}catch{setContext(null);}};
        refresh();const timer=setInterval(refresh,1000);return()=>clearInterval(timer);
    },[workspaceId]);
    return <DeploymentRequirements context={context} disabled={disabled} onAsk={onAsk} onOpenSource={onOpenSource} onManage={onManage}/>;
}
AiDeploymentRequirements.propTypes={workspaceId:PropTypes.string,readFiles:PropTypes.func.isRequired,onAsk:PropTypes.func,onOpenSource:PropTypes.func,onManage:PropTypes.func,disabled:PropTypes.bool};
