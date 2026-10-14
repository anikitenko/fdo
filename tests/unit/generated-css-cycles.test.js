import {validateGeneratedCssCycles as validate} from '../../src/utils/plugins/validation/generatedCssCycles';
import {getValidationRepairPaths} from '../../src/components/editor/utils/aiCodingAgentPlanRepair';
const files = [
    {path: '/styles/main.css', content: '@import "./layout.css";'},
    {path: '/styles/layout.css', content: '@import "./features.css";'},
    {path: '/styles/features.css', content: '@import "./features/panels.css";'},
    {path: '/styles/features/panels.css', content: '@import "./alerts.css"; .panel {display:block;}'},
    {path: '/styles/features/alerts.css', content: '@import url("./panels.css") screen; .alert {color:red;}'},
];
test('maps the reported nested cycle only to its members', () => {
    const errors = validate(files);
    expect(getValidationRepairPaths(errors, files)).toEqual(['/styles/features/panels.css', '/styles/features/alerts.css']);
    expect(errors[0]).toContain('/styles/features/panels.css -> /styles/features/alerts.css -> /styles/features/panels.css');
});
test('staged validation attributes the cycle only to the writable file', () => {
    const errors = validate([files[4]], files);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^\/styles\/features\/alerts.css:/);
});
test('shared dependencies and repaired cycles do not produce false positives', () => {
    expect(validate(files.map(file => file === files[4] ? {...file, content: '.alert {color:red;}'} : file))).toEqual([]);
    expect(validate([{path: '/a.css', content: '@import "./b.css"; @import "./c.css";'},
        {path: '/b.css', content: '@import "./c.css";'}, {path: '/c.css', content: '.c{}'}])).toEqual([]);
});
test('detects self imports and ignores unresolved and external imports', () => {
    expect(validate([{path: '/a.css', content: '@import "./a.css";'}])).toHaveLength(1);
    expect(validate([{path: '/a.css', content: '@import "./missing.css"; @import "https://example.com/styles.css";'}])).toEqual([]);
});

test('rejects helper back imports before the planned parent has source', () => {
    const helper = {path: '/styles/cards.css', content: '@import "./common.css"; .card {display:grid;}'};
    const errors = validate([helper], [helper], {paths: ['/styles/common.css', helper.path],
        compositions: new Map([['/styles/common.css', [{path: helper.path}]]])});
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('/styles/cards.css -> /styles/common.css -> /styles/cards.css');
});

test('detects indirect imports back to a nested composition ancestor', () => {
    const leaf = {path: '/leaf.css', content: '@import "./root.css";'};
    expect(validate([leaf], [leaf], {paths: ['/root.css', '/middle.css', '/leaf.css'], compositions: new Map([
        ['/root.css', [{path: '/middle.css'}]], ['/middle.css', [{path: '/leaf.css'}]],
    ])})[0]).toContain('/leaf.css -> /root.css -> /middle.css -> /leaf.css');
});
