import React from 'react';
import {fireEvent, render, screen} from '@testing-library/react';
import {CssColorPicker} from '../../src/components/live-ui/CssColorPicker';
import {parseCssColor} from '../../src/utils/plugins/authoring/liveUi/cssColors';

test('color and opacity choices update the text value and follow external Undo/Redo values', () => {
    const change = jest.fn();
    const {rerender} = render(<CssColorPicker property="color" value="rgba(255,0,0,.5)" onChange={change}/>);
    expect(screen.getByLabelText('Color')).toHaveValue('#ff0000');
    expect(screen.getByRole('slider', {name: 'Color opacity'})).toHaveAttribute('aria-valuetext', '50%');
    expect(change).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Color'), {target: {value: '#336699'}});
    expect(change).toHaveBeenLastCalledWith('#33669980');
    fireEvent.change(screen.getByRole('slider'), {target: {value: '0'}});
    expect(change).toHaveBeenLastCalledWith('#ff000000');
    rerender(<CssColorPicker property="color" value="#00ff00" onChange={change}/>);
    expect(screen.getByLabelText('Color')).toHaveValue('#00ff00');
    expect(screen.getByRole('slider')).toHaveValue('100');
});
test('variables remain unchanged until explicitly replaced, including a solid-black choice', () => {
    const change = jest.fn();
    render(<CssColorPicker property="background-color" value="var(--brand)" onChange={change}/>);
    expect(screen.getByText(/Your text value is preserved/)).toBeVisible();
    expect(change).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', {name: 'Use solid black'}));
    expect(change).toHaveBeenCalledWith('#000000');
});
test('noncolor properties have no picker, and disabled controls cannot change draft input', () => {
    const change = jest.fn();
    const {rerender} = render(<CssColorPicker property="padding" value="4px" onChange={change}/>);
    expect(screen.queryByLabelText('Color')).toBeNull();
    rerender(<CssColorPicker property="color" value="currentColor" onChange={change} disabled/>);
    expect(screen.getByLabelText('Color')).toBeDisabled();
    expect(screen.getByRole('slider')).toBeDisabled();
    expect(screen.getByRole('button', {name: 'Use solid black'})).toBeDisabled();
    expect(change).not.toHaveBeenCalled();
});
test('browser normalization reads named/HSL colors without altering text or retaining helper elements', () => {
    const before = document.querySelectorAll('span').length;
    expect(parseCssColor('rebeccapurple', document)).toEqual({hex: '#663399', alpha: 1});
    expect(parseCssColor('hsl(120, 100%, 50%)', document)).toEqual({hex: '#00ff00', alpha: 1});
    expect(parseCssColor('inherit', document)).toBeNull();
    expect(document.querySelectorAll('span')).toHaveLength(before);
});
