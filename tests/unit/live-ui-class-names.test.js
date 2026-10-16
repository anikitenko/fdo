import {classNameError} from '../../src/utils/plugins/authoring/liveUi/classNames';

test.each(['primary-button', 'button_2', 'Button', 'x'.repeat(80)])('accepts the supported class name %s', name => {
    expect(classNameError(name)).toBe('');
});
test.each([
    ['', 'Enter a class name'], ['.button', 'leading dot'], ['two words', 'without spaces'],
    ['2button', 'Start'], ['bad;rule', 'punctuation'], ['x'.repeat(81), '80'],
    ['constructor', 'reserved'], ['prototype', 'reserved'], ['__proto__', 'reserved'], [null, 'Enter a class name'],
])('explains how to correct %s', (name, message) => expect(classNameError(name)).toContain(message));
