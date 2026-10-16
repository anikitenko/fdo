import React from 'react';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {CssPropertyPicker} from '../../src/components/live-ui/CssPropertyPicker';

test('Blueprint picker filters by semantic terms and selects the first match with Enter', async () => {
    const onSelect = jest.fn();
    render(<CssPropertyPicker properties={['border-radius', 'background-color', 'text-shadow']} style={{canAddDeclarations: true, declarations: [], presentProperties: []}} value="" onSelect={onSelect}/>);
    const input = screen.getByRole('combobox', {name: 'CSS property'});
    fireEvent.focus(input);
    fireEvent.change(input, {target: {value: 'round corners'}});
    await screen.findByRole('option', {name: /border-radius/});
    expect(screen.queryByRole('option', {name: /background-color/})).not.toBeInTheDocument();
    fireEvent.keyDown(input, {key: 'Enter', code: 'Enter', keyCode: 13});
    fireEvent.keyUp(input, {key: 'Enter', code: 'Enter', keyCode: 13});
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith('border-radius', ''));
});
test('ambiguous base rules offer only existing declarations and show a useful empty result', async () => {
    render(<CssPropertyPicker properties={['border-radius', 'text-shadow']} style={{canAddDeclarations: false, declarations: [{property: 'color', value: 'red'}], presentProperties: ['color']}} value="color" onSelect={jest.fn()}/>);
    const input = screen.getByRole('combobox', {name: 'CSS property'});
    fireEvent.focus(input);
    fireEvent.change(input, {target: {value: 'text shadow'}});
    expect(await screen.findByText('No matching properties')).toBeVisible();
});
