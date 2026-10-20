const {utils} = require('ssh2');

// Classic OpenSSH ed25519 material for encrypted-key fixtures. Live generation
// uses src/utils/hostServices/sshKeys.cjs so OpenSSL PKCS8 encodings stay
// compatible with ssh2.
const host = {
    private: `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtz
c2gtZWQyNTUxOQAAACDP2bWNxeLettxEUsBgAWjYKjYwEp/g8fJXTzmhJpIBXwAA
AIjkjP2b5Iz9mwAAAAtzc2gtZWQyNTUxOQAAACDP2bWNxeLettxEUsBgAWjYKjYw
Ep/g8fJXTzmhJpIBXwAAAECeeY1GxuGUfXzD6OPqzY/oJaNuNsFXl5tWRn5wuJHI
zc/ZtY3F4t623ERSwGABaNgqNjASn+Dx8ldPOaEmkgFfAAAAAAECAwQF
-----END OPENSSH PRIVATE KEY-----
`,
    public: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIM/ZtY3F4t623ERSwGABaNgqNjASn+Dx8ldPOaEmkgFf',
};
const work = {
    private: `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAACmFlczI1Ni1jYmMAAAAGYmNyeXB0AAAAGAAAABBO
rkpINs42FWq0eKkV/0uuAAAAAQAAAAEAAAAzAAAAC3NzaC1lZDI1NTE5AAAAIJKb
gMfRF/ta2jnPBZK4nqXiHIuVcPhTyo4lRcL28AMSAAAAkHPYpQNXqdYUN965m4rP
3QfWhidm+CJcxcEfiLUeLeVQd/dD/cgeiSZrt2GYDWIArkD3+lpfEQ/oMENxGh9F
Zxjmca4nAwxqCYYeVCbUU1LARsA6ghbCC9Eu7Kxwzr/GiQkdkYZg713mhngMZ4uP
Uq8v/RRU4UQw2Rd2x7h08wmIvAj0wq2GMJZyxSaGYXMZvw==
-----END OPENSSH PRIVATE KEY-----
`,
    public: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJKbgMfRF/ta2jnPBZK4nqXiHIuVcPhTyo4lRcL28AMS',
    passphrase: 'work phrase',
};
const personal = {
    private: `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAACmFlczI1Ni1jYmMAAAAGYmNyeXB0AAAAGAAAABC9
yVZYw0XN2fXVfc03n+4+AAAAAQAAAAEAAAAzAAAAC3NzaC1lZDI1NTE5AAAAIAsO
z9U6DPto6Ngdh2e3j5rmNiOlbrwyuexsfzJzm2xFAAAAkNk61qPq5vkNX9+kf4IR
42pBT6tN7jGOHiLt6qrnxVS3hcpF3I8n2Jy2YD9VIuZfTYYOByPqt4eEABOtGm/4
A3ObB4eSlvYcPXHthic4sZBiopnr5XPhX0M8F/FbZ4WYBL4zKVTtXfB93+QCDUlx
zmglO2j4E2LdoNNHjZjyCAm13XqUWBECzJpLLsKYL3vhJQ==
-----END OPENSSH PRIVATE KEY-----
`,
    public: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAsOz9U6DPto6Ngdh2e3j5rmNiOlbrwyuexsfzJzm2xF',
    passphrase: 'personal phrase',
};

function parsedKey(material, passphrase) {
    const parsed = utils.parseKey(material, passphrase);
    if (parsed instanceof Error) throw parsed;
    return Array.isArray(parsed) ? parsed[0] : parsed;
}

module.exports = {host, work, personal, parsedKey};
