import {runCodingInvestigation,createInvestigationActions,investigationBudget,isInvestigationPrompt,investigationAllowsRepair} from '../../src/components/editor/utils/aiCodingAgentInvestigation';
const files=[{path:'/index.ts',content:Array.from({length:50},(_,i)=>`line ${i+1}`).join('\n')}];
const report=(actions=[],extra={})=>JSON.stringify({status:actions.length?'continue':'completed',summary:'The supplied evidence confirms the source issue.',findings:[],limitations:[],actions,...extra});
const success=content=>({success:true,content});
const budget={tokenLimit:160000,durationMs:10000};

test.each(['I will investigate.','I will review,','I will troubleshoot the issue.'])('investigation uses host results and does not accept acknowledgement "%s" as a result',async acknowledgement=>{
    const perform=jest.fn(createInvestigationActions(files,{sourceChecks:()=>({warnings:['Styles are not registered.']}),typecheck:()=>({success:false,diagnostics:['TS2339 render does not exist']})}));
    const ask=jest.fn().mockResolvedValueOnce(success(acknowledgement))
        .mockResolvedValueOnce(success(report([{tool:'typecheck'}])))
        .mockImplementationOnce(async input=>{expect(input.prompt).toContain('TS2339');return success(report([],{findings:[{severity:'error',file:'/index.ts',issue:'Wrong render method.',evidence:'Typechecker: TS2339',repair:'Use the installed method.'}]}));});
    const result=await runCodingInvestigation({prompt:'Investigate why the plugin UI fails',files,ask,perform,budget});
    expect(result.status).toBe('completed');expect(result.findings).toHaveLength(1);expect(ask).toHaveBeenCalledTimes(3);
    expect(result.observations.map(item=>item.action.tool)).toEqual(['sourceChecks','typecheck']);expect(result.budget.spentTokens).toBeGreaterThan(0);
});
test('continues beyond a fixed number of turns while budget and useful observations remain',async()=>{
    let calls=0;
    const ask=jest.fn(async()=>success(++calls<=14?report([{tool:'readFiles',paths:['/index.ts'],startLine:calls,endLine:calls}]):report()));
    const result=await runCodingInvestigation({prompt:'Review implementation',files,ask,perform:createInvestigationActions(files,{sourceChecks:()=>[]}),budget});
    expect(result.status).toBe('completed');expect(calls).toBe(15);expect(result.observations).toHaveLength(15);
});
test('exhaustion returns honest partial findings; repeating a cached check does not rerun it or loop forever',async()=>{
    const perform=jest.fn(()=>({success:true})),ask=jest.fn(async()=>success(report([{tool:'tests'}])));
    const result=await runCodingInvestigation({prompt:'Troubleshoot styles even though tests pass',files,perform,ask,budget:{...budget,tokenLimit:12000}});
    expect(result.status).toBe('partial');expect(result.limitations.join(' ')).toMatch(/budget/);
    expect(perform.mock.calls.filter(([action])=>action.tool==='tests')).toHaveLength(1);expect(ask.mock.calls.length).toBeGreaterThan(1);expect(ask.mock.calls.length).toBeLessThan(12);
});
test('failed actions are observations to analyze, not a successful investigation',async()=>{
    const ask=jest.fn().mockResolvedValueOnce(success(report([{tool:'runtime'}])))
        .mockImplementationOnce(async input=>{expect(input.prompt).toContain('Runtime unavailable');return success(report([],{status:'blocked',limitations:['Cannot inspect runtime.']}));});
    const result=await runCodingInvestigation({prompt:'Diagnose UI startup',files,ask,budget,perform:async action=>{if(action.tool==='runtime')throw new Error('Runtime unavailable');return [];}});
    expect(result.status).toBe('blocked');expect(result.observations).toHaveLength(2);
});
test('rejects arbitrary host access, mutation tools, file traversal and unsafe action parameters',async()=>{
    const perform=createInvestigationActions(files,{tests:jest.fn()});
    for(const action of [{tool:'shell',command:'rm -rf /'},{tool:'readFiles',paths:['/../../host']},{tool:'runtime',pluginId:'another'},{tool:'search',query:'x',paths:['/missing']},{tool:'readFiles',paths:['/index.ts'],startLine:0}])await expect(perform(action)).rejects.toThrow();
    expect(await perform({tool:'search',query:'line 49'})).toMatchObject({matches:[{path:'/index.ts',line:49}]});
});
test('Stop interrupts a pending provider and ignores its late actions',async()=>{
    const controller=new AbortController(),perform=jest.fn(()=>[]),cancel=jest.fn();let resolve;
    const pending=runCodingInvestigation({prompt:'Review',files,perform,budget,signal:controller.signal,cancel,ask:()=>new Promise(done=>{resolve=done;})});
    await Promise.resolve();await Promise.resolve();await Promise.resolve();controller.abort();
    await expect(pending).rejects.toMatchObject({name:'AbortError'});resolve?.(success(report([{tool:'tests'}])));
    await Promise.resolve();expect(perform).toHaveBeenCalledTimes(1);expect(cancel).toHaveBeenCalled();
});
test('wall-clock budget cancels a stalled analysis and preserves a partial outcome',async()=>{
    const cancel=jest.fn();
    const result=await runCodingInvestigation({prompt:'Investigate',files,perform:()=>[],ask:()=>new Promise(()=>{}),cancel,budget:{tokenLimit:48000,durationMs:15}});
    expect(result.status).toBe('partial');expect(result.limitations.join(' ')).toMatch(/time budget/);expect(cancel).toHaveBeenCalledTimes(1);
});
test('budgets scale with source size and intent keeps ordinary explanation and read-only review separate',()=>{
    expect(investigationBudget([{path:'/x',content:'x'.repeat(50000)}]).tokenLimit).toBeGreaterThan(investigationBudget(files).tokenLimit);
    for(const prompt of ['review my plugin styles','investigate the UI failure','why does this plugin not start?','troubleshoot errors','analyze this plugin'])expect(isInvestigationPrompt(prompt)).toBe(true);
    expect(isInvestigationPrompt('How do I debug JavaScript?')).toBe(false);expect(isInvestigationPrompt('Create a calculator plugin')).toBe(false);
    expect(investigationAllowsRepair('Investigate and fix')).toBe(true);expect(investigationAllowsRepair('Review without changes')).toBe(false);
});

