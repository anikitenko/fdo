import React from 'react';
import {fireEvent, render, screen} from '@testing-library/react';
import {CssLengthEditor} from '../../src/components/live-ui/CssLengthEditor';

test('number and unit controls follow text edits and external Undo/Redo without changing anything on mount', () => {
    const change = jest.fn();
    const {rerender} = render(<CssLengthEditor property="padding" value="12px" onChange={change}/>);
    expect(screen.getByLabelText('Length')).toHaveValue(12);
    expect(screen.getByLabelText('Unit')).toHaveValue('px');
    expect(change).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Length'), {target: {value: '1.5'}});
    expect(change).toHaveBeenLastCalledWith('1.5px');
    fireEvent.change(screen.getByLabelText('Unit'), {target: {value: 'rem'}});
    expect(change).toHaveBeenLastCalledWith('1.5rem');
    expect(screen.getByText(/does not convert/)).toBeVisible();
    rerender(<CssLengthEditor property="margin" value="-2em" onChange={change}/>);
    expect(screen.getByLabelText('Length')).toHaveValue(-2);
    expect(screen.getByLabelText('Length')).not.toHaveAttribute('min');
    expect(screen.getByLabelText('Unit')).toHaveValue('em');
});
test('keeps expressions intact until explicitly replaced', () => {
    const change = jest.fn();
    render(<CssLengthEditor property="padding" value="calc(1rem + 2px)" onChange={change}/>);
    expect(screen.queryByLabelText('Length')).toBeNull();
    expect(screen.getByText(/Your text value is preserved/)).toBeVisible();
    expect(change).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', {name: 'Use a single length'}));
    expect(change).toHaveBeenCalledWith('0px');
});
test('leaves valid multi-side spacing to the side editor without offering a reset', () => {
    const change = jest.fn();
    render(<CssLengthEditor property="padding" value="4px 8px" onChange={change}/>);
    expect(screen.queryByLabelText('CSS length editor')).toBeNull();
    expect(change).not.toHaveBeenCalled();
});
test('lets the user clear and retype a number without replacing text with an invalid value', () => {
    const change = jest.fn(), preview = jest.fn();
    render(<CssLengthEditor property="padding" value="12px" onChange={change} onPreview={preview}/>);
    fireEvent.change(screen.getByLabelText('Length'), {target: {value: ''}});
    expect(screen.getByLabelText('Length')).toHaveValue(null);
    expect(screen.getByLabelText('Length')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Unit')).toBeDisabled();
    expect(change).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByLabelText('Length'), {key: 'Enter'});
    expect(preview).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Length'), {target: {value: '-2'}});
    expect(screen.getByRole('alert')).toHaveTextContent('zero or more');
    expect(change).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Length'), {target: {value: '24'}});
    expect(change).toHaveBeenCalledWith('24px');
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.keyDown(screen.getByLabelText('Length'), {key: 'Enter'});
    expect(preview).toHaveBeenCalledTimes(1);
});
test('offers no widget for unrelated declarations and disables all controls when blocked', () => {
    const change = jest.fn();
    const {rerender} = render(<CssLengthEditor property="color" value="red" onChange={change}/>);
    expect(screen.queryByLabelText('CSS length editor')).toBeNull();
    rerender(<CssLengthEditor property="border-width" value="2px" onChange={change} disabled/>);
    expect(screen.getByLabelText('Length')).toBeDisabled();
    expect(screen.getByLabelText('Unit')).toBeDisabled();
    expect(screen.queryByRole('option', {name: '%'})).toBeNull();
    rerender(<CssLengthEditor property="width" value="auto" onChange={change} disabled/>);
    expect(screen.getByRole('button')).toBeDisabled();
    expect(change).not.toHaveBeenCalled();
});
