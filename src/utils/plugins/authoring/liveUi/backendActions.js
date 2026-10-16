// These source templates run in the virtual plugin workspace; workspace typecheck tests validate them.
import {parseExpression} from '@babel/parser';
import {isNodesEquivalent} from '@babel/types';
import {jsonBackendDeclarations} from './jsonInspection';
import {validResultDisplay,resultDisplays} from './responseMappings';
import {planButtonAction} from './actionBindings';

const quote = JSON.stringify;
const displayExpression=display=>({text:'result.text',length:'String(result.length)',summary:'result.summary',valueType:'result.valueType',itemCount:'String(result.itemCount)',topLevelKeys:'JSON.stringify(result.topLevelKeys, null, 2)'})[display] || 'JSON.stringify(result, null, 2)';
const validText = text => typeof text === 'string' && text.length <= 2000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text);

// This exact, closure-free SDK callback is also recognized for mock-only preview.
export function backendFrontendSource(selector,handler,text,inputSelector = '',inputTag = 'textarea',display = 'json',preset = 'text',outputs = []) {
    return `async () => {
        const target = document.querySelector<HTMLElement>(${quote(selector)});
        if (!target || target.getAttribute('aria-busy') === 'true') return;
        target.setAttribute('aria-busy', 'true');
        target.textContent = 'Sending request…';
        try {${inputSelector ? `
            const input = document.querySelector<${inputTag === 'input' ? 'HTMLInputElement' : 'HTMLTextAreaElement'}>(${quote(inputSelector)});
            if (!input || input.disabled || input.readOnly${inputTag === 'input' ? " || !['text', 'search'].includes(input.type)" : ''}) throw new Error('The bound text input is unavailable.');
            const text = input.value;
            if (text.length > 2000) throw new Error('Text must contain at most 2,000 characters.');` : ''}
            const response = await window.createBackendReq('UI_MESSAGE', {handler: ${quote(handler)}, content: {text: ${inputSelector ? 'text' : quote(text)}}});
            const result = response?.result ?? response;
            if (response?.ok === false || response?.success === false || !result || result.success !== true || ${preset === 'inspect-json' ? "typeof result.summary !== 'string' || !['object','array','null','string','number','boolean'].includes(result.valueType) || !Number.isInteger(result.itemCount) || result.itemCount < 0 || !Array.isArray(result.topLevelKeys) || result.topLevelKeys.some((key: unknown) => typeof key !== 'string')" : "typeof result.text !== 'string' || result.length !== result.text.length"}) throw new Error(String(result?.error || response?.error || 'Invalid backend response.'));
            ${outputs.map((output,index)=>`const output${index+1} = document.querySelector<HTMLElement>(${quote(`[data-fdo-result="${output.marker}"]`)});
            if (!output${index+1}) throw new Error('A mapped result element is unavailable.');`).join('\n            ')}
            target.textContent = ${displayExpression(display)};${outputs.map((output,index)=>`
            output${index+1}.textContent = ${displayExpression(output.display)};`).join('')}
        } catch (error) {
            target.textContent = error instanceof Error ? error.message : String(error);
        } finally {
            target.setAttribute('aria-busy', 'false');
        }
    }`;
}