test('cancellation immediately before dispatch cannot start another host action',async()=>{
    const controller=new AbortController(),perform=jest.fn(),ask=jest.fn();
    await expect(runCodingInvestigation({prompt:'Investigate',files,perform,ask,budget,signal:controller.signal,
        onProgress:()=>controller.abort()})).rejects.toMatchObject({name:'AbortError'});
    expect(perform).not.toHaveBeenCalled();expect(ask).not.toHaveBeenCalled();
});
test('provider-reported token consumption prevents scheduling another analysis turn',async()=>{
    const ask=jest.fn(async()=>({...success(report([{tool:'typecheck'}])),usage:{input_tokens:100000,output_tokens:100000}}));
    const perform=jest.fn(()=>[]);
    const result=await runCodingInvestigation({prompt:'Investigate',files,perform,ask,budget});
    expect(ask).toHaveBeenCalledTimes(1);expect(result.status).toBe('partial');expect(result.budget.spentTokens).toBeGreaterThanOrEqual(200000);
    expect(perform).toHaveBeenCalledTimes(1);
});

test('runtime observations can refresh as external state changes without rerunning static checks',async()=>{
    let time=0,calls=0,runtimeReads=0;
    const result=await runCodingInvestigation({prompt:'Inspect startup',files,budget:{tokenLimit:160000,durationMs:60000},now:()=>time,
        perform:async action=>action.tool==='runtime'?{ready:++runtimeReads>1}:[],
        ask:async input=>{calls++;time+=6000;if(calls<=2)return success(report([{tool:'runtime'}]));expect(input.prompt).toContain('true');return success(report());}});
    expect(result.status).toBe('completed');expect(runtimeReads).toBe(2);
});

test('continuation reuses saved source and test evidence with a fresh bounded analysis budget',async()=>{
    const finding={severity:'warning',file:'/index.ts',issue:'Missing style registration.',evidence:'Host source check.',repair:'Register styles.'};
    const resume={summary:'Review stopped after tests.',findings:[finding],limitations:['Budget reached.'],
        observations:[{id:'evidence-1',action:{tool:'tests'},result:'{"success":true,"tests":12}'}]};
    const perform=jest.fn(),ask=jest.fn().mockResolvedValueOnce(success(report([{tool:'tests'}])))
        .mockImplementationOnce(async input=>{
            expect(input.prompt).toContain('Missing style registration.');
            expect(input.prompt).toContain('"tests":12');
            return success(report([],{status:'partial',findings:[finding],limitations:['Runtime not inspected.']}));
        });
    const result=await runCodingInvestigation({prompt:'Continue review',files,perform,ask,budget,resume,initialActions:[]});
    expect(perform).not.toHaveBeenCalled();expect(ask).toHaveBeenCalledTimes(2);
    expect(result.budget.carriedObservations).toBe(1);expect(result.budget.tokens).toBeGreaterThan(0);
    expect(result.findings).toEqual([finding]);
});

test('a large multibyte observation cannot consume the final-report reserve or overshoot its allowance',async()=>{
    const ask=jest.fn(async()=>success(report()));
    const result=await runCodingInvestigation({prompt:'Review',files,perform:()=>({source:'界'.repeat(100000)}),ask,
        budget:{tokenLimit:6000,durationMs:10000}});
    expect(result.budget.spentTokens).toBeLessThanOrEqual(6000);
    expect(result.observations[0].result).toContain('truncated');
    expect(result.budget.tokens).toBeGreaterThanOrEqual(4000);
});
