async function ensureRootSigningCertificate(page) {
    let certificates = await page.evaluate(() => window.electron.settings.certificates.getRoot());
    let root = certificates.find(certificate => certificate.label === 'root' && certificate.hasPrivateKey);
    if (!root) {
        await page.evaluate(() => window.electron.settings.certificates.create('root'));
        certificates = await page.evaluate(() => window.electron.settings.certificates.getRoot());
        root = certificates.find(certificate => certificate.label === 'root' && certificate.hasPrivateKey);
    }
    if (!root) throw new Error('The E2E profile could not create a root signing certificate.');
    return root;
}

module.exports = {ensureRootSigningCertificate};
