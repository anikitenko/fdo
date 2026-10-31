import {retainWorkspaceReview, assertWorkspaceReviewCurrent, reviewRepairDisposition, deferredReviewRepairMessage} from '../../src/components/editor/utils/aiWorkspaceReviewRecovery';

const files=[{path:'/view.ts',content:'export const ready=true;'}];
const report={status:'partial',summary:'Review stopped.',limitations:['Runtime unverified.'],
    findings:[{severity:'warning',file:'/view.ts',issue:'Missing styles.',evidence:'No registration.',repair:'Register styles.'}],
    budget:{tokens:0,milliseconds:0}};

test('exhaustion preserves confirmed findings and offers a separate explicitly requested repair',()=>{
    expect(reviewRepairDisposition(report)).toBe('budget');
    expect(deferredReviewRepairMessage(report,'budget')).toContain('1 confirmed finding(s) are saved');
    expect(deferredReviewRepairMessage(report,'budget')).not.toContain('No confirmed issues');
    expect(reviewRepairDisposition(report,{freshRequest:true})).toBe('repair');
    expect(reviewRepairDisposition({...report,status:'blocked'},{freshRequest:true})).toBe('blocked');
    expect(reviewRepairDisposition({...report,findings:[]})).toBe('empty');
});

test('saved review remains independent of later report mutations',()=>{
    const retained=retainWorkspaceReview({report,files,workspace:'plugin',revision:2,prompt:'Review',tests:{success:true}});
    retained.report.findings[0].issue='Changed';
    expect(report.findings[0].issue).toBe('Missing styles.');
    expect(()=>assertWorkspaceReviewCurrent(retained,{files:[...files],workspace:'plugin',revision:2})).not.toThrow();
    for(const current of [
        {files:[{...files[0],content:'new content'}],workspace:'plugin',revision:2},
        {files,workspace:'different',revision:2},
        {files,workspace:'plugin',revision:3},
    ])expect(()=>assertWorkspaceReviewCurrent(retained,current)).toThrow('workspace changed since this review');
});