export function describeBackendPreset(node,actions) {
    if (!actions?.backendCreation) return null;
    const selector = node?.body?.body?.[0]?.declarations?.[0]?.init?.arguments?.[0];
    const body = node?.body?.body?.[4]?.block?.body;
    const request = body?.find(statement=>statement.type === 'VariableDeclaration' && statement.declarations[0]?.id?.name === 'response')?.declarations[0].init?.argument;
    const options = request?.arguments?.[1];
    const field = (object,name) => object?.type === 'ObjectExpression' && object.properties.find(item=>!item.computed && (item.key?.name ?? item.key?.value) === name)?.value;
    const handler = field(options,'handler'), text = field(field(options,'content'),'text');
    const match = selector?.type === 'StringLiteral' && /^\[data-fdo-result="(visual-result-\d+)"]$/.exec(selector.value);
    if (!match || handler?.type !== 'StringLiteral' || !/^visual(?:Text|Json)Backend\d+$/.test(handler.value)) return null;
    const preset=handler.value.startsWith('visualJsonBackend') ? 'inspect-json' : 'text';
    const inputCall = body?.[0]?.declarations?.[0]?.init;
    const inputSelector = text?.type === 'Identifier' && text.name === 'text' && inputCall?.arguments?.[0];
    const inputMatch = inputSelector?.type === 'StringLiteral' && /^\[data-fdo-input="(visual-input-\d+)"]$/.exec(inputSelector.value);
    const typeName = inputCall?.typeArguments?.params?.[0]?.typeName?.name;
    const inputTag = typeName === 'HTMLTextAreaElement' ? 'textarea' : typeName === 'HTMLInputElement' ? 'input' : null;
    if (!(inputMatch && inputTag) && (text?.type !== 'StringLiteral' || !validText(text.value))) return null;
    const outputNodes=body?.filter(statement=>statement.type === 'VariableDeclaration' && /^output\d+$/.test(statement.declarations[0]?.id?.name || '')) || [];
    if(outputNodes.length > 3) return null;
    const outputs=[];
    for(let index=0;index<outputNodes.length;index++) {
        const declaration=outputNodes[index].declarations[0],name='output'+(index+1);
        const literal=declaration.init?.arguments?.[0];
        const marker=literal?.type === 'StringLiteral' && /^\[data-fdo-result="(visual-result-\d+)"]$/.exec(literal.value)?.[1];
        const assignment=body.find(statement=>statement.type === 'ExpressionStatement' && statement.expression.left?.object?.name===name)?.expression.right;
        const display=resultDisplays(preset).find(item=>assignment && isNodesEquivalent(assignment,parseExpression(displayExpression(item.value))))?.value;
        if(declaration.id.name !== name || !marker || !display) return null;
        outputs.push({marker,display});
    }
    if(new Set([match[1],...outputs.map(output=>output.marker)]).size !== outputs.length+1) return null;
    const display = resultDisplays(preset).map(item=>item.value).find(value=>isNodesEquivalent(node,parseExpression(backendFrontendSource(selector.value,handler.value,inputMatch ? '' : text.value,inputMatch ? inputSelector.value : '',inputTag,value,preset,outputs),{plugins:['typescript']})));
    if (!display) return null;
    const registrations = actions.backendCreation.registrations.filter(item=>item.handler === handler.value);
    return registrations.length === 1 ? {marker:match[1],handler:handler.value,text:inputMatch ? '' : text.value,...(outputs.length ? {outputs} : {}),...(preset === 'inspect-json' ? {preset} : {}),...(display !== 'json' ? {display} : {}),...(inputMatch ? {inputMarker:inputMatch[1],inputTag} : {})} : null;
}

export function planBackendAction(files,element,request) {
    const preset=request.preset ?? 'text';
    if(!['text','inspect-json'].includes(preset)) throw new Error('Choose a supported backend preset.');
    const display=request.display ?? 'json';
    if(!validResultDisplay(display,preset)) throw new Error('Choose a supported result display.');
    const creation = element.localActionCreation;
    const context = creation?.backend;
    const target = creation?.targets.find(item=>item.id === request.targetId);
    if (!context || !target || !element.structure?.unique) throw new Error('Select an unconnected managed button and supported result target. Backend creation requires a direct TypeScript action contract and synchronous init method.');
    const input = request.inputId != null && creation?.inputs?.find(item=>item.id === request.inputId);
    if (request.inputId != null && !input) throw new Error('Choose a unique, enabled SDK text input. Custom, shared, password or read-only inputs stay in the IDE.');
    if (!input && !validText(request.text)) throw new Error('Use up to 2,000 characters of plain request text.');
    const occupied = Object.values(files).join('\n');
    let number = 1;
    while (['visualTextBackend','visualJsonBackend','visualRequest','VisualTextInput','VisualJsonInput','VisualTextResult','VisualJsonResult','handleVisualText','handleVisualJson','VisualPluginRegistry'].some(prefix=>occupied.includes(prefix+number))) number++;
    const name = 'visualRequest'+number, handler = (preset === 'inspect-json' ? 'visualJsonBackend' : 'visualTextBackend')+number;
    const inputType = (preset === 'inspect-json' ? 'VisualJsonInput' : 'VisualTextInput')+number, resultType = (preset === 'inspect-json' ? 'VisualJsonResult' : 'VisualTextResult')+number;
    const implementation = (preset === 'inspect-json' ? 'handleVisualJson' : 'handleVisualText')+number, registry = 'VisualPluginRegistry'+number;
    let markerNumber=1;
    while (occupied.includes('visual-result-'+markerNumber)) markerNumber++;
    const marker = target.marker || 'visual-result-'+markerNumber;
    const selector = `[data-fdo-result="${marker}"]`;
    let inputNumber=1;while(occupied.includes('visual-input-'+inputNumber)) inputNumber++;
    const inputMarker = input && (input.marker || 'visual-input-'+inputNumber);
    const inputSelector = input ? `[data-fdo-input="${inputMarker}"]` : '';
    const connection = planButtonAction(files,{...element,actionConnection:{...creation.connection,handlers:[{name,preventDefault:true}]}},{kind:'connect-action',handler:name});
    const operations = connection.patches.map(({file,start,end,replacement})=>({file,start,end,replacement}));
    const declarations = backendDeclarations(preset,inputType,resultType,implementation);
    operations.push({file:'/index.ts',start:0,end:0,replacement:`import {PluginRegistry as ${registry}} from '@anikitenko/fdo-sdk';\n`},
        {file:'/index.ts',start:context.initInsert,end:context.initInsert,replacement:`\n        ${registry}.registerHandler(${quote(handler)}, ${implementation});\n`},
        {file:'/index.ts',start:creation.handlerInsert,end:creation.handlerInsert,replacement:`${quote(name)}: ${backendFrontendSource(selector,handler,request.text,inputSelector,input?.tag,display,preset)}, `},
        {file:'/index.ts',start:files['/index.ts'].length,end:files['/index.ts'].length,replacement:declarations});
    if (!target.marker) operations.push({file:target.file,start:target.insert,end:target.insert,replacement:quote('data-fdo-result')+': '+quote(marker)+', '});
    if (input && !input.marker) operations.push({file:input.file,start:input.insert,end:input.insert,replacement:quote('data-fdo-input')+': '+quote(inputMarker)+', '});
    return backendPatches(files,operations,'Create typed backend text action');
}

