import {certificateDisplayName} from '../../src/utils/system/certificateDisplay';
test.each([
    ['CN=Alex\nO=Example Team\nC=UA', 'Alex · Example Team'],
    ['CN=Alex, O=Example Team, OU=Engineering', 'Alex · Example Team · Engineering'],
    ['CN="Doe, Alex",O=Example', 'Doe, Alex · Example'],
    ['CN=Doe\\, Alex,O=Example', 'Doe, Alex · Example'],
    ['root', 'root'],
    ['Signing certificate', 'Signing certificate'],
])('formats %s as %s', (subject, expected) => expect(certificateDisplayName(subject)).toBe(expected));

test('account identifiers are labeled as technical details instead of used as the display name', () => {
    const {certificateInformation} = require('../../src/utils/system/certificateDisplay');
    const info = certificateInformation({kind: 'developer', label: 'CN=f4282428-2001-70a5-a03d-9658eb262ac9\nO=FDO Plugin Registry Developers'});
    expect(info).toMatchObject({name: 'Developer signing certificate', organization: 'FDO Plugin Registry Developers', accountId: 'f4282428-2001-70a5-a03d-9658eb262ac9'});
});
