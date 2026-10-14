import {createPluginGuideReview} from '../../src/utils/plugins/authoring/pluginGuideReview';
const file = {path: '/SKILL.md', content: 'guide'};
const setup = env => {
    const callbacks = {manualReview: jest.fn(async () => 'manual approval'), manualRecover: jest.fn(async () => ({action: 'edit'})),
        approve: jest.fn(() => 'validated approval'), onRetry: jest.fn()};
    return {...callbacks, ...createPluginGuideReview({env, ...callbacks})};
};
test.each([{}, {FDO_E2E: '1'}, {FDO_E2E_LIVE_AI: '1'}, {FDO_E2E: '0', FDO_E2E_LIVE_AI: '1'}])('normal runs retain manual approval (%p)', async env => {
    const review = setup(env);
    expect(await review.reviewSkill(file)).toBe('manual approval');
    expect(await review.recover({errors: {acceptance: 'invalid'}})).toEqual({action: 'edit'});
    expect(review.approve).not.toHaveBeenCalled();
});
test('live runs approve without UI and allow one proposal recovery per request', async () => {
    const review = setup({FDO_E2E: '1', FDO_E2E_LIVE_AI: '1'});
    expect(await review.reviewSkill(file)).toBe('validated approval');
    const proposal = {errors: {acceptance: 'requirement quote is invalid'}};
    expect(await review.recover(proposal)).toEqual({action: 'retry'});
    await expect(review.recover(proposal)).rejects.toThrow('requirement quote is invalid');
    expect(review.onRetry).toHaveBeenCalledTimes(1);
    expect(review.manualReview).not.toHaveBeenCalled();
    expect(review.manualRecover).not.toHaveBeenCalled();
});
test('automatic approval propagates validation failure', () => {
    const review = createPluginGuideReview({env: {FDO_E2E: '1', FDO_E2E_LIVE_AI: '1'},
        approve: () => {throw new Error('Invalid guide');}});
    expect(() => review.reviewSkill(file)).toThrow('Invalid guide');
});