function backendPatches(files,operations,description) {
    operations.sort((a,b)=>a.file.localeCompare(b.file) || b.start-a.start);
    const current={...files},patches=[];
    for (const operation of operations) {
        const {file,start,end,replacement}=operation,before=current[file],after=before.slice(0,start)+replacement+before.slice(end);
        patches.push({...operation,before,after,removed:before.slice(start,end),added:replacement,description,affected:1});current[file]=after;
    }
    return {...patches[0],patches};
}

export function planBackendResult(files,element,request) {
    const mapping=element.backendResultMapping;
    const target=mapping?.targets.find(item=>item.id===request.targetId);
    const preset=mapping?.config.preset || 'text';
    if (!mapping || !target || !validResultDisplay(request.display,preset)) throw new Error('Choose a supported result target and display for a managed backend action. Custom callbacks stay in the IDE.');
    const rows=request.outputs ?? mapping.outputs ?? [];
    if(!Array.isArray(rows) || rows.length > 3) throw new Error('Map at most four result elements per action.');
    const extra=rows.map(row=>({target:mapping.targets.find(item=>item.id===row?.targetId),display:row?.display}));
    if(extra.some(row=>!row.target || !validResultDisplay(row.display,preset)) || new Set([target.id,...extra.map(row=>row.target.id)]).size !== extra.length+1) throw new Error('Choose distinct supported result elements and contract fields.');
    const config=mapping.config,operations=[],occupied=Object.values(files).join('\n'),allocated=new Set();
    const markerFor=target=>{
        if(target.marker) return target.marker;
        let number=1;while(occupied.includes('visual-result-'+number) || allocated.has('visual-result-'+number)) number++;
        const marker='visual-result-'+number;allocated.add(marker);
        operations.push({file:target.file,start:target.insert,end:target.insert,replacement:'"data-fdo-result": '+quote(marker)+', '});return marker;
    };
    const marker=markerFor(target),outputs=extra.map(row=>({marker:markerFor(row.target),display:row.display}));
    const oldRows=mapping.outputs || [];
    const changedOutputs=JSON.stringify(rows)!==JSON.stringify(oldRows);
    if(outputs.length || oldRows.length) {
        if(marker !== config.marker || request.display !== mapping.display || changedOutputs) {
            let callback=backendFrontendSource(`[data-fdo-result="${marker}"]`,config.handler,config.text,config.inputMarker ? `[data-fdo-input="${config.inputMarker}"]` : '',config.inputTag,request.display,preset,outputs);
            if(mapping.comments?.length) callback=callback.replace('{','{\n'+mapping.comments.join('\n')+'\n');
            operations.push({file:mapping.file,...mapping.callback,replacement:callback});
        }
    } else {
        if(marker !== config.marker) operations.push({file:mapping.file,...mapping.selector,replacement:quote(`[data-fdo-result="${marker}"]`)});
        if(request.display !== mapping.display) operations.push({file:mapping.file,...mapping.expression,replacement:displayExpression(request.display)});
    }
    if(!operations.length) throw new Error('The result mapping is unchanged.');
    return backendPatches(files,operations,'Change backend result mapping');
}

export function backendDeclarations(preset,inputType,resultType,implementation) {
    return preset === 'inspect-json' ? jsonBackendDeclarations(inputType,resultType,implementation) : /* language=TEXT */ `\n\n// Live UI backend preset. Keep validation at the transport boundary.\nexport interface ${inputType} {text: string;}\nexport type ${resultType} = {success: true; text: string; length: number} | {success: false; error: string};\nexport function ${implementation}(input: unknown): ${resultType} {\n    if (!input || typeof input !== 'object' || Array.isArray(input)) return {success: false, error: 'Expected a text request.'};\n    const data = input as Partial<${inputType}>;\n    if (typeof data.text !== 'string' || data.text.length > 2000) return {success: false, error: 'Text must contain at most 2,000 characters.'};\n    return {success: true, text: data.text, length: data.text.length};\n}\n`;
}
