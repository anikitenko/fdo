# Implement an FDO-compatible plugin registry

This is the public desktop-facing contract for an independently implemented
registry. It requires no access to the private production infrastructure repo.
Use it with [the hosting guide](PRIVATE_REGISTRIES.md). The desktop repo contains
validators and test fixtures, not a deployable server. Match the FDO revision you
support and run interoperability tests when updating either implementation.

The JSON below is schematic: PEMs, digests, signatures, nonces and times must be
generated from your own service state. Placeholder strings are not valid protocol
values. For real signed examples, use
[registryLifecycleFixture](../tests/helpers/registryLifecycleFixture.js) in tests.
Its generated keys are disposable test keys, not production authorities.

## Common encoding and transport

- Use one HTTPS origin, with no credentials in the URL. Return JSON for API
  responses, PEM for the root endpoint and ZIP bytes for packages. Desktop fetches
  reject redirects; API routes must not fall through to the portal's HTML shell.
- Desktop calls do not send a browser session or cloud IAM token. Restrict private
  reads at the network boundary; authenticate account/publication actions separately.
- Use UTC ISO 8601 times. Synchronize server clocks. Serve signed trust/status
  responses without caching; do not strip or cache over the `nonce` query parameter.
- Desktop API requests have a ten-second deadline and a 128 KiB response limit;
  the trust document allows 512 KiB. Archive downloads allow thirty seconds.
  Measure the complete JSON envelope, including the duplicated proof result;
  publication must not create metadata too large for its release-status response.
- A **certificate fingerprint** is lowercase SHA-256 hex over DER certificate bytes.
  A **public-key fingerprint** is lowercase SHA-256 hex over DER SPKI public-key bytes.
  Both are 64 hex characters. The manually pinned root uses the certificate fingerprint.
- Canonical JSON recursively sorts object keys, preserves array order, and emits
  compact JSON. Use [stableStringify](../src/utils/system/registrySigning.js), not
  ordinary insertion-order JSON serialization. Sign its UTF-8 bytes with RSA
  PKCS#1 v1.5 / SHA-256. Return signatures as base64 of raw signature bytes.

## Root and trust history

`GET /api/v1/registry/certificate` returns the current public self-signed root CA
PEM. It never returns a private key.

`GET /api/v1/registry/trust` returns:

```json
{
  "payload": {
    "format": "fdo-registry-trust-v1",
    "sequence": 1,
    "issuedAt": "CURRENT_UTC_TIME",
    "expiresAt": "FUTURE_UTC_TIME",
    "activeRoot": "ROOT_CERTIFICATE_SHA256",
    "roots": [{"pem": "ROOT_CERTIFICATE_PEM", "status": "active"}],
    "issuers": [{"pem": "ISSUER_CERTIFICATE_PEM", "status": "active"}],
    "transitions": []
  },
  "signature": "ROOT_SIGNATURE_OF_CANONICAL_PAYLOAD"
}
```

The active root signs `payload`. Initially its certificate fingerprint must match
the administrator's independently supplied pin. Persist sequence and issuance
history durably: the client rejects sequence/time rollback. Trust validity must
not exceed 49 hours, and the document must not be expired. Refresh it well before
expiry, even when no certificate changes occur.

Authority statuses are `active`, `retired` or `revoked`. Preserve historical
authorities needed by valid chains; do not remove history on each refresh.
The validator accepts up to 64 roots, 128 issuers and 64 transitions per document.
Revocation applies to certificates sharing the authority's public key.

For a planned root change, include a transition with these payload fields:
`format: "fdo-root-transition-v1"`, `from`, `to` (certificate fingerprints),
`sequence` and `notBefore`. Its `signature` is made by the previous root over the
canonical transition payload. Include both root certificates and publish the
transition while the previous root is valid. Order transition sequences strictly
and do not exceed the enclosing document sequence. The new active root signs the
enclosing trust payload. A compromised root cannot authenticate its own recovery;
distribute a replacement pin through an independent administrative process.

