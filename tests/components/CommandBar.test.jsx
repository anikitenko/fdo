import React from 'react';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {CommandBar} from '../../src/components/CommandBar';

test('finds a plugin action by its description and excludes unrelated commands', async () => {
    const perform = jest.fn();
    render(<CommandBar show setShow={() => {}} actions={[
        {id: 'inspect', name: 'Inspect', subtitle: 'Validate deployment configuration', keywords: 'deployment configuration', section: 'Tools', perform},
        {id: 'unrelated', name: 'Unrelated', section: 'Other', perform: jest.fn()},
    ]}/>);
    fireEvent.change(screen.getByPlaceholderText('Search commands...'), {target: {value: 'deployment'}});
    await waitFor(() => expect(screen.queryByText('Unrelated')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('menuitem', {name: /Inspect/}));
    expect(perform).toHaveBeenCalledTimes(1);
});
