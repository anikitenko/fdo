const accountIdentifier = value => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);

export function certificateSubjectFields(value) {
    return [...String(value || '').matchAll(/(?:^|[,\n/])\s*([\w.]+)\s*=\s*("(?:[^"\\]|\\.)*"|(?:\\.|[^,\n/])*)/g)]
        .map(([, key, content]) => [key, content.replace(/^"|"$/g, '').replace(/\\(.)/g, '$1').trim()]);
}

export function certificateInformation(cert) {
    const fields = certificateSubjectFields(cert.label);
    const value = key => fields.find(([name]) => name === key)?.[1];
    const commonName = value('CN');
    const developer = cert.kind === 'developer' || cert.scope === 'registry' && !cert.official;
    return {
        name: commonName && !accountIdentifier(commonName) ? commonName
            : developer && (fields.length || accountIdentifier(cert.label)) ? 'Developer signing certificate'
            : certificateDisplayName(cert.label),
        organization: value('O') || value('ON'),
        team: value('OU'),
        email: value('emailAddress'),
        accountId: commonName && accountIdentifier(commonName) ? commonName : undefined,
    };
}

// Certificate subjects may use newline-separated or RFC 2253 comma-separated fields.
export function certificateDisplayName(value) {
    const text = String(value || '').trim();
    if (!/(?:^|[,\n/])\s*(?:CN|O|OU|ON|C|ST|L|emailAddress)\s*=/.test(text)) return text;
    const fields = certificateSubjectFields(text);
    const useful = ['CN', 'O', 'ON', 'OU', 'emailAddress'].flatMap(key => fields.filter(([name]) => name === key).map(([, content]) => content));
    return [...new Set(useful.length ? useful : fields.map(([, content]) => content))].filter(value => value && !accountIdentifier(value)).join(' · ');
}

export const signingCertificateValue = cert => cert.scope === 'registry' ? `registry:${cert.id}` : cert.label;
