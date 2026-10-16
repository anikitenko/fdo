import React, {useState} from 'react';
import {fireEvent, render, screen} from '@testing-library/react';
import {CssSpacingEditor} from '../../src/components/live-ui/CssSpacingEditor';

function Controlled({initial = '4px 8px', property = 'padding', onChange = jest.fn(), onPreview}) {
    const [value, setValue] = useState(initial);
    return <><output aria-label="CSS text">{value}</output><CssSpacingEditor property={property} value={value}
        onChange={next => {setValue(next); onChange(next);}} onPreview={onPreview}/></>;
}
test('expands shorthand and updates one side without changing the others or previewing automatically', () => {
    const change = jest.fn(), preview = jest.fn();
    render(<Controlled onChange={change} onPreview={preview}/>);
    expect(screen.getByLabelText('Top')).toHaveValue('4px');
    expect(screen.getByLabelText('Right')).toHaveValue('8px');
    expect(screen.getByLabelText('Bottom')).toHaveValue('4px');
    expect(screen.getByLabelText('Left')).toHaveValue('8px');
    expect(change).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Left'), {target: {value: '2rem'}});
    expect(screen.getByLabelText('CSS text')).toHaveTextContent('4px 8px 4px 2rem');
    expect(preview).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByLabelText('Left'), {key: 'Enter'});
    expect(preview).toHaveBeenCalledTimes(1);
});
test('invalid and temporarily empty sides stay editable without losing valid CSS or sibling inputs', () => {
    const preview = jest.fn();
    render(<Controlled onPreview={preview}/>);
    fireEvent.change(screen.getByLabelText('Left'), {target: {value: ''}});
    fireEvent.change(screen.getByLabelText('Top'), {target: {value: '12px'}});
    expect(screen.getByLabelText('Top')).toHaveValue('12px');
    expect(screen.getByLabelText('CSS text')).toHaveTextContent('4px 8px');
    expect(screen.getByLabelText('Left')).toHaveAttribute('aria-invalid', 'true');
    fireEvent.keyDown(screen.getByLabelText('Top'), {key: 'Enter'});
    expect(preview).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Left'), {target: {value: '1px 2px'}});
    expect(screen.getByLabelText('Left')).toHaveAttribute('aria-invalid', 'true');
    fireEvent.change(screen.getByLabelText('Left'), {target: {value: '-1px'}});
    expect(screen.getByRole('alert')).toHaveTextContent('without negative');
    fireEvent.change(screen.getByLabelText('Left'), {target: {value: '2rem'}});
    expect(screen.getByLabelText('CSS text')).toHaveTextContent('12px 8px 4px 2rem');
    expect(screen.queryByRole('alert')).toBeNull();
});
test('accepts automatic and negative margins but does not decode expressions or unrelated properties', () => {
    const change = jest.fn();
    const {rerender} = render(<CssSpacingEditor property="margin" value="-2px auto" onChange={change}/>);
    expect(screen.getByLabelText('Left')).toHaveValue('auto');
    fireEvent.change(screen.getByLabelText('Top'), {target: {value: '-4px'}});
    expect(change).toHaveBeenCalledWith('-4px auto -2px');
    rerender(<CssSpacingEditor property="padding" value="var(--space)" onChange={change}/>);
    expect(screen.queryByLabelText('Top')).toBeNull();
    expect(screen.getByText(/no sides have been replaced/)).toBeInTheDocument();
    rerender(<CssSpacingEditor property="gap" value="4px 8px" onChange={change}/>);
    expect(screen.queryByText('Spacing sides')).toBeNull();
});
test('follows external text/Undo values and disables all side controls when blocked', () => {
    const change = jest.fn();
    const {rerender} = render(<CssSpacingEditor property="padding" value="4px 8px" onChange={change}/>);
    rerender(<CssSpacingEditor property="padding" value="1rem 2rem 3rem 4rem" onChange={change} disabled/>);
    expect(screen.getByLabelText('Top')).toHaveValue('1rem');
    expect(screen.getByLabelText('Left')).toHaveValue('4rem');
    for (const label of ['Top', 'Right', 'Bottom', 'Left']) expect(screen.getByLabelText(label)).toBeDisabled();
    expect(change).not.toHaveBeenCalled();
});
