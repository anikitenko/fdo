import React from 'react';
import {fireEvent, render, screen} from '@testing-library/react';
import {AttributeEditor} from '../../src/components/live-ui/AttributeEditor';

const fields = [
    {name: 'aria-label', label: 'Accessible label', present: false, editable: true, value: ''},
    {name: 'title', label: 'Tooltip', present: true, editable: false, value: 'Managed', reason: 'This tooltip is managed by the click-action connection.'},
];
const open = () => fireEvent.click(screen.getByText('Element attributes', {exact: true}));
test('Enter previews a literal attribute and empty versus missing remains distinct', () => {
    const propose = jest.fn();
    const {rerender} = render(<AttributeEditor element={{editableAttributes: fields}} onPropose={propose}/>);
    open();
    fireEvent.change(screen.getByLabelText('Attribute value'), {target: {value: 'JSON source'}});
    fireEvent.keyDown(screen.getByLabelText('Attribute value'), {key: 'Enter'});
    expect(propose).toHaveBeenCalledWith({kind: 'attribute', attribute: 'aria-label', action: 'set', value: 'JSON source'});
    fireEvent.keyDown(screen.getByLabelText('Attribute value'), {key: 'Enter', repeat: true});
    expect(propose).toHaveBeenCalledTimes(1);
    rerender(<AttributeEditor element={{editableAttributes: [{...fields[0], present: true, value: ''}, fields[1]]}} onPropose={propose}/>);
    expect(screen.getByRole('button', {name: 'Preview attribute'})).toBeDisabled();
    expect(screen.getByRole('button', {name: 'Remove attribute'})).toBeEnabled();
    fireEvent.click(screen.getByRole('button', {name: 'Remove attribute'}));
    expect(propose).toHaveBeenLastCalledWith({kind: 'attribute', attribute: 'aria-label', action: 'remove', value: ''});
});

test('managed fields explain their read-only state and disabled operations cannot submit', () => {
    const propose = jest.fn();
    const {rerender} = render(<AttributeEditor element={{editableAttributes: fields}} onPropose={propose}/>);
    open();
    fireEvent.change(screen.getByLabelText('Attribute'), {target: {value: 'title'}});
    expect(screen.getByLabelText('Attribute value')).toBeDisabled();
    expect(screen.getByText(fields[1].reason)).toBeVisible();
    expect(screen.getByRole('button', {name: 'Remove attribute'})).toBeDisabled();
    rerender(<AttributeEditor element={{editableAttributes: fields}} onPropose={propose} disabled/>);
    expect(screen.getByLabelText('Attribute')).toBeDisabled();
    expect(screen.getByRole('button', {name: 'Preview attribute'})).toBeDisabled();
    expect(propose).not.toHaveBeenCalled();
});

test('a corrected control-character value clears the accessible validation error', () => {
    render(<AttributeEditor element={{editableAttributes: fields}} onPropose={jest.fn()}/>);
    open();
    fireEvent.change(screen.getByLabelText('Attribute value'), {target: {value: 'bad\u0000value'}});
    expect(screen.getByRole('alert')).toHaveTextContent('500 characters');
    expect(screen.getByLabelText('Attribute value')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Attribute value')).toHaveAttribute('aria-describedby', expect.stringContaining('visual-attribute-error'));
    fireEvent.change(screen.getByLabelText('Attribute value'), {target: {value: 'Configuration JSON'}});
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByLabelText('Attribute value')).toHaveAttribute('aria-invalid', 'false');
    expect(screen.getByRole('button', {name: 'Preview attribute'})).toBeEnabled();
});

test('a long computed value is inspectable without reporting an editable-input validation error', () => {
    render(<AttributeEditor element={{editableAttributes: [{...fields[0], present: true, editable: false, value: 'x'.repeat(600), reason: 'Computed in code'}]}} onPropose={jest.fn()}/>);
    open();
    expect(screen.getByLabelText('Attribute value')).toHaveValue('x'.repeat(600));
    expect(screen.getByLabelText('Attribute value')).toBeDisabled();
    expect(screen.queryByRole('alert')).toBeNull();
});