See [validateTrustDocument](../src/utils/system/registryTrust.js) for exact checks.

## Developer identity status and issuance

`GET /api/v1/certificates/{public-key-sha256}?nonce={request-nonce}` returns a
certificate result with a signed proof. An active result contains:

```json
{
  "fingerprint": "DEVELOPER_PUBLIC_KEY_SHA256",
  "status": "active",
  "developerSub": "STABLE_ACCOUNT_SUBJECT",
  "certificatePem": "DEVELOPER_LEAF_PEM",
  "certificateChainPem": "LEAF_PEM_FOLLOWED_BY_ISSUER_CHAIN"
}
```

This object is the `result` in the proof structure below; return the same fields
at the response's top level, followed by `proof`. The key fingerprint must match
both the requested identity and the leaf's public key. The leaf must match the
first certificate in the validated chain. Its issuer must be present and not
revoked in the trust document.

Developer leaves require `CA=false`, digital-signature key usage, code-signing EKU
`1.3.6.1.5.5.7.3.3`, current validity, and RSA public keys of 2048–4096 bits.
Use an account-authenticated portal/CSR flow to issue them. Initial issuance and
account recovery endpoints are application-defined; the desktop imports PEM files
and calls the status/renewal routes here. Keep private developer keys on the
developer's machine. Never expose root/issuer keys to the portal or desktop.

An unknown public key must return HTTP 404, including a pending renewal key not
yet issued. For a known revoked or expired identity, return its actual state;
the desktop blocks signing. Never fabricate `active` to hide a service outage.

## Nonce-bound status proofs

Both certificate and release results use this envelope:

```text
response = {
  ...result,
  proof: {
    payload: {
      format: "fdo-registry-status-v1",
      kind: "certificate" or "release",
      nonce: exact request nonce,
      issuedAt: current UTC time,
      expiresAt: short future UTC time,
      result: exact result object
    },
    issuerFingerprint: signing issuer's certificate SHA-256,
    signature: issuer signature of canonical proof.payload
  }
}
```

The status signer must be an active, currently valid CA issuer in the root-signed
trust document and chain to a trusted root. Use the corresponding issuer key,
not an unrelated service signing key. `proof.payload.result` must match all
top-level response fields other than `proof`, including any extra fields. Proofs
must not be expired or live longer than three minutes; two minutes is a suitable
issuance window. The client allows at most one minute of future clock skew.
Generating a signature over the result alone, reusing a different request's
nonce, or returning an OCSP/CRL response does not satisfy this format.

See [validateStatusProof](../src/utils/system/registryTrust.js).

## Automatic developer renewal

`POST /api/v1/certificates/{previous-public-key-sha256}/renew` accepts:

```json
{
  "format": "fdo-developer-renewal-v1",
  "previousFingerprint": "PREVIOUS_PUBLIC_KEY_SHA256",
  "publicKeyPem": "NEW_SPKI_PUBLIC_KEY_PEM",
  "proofOfPossession": "NEW_KEY_SIGNATURE",
  "nonce": "REQUEST_NONCE",
  "issuedAt": "CURRENT_UTC_TIME",
  "signature": "PREVIOUS_KEY_SIGNATURE"
}
```

Validate that the URL and body name the same active, unexpired previous identity.
Resolve its owning account from your database. The new key signs UTF-8 bytes
`developerSub + "\n" + newPublicKeyFingerprint`; that base64 signature is
`proofOfPossession`. The previous key signs the canonical request object **without**
the `signature` field. Validate key strength, request freshness and replay
resistance; preserve account ownership and reject cross-account key reuse.

Store the replacement and its status atomically and return JSON on success. FDO
then queries the new fingerprint through the ordinary nonce-bound status endpoint;
that response must be available immediately after success. The client durably
saves its new protected private key before making the request. If a response is
lost, it checks that key's status before retrying. Make retries safe and retain
historical certificates; renewal alone must not mark old published signatures as
revoked. Revoked/expired identities require authenticated recovery, not possession
of their old private key alone.

