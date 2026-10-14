import React from 'react';
import {render, screen} from '@testing-library/react';
import AiCodingConfidence from '../../src/components/ai/AiCodingConfidence';
import {aiCodingConfidence, pluginTestsVerificationCheck} from '../../src/utils/ai/assistant/aiCodingConfidence';
const checks = ['contracts', 'types', 'build', 'tests', 'acceptance'].map(id => ({id, label: id, status: 'passed'}));
test('shows honest uncertainty before verification, with accessible evidence details', () => {
    render(<AiCodingConfidence confidence={aiCodingConfidence()}/>);
    expect(screen.getByRole('status').textContent).toContain('Not yet assessed');
    expect(screen.getByText('What supports this?')).toBeTruthy();
});
test('requires all five groups before showing strong evidence', () => {
    for (const id of checks.map(check => check.id)) {
        expect(aiCodingConfidence({checks: checks.map(check => check.id === id ? {...check, status: 'not-run'} : check)}).label).toBe('Limited evidence');
    }
    expect(aiCodingConfidence({checks}).label).toBe('Strong evidence');
});
test('failures override passed checks and pending checks do not imply confidence', () => {
    expect(aiCodingConfidence({checks}, 'Request failed').label).toBe('Needs attention');
    expect(aiCodingConfidence({checks: [{id: 'build', status: 'failed'}]}).label).toBe('Needs attention');
    expect(aiCodingConfidence({checks: [{id: 'build', status: 'running'}]}).label).toBe('Checking');
});
test('shows security audit limitations alongside completed verification', () => {
    render(<AiCodingConfidence confidence={aiCodingConfidence({checks: [...checks, {id: 'security', label: 'Dedicated security audit', status: 'not-run'}]})}/>);
    expect(screen.getByRole('status').textContent).toContain('Strong evidence');
    expect(screen.getByText('Dedicated security audit: not-run')).toBeTruthy();
    expect(screen.getByText(/not a correctness guarantee/)).toBeTruthy();
});

test('distinguishes active work from an unverified completed response', () => {
    expect(aiCodingConfidence(undefined, '', {active: true}).label).toBe('Checking');
    expect(aiCodingConfidence(undefined, '', {hasResponse: true}).label).toBe('Not verified');
    expect(aiCodingConfidence({checks: [{id: 'tests', status: 'not-run'}]}).label).toBe('Not verified');
});

test('uses actual host test outcomes and does not count skipped tests as passing', () => {
    const passed = pluginTestsVerificationCheck({success: true});
    expect(aiCodingConfidence({checks: [passed]}).label).toBe('Limited evidence');
    const skipped = pluginTestsVerificationCheck({success: true, skipped: true});
    expect(aiCodingConfidence({checks: [skipped]}).label).toBe('Not verified');
    const failed = pluginTestsVerificationCheck({success: false, error: 'Assertion failed'});
    expect(aiCodingConfidence({checks: [failed]}).label).toBe('Needs attention');
});
