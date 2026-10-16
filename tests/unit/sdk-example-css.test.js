/** @jest-environment node */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {compileSdkExample} = require("../e2e/helpers/sdkExamples");

test('SDK examples compile CSS imports using the host style-map contract', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fdo-sdk-css-fixture-'));
  try {
    const absPath = path.join(root, 'index.ts');
    fs.writeFileSync(absPath, "import styles from './styles.css'; export default styles;");
    fs.writeFileSync(path.join(root, 'styles.css'), "@import './base.css'; .shell { background: #123456; }");
    fs.writeFileSync(path.join(root, 'base.css'), '.base { padding: 13px; }');
    const code = await compileSdkExample({absPath, relativePath: 'css-fixture/index.ts'});
    expect(code).toContain('#123456');
    expect(code).toContain('13px');
    expect(code).not.toContain("@import './base.css'");
  } finally {fs.rmSync(root, {recursive: true, force: true});}
});