The client also sends `content-type: application/json` and
`x-amz-content-sha256` (hex SHA-256 of the exact request body). The latter is a
payload digest, not AWS authentication. A non-AWS service can verify it without
AWS credentials. See [the renewal client](../src/utils/system/registryIdentity.js).

## Published releases and archives

`GET /api/v1/releases/{plugin-id}/{version}/status?nonce=...` returns these result
fields with a `kind: "release"` proof:

| Field | Meaning |
| --- | --- |
| `pluginId`, `version` | Exact requested ID and version |
| `status` | `active` only when plugin, release, publisher certificate and authority state permit use |
| `packageSha256` | Lowercase hex SHA-256 of the immutable ZIP bytes |
| `signerFingerprint` | Developer SPKI public-key SHA-256 |
| `certificatePem`, `certificateChainPem` | Published developer leaf and its validated chain |
| `signingMetadata` | Exact parsed `fdo.meta.json` object from the approved ZIP |
| `signature` | Base64 of the binary `fdo.signature` bytes in that ZIP |

Serve the ZIP at
`/packages/{plugin-id}/{version}/{packageSha256}.zip` on the same origin.
Do not substitute a TGZ, rebuild the ZIP after recording its digest, or redirect
to an authenticated object-storage URL. Recheck active state when publishing and
answering status; immutable download URLs do not revoke previously downloaded files.

Registry ZIPs contain source plus `fdo.meta.json` and binary `fdo.signature`.
Metadata has `format: "fdo-registry-v1"`, `hashAlgorithm: "sha256"`,
`signatureAlgorithm: "RSASSA-PKCS1-v1_5"`, `signedAt`, `signerFingerprint` and
`files` mapping exact relative paths to lowercase SHA-256 hex digests. The developer
signs the canonical metadata. Resolve the signing certificate from the authenticated
publisher's registered identity, not a certificate supplied by the ZIP.

Honor the public [archive/source validators](../src/utils/plugins/publishing/registryPolicy/source-archive.js)
and [signing implementation](../src/utils/system/registrySigning.js). Enforce the
10 MiB ZIP, 32 MiB expanded, 1 MiB per-file and 1,000-file limits (including signing
files), reject unsafe paths/symlinks, and check every signed source digest. Preserve
the source identity, version, metadata and signature through promotion. Never run
plugin code or package lifecycle scripts as part of inspection. Use your own
approved source/security scanning implementation; the desktop contract does not
mandate sending proprietary source to a particular external scanner.

`GET /api/v1/plugins/{id}?version=...&limit=1` supplies display information:
`{"plugin":{"id":"example","name":"Example"},"releases":[{"version":"1.0.0","manifest":{"name":"Example"}}]}`.
Catalog data is presentation only; a catalog entry never authorizes installation.

Private portals generate `fdo-fiddle://registry/{connection-id}/plugins/{id}/{version}`
links using the deterministic connection ID described in the [hosting guide](PRIVATE_REGISTRIES.md#install-private-releases).
FDO handles review and capability approval separately. A backend's `active` status
or valid publisher signature never grants desktop permissions.

## Validate your implementation

Start with the public [signed fixtures](../tests/helpers/registryLifecycleFixture.js)
and [lifecycle tests](../tests/unit/registry-lifecycle.test.js). Add backend tests for
canonical JSON, certificate/key fingerprint distinction, nonce/purpose/result
binding, expiry, replay, account ownership, lost renewal responses, concurrent
revocation/promotion and restoration without sequence rollback. Then run the
[clean-profile deployment acceptance checks](PRIVATE_REGISTRIES.md#6-operate-recover-and-validate)
against your actual deployed server. Passing desktop fixture tests is not evidence
that a separately implemented server meets the protocol.
