/** @jest-environment node */
import path from 'node:path';
import {resolveCliProfile} from '../../src/utils/system/cliProfile';

test('named profiles resolve under the default profile and leave command operands intact', () => {
    const base = path.resolve('user-data');
    expect(resolveCliProfile(['--profile', 'development', 'deploy', './plugin', '--label', 'root'], base)).toEqual({name: 'development', directory: path.join(base, 'profiles', 'development'), args: ['deploy', './plugin', '--label', 'root']});
    expect(resolveCliProfile(['--json', '--profile=qa', 'plugins', 'list'], base)).toMatchObject({name: 'qa', args: ['--json', 'plugins', 'list']});
    expect(resolveCliProfile(['--profile', 'default', 'doctor'], base)).toMatchObject({name: 'default', directory: base, args: ['doctor']});
    expect(resolveCliProfile(['compile', '--', '--profile=qa'], base)).toMatchObject({name: 'default', args: ['compile', '--', '--profile=qa']});
});
test.each([[], ['../outside'], ['/tmp/other'], ['UPPER'], ['two words'], ['a'.repeat(49)], ['qa', '--profile', 'other']])('invalid or duplicate profile selections are rejected: %j', (...args) => {
    expect(() => resolveCliProfile(['--profile', ...args], path.resolve('user-data'))).toThrow();
});
