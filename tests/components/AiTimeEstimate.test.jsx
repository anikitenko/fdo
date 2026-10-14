import React from 'react';
import {render, screen} from '@testing-library/react';
import AiTimeEstimate from '../../src/components/ai/AiTimeEstimate';

test('keeps the central estimate visible and the range collapsed by default', () => {
    render(<AiTimeEstimate text="About 12 min remaining · Low confidence"
        progress="8 of 24 files complete in this pass" details="Observed range: 5–22 min."/>);
    expect(screen.getByText('About 12 min remaining · Low confidence')).toBeVisible();
    expect(screen.getByText('8 of 24 files complete in this pass')).toBeVisible();
    expect(screen.getByText('Estimate details')).toBeVisible();
    expect(screen.getByText('Observed range: 5–22 min.')).not.toBeVisible();
});

test('does not keep obsolete details when timing becomes unavailable', () => {
    const {rerender} = render(<AiTimeEstimate text="About 12 min remaining" details="Observed range: 5–22 min."/>);
    rerender(<AiTimeEstimate text="Waiting for more response text."/>);
    expect(screen.queryByText('Estimate details')).toBeNull();
    expect(screen.queryByText('Observed range: 5–22 min.')).toBeNull();
});
