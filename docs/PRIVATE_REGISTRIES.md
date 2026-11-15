# Host and connect an organization’s private FDO registry

An organization registry uses the same certificate, signing, export, installation,
renewal and revocation protocol as the official FDO registry. Each connection has
its own HTTPS origin, independently trusted root pin and signing identities. Up to
20 connections can be saved per FDO profile. The official registry remains available.

This is an **FDO plugin registry**, not an OCI/Docker or npm registry. Azure
Container Registry, Google Artifact Registry, Amazon ECR, Harbor and Artifactory
can hold deployment images or artifacts, but do not implement the FDO trust and
release API by themselves.

The desktop repository supplies the client, not a registry server or a portable
registry container image. The existing server implementation is
[fdo-plugins-aws-infra](https://github.com/anikitenko/fdo-plugins-aws-infra).
The AWS example below uses that implementation. Azure, GCP and Vault examples
describe the required service adapters and deployment wiring; they are not
claims that the AWS Lambda application already runs on those platforms unchanged.

## Choose a deployment

| Target | Application and data | Signing authorities | Work required |
| --- | --- | --- | --- |
| AWS reference | CloudFront, Lambda, S3, DynamoDB, SQS, Cognito | Separate non-exportable KMS root and issuer keys | Deploy the reference stack; restrict access and configure enterprise sign-in |
| Azure | Container Apps or AKS, Blob Storage, transactional database, queue, Entra ID | Key Vault RSA keys or Managed HSM | Port the server’s AWS persistence, identity, queue and signing integrations |
| GCP | Cloud Run or GKE, Cloud Storage, transactional database, Pub/Sub, enterprise identity | Cloud KMS asymmetric signing keys | Implement the corresponding adapters and private ingress |
| Existing Kubernetes / Nomad | Registry API, portal, worker, durable SQL/object storage, enterprise OIDC | Vault / enterprise HSM | Supply an FDO-compatible service and operate backups, HA and certificate lifecycle |

Use one stable origin, for example `https://plugins.example.com`. Serve `/profile`,
`/api/v1/*` and `/packages/*` there without redirecting API or archive requests.
Paths such as `https://example.com/registry` are not supported. Private DNS names
and VPN-only origins are supported when the desktop can resolve and reach them.

## 1. Prepare access and certificates

Decide these values before provisioning:

- Registry hostname, DNS owner, TLS certificate and employee network/VPN route.
- Enterprise identity provider and the users/groups permitted to publish.
- Storage and signing-key owners, backup retention and recovery procedure.
- Whether the organization permits source archives to leave its network for scanning.

The **TLS certificate** secures the HTTPS connection. The **registry root CA**
establishes plugin-signing trust. They are different certificates: distribute the
registry root’s SHA-256 certificate fingerprint, not the website TLS fingerprint.
For an enterprise TLS CA, configure the CA in the host’s Node/Electron trust
environment before launching FDO. The plugin Certificates panel does not configure
HTTPS trust. Do not disable TLS verification to make a private endpoint work.

FDO currently sends no browser session cookies, bearer tokens, client TLS
certificates or cloud IAM identity tokens with registry requests. Browser SSO
protects developer-account and publication operations. Desktop trust/status/archive
access must be reachable through a network boundary, such as VPN plus an internal
load balancer or an approved corporate egress allowlist. Placing an interactive SSO
redirect in front of every endpoint will break desktop checks.

The AWS reference’s catalog and package routes are public by default. An independent
deployment is not private until you enforce that network boundary. Restrict direct
storage/backend access as well as the hostname. A trusted root pin authenticates
responses; it does not make their contents confidential.

## 2. AWS: deploy the existing server

Use a dedicated organization account/environment and a reviewed revision of the
[server repository](https://github.com/anikitenko/fdo-plugins-aws-infra). Its
[production guide](https://github.com/anikitenko/fdo-plugins-aws-infra/blob/main/docs/production-deployment.md)
contains the complete SSO and operations setup. Replace its original deployment’s
account IDs, domain, IdP applications, alert recipients and scanner owner settings
with your organization’s values; do not reuse the official registry’s CA keys.

The reference uses CDK, not ECS. Install its pinned Node version (`nvm use`), the
AWS CLI and your approved AWS credentials. Run these commands from the server
checkout, not from the desktop checkout:

```bash
git clone https://github.com/anikitenko/fdo-plugins-aws-infra.git
cd fdo-plugins-aws-infra
nvm install
nvm use
npm ci

export AWS_PROFILE=organization-registry
export AWS_REGION=us-east-1
aws sts get-caller-identity
```

Confirm the returned account is your target organization account. In that account,
create a DNS-validated ACM certificate for `plugins.example.com` in `us-east-1`
(the CloudFront certificate region). Prepare an Entra application restricted to
your tenant, its OAuth client secret in SSM SecureString, and the scanner secret
through your approved secret-management process. Only parameter names and public
identifiers belong in synthesis inputs.

The reference requires VirusTotal checks and explicit source-sharing consent.
Configure your own scanner owner/group settings. If external source submission
is prohibited, adapt the server’s scanning policy to an approved private scanner
before publishing proprietary code; there is no desktop switch that bypasses
the server’s publication policy.

Create a reviewed `cdk.context.json` with your deployment’s public settings:

```json
{
  "registryPublicUrl": "https://plugins.example.com",
  "registryCertificateArn": "arn:aws:acm:us-east-1:123456789012:certificate/REPLACE",
  "microsoftTenantId": "YOUR-TENANT-ID",
  "microsoftClientId": "YOUR-APPLICATION-CLIENT-ID",
  "microsoftSecretParameter": "/acme/registry/entra-client-secret",
  "microsoftSecretParameterVersion": "1",
  "virusTotalApiKeyParameter": "/acme/registry/scanner-api-key",
  "virusTotalUserId": "YOUR-APPROVED-SCANNER-OWNER",
  "securityAlertEmail": "devops@example.com"
}
```

Review the repository’s `cdk.json` as well: it contains synthesis defaults, including
the original scanner owner. Register the generated Cognito hosted-login callback
with Entra as described in the server’s SSO guide; configure tenant restrictions
and application assignment before granting employee publication access.

The checked reference uses the `fdo2026` bootstrap qualifier. Bootstrap the account
and Region once using that same qualifier, then review and deploy one assembly:

```bash
REGISTRY_ACCOUNT_ID="123456789012"
npx cdk bootstrap "aws://${REGISTRY_ACCOUNT_ID}/${AWS_REGION}" --qualifier fdo2026
npm test
npm run synth
npx cdk diff --app cdk.out
npx cdk deploy --app cdk.out --outputs-file registry-outputs.json
```

Use normal CloudFormation deployment in production. Keep the reviewed assembly
and context in the deployment pipeline so deployment uses the exact diffed inputs.
[AWS documents environment bootstrapping and its account/Region scope](https://docs.aws.amazon.com/cdk/v2/guide/bootstrapping-env.html).

After deployment:

1. Point the hostname at the `CloudFrontDomainName` stack output. Keep S3 buckets
   private and the API’s CloudFront origin authorization intact.
2. For a VPN/egress-allowlisted installation, define the corporate IPv4/IPv6 CIDRs
   in CloudFront-scope WAF IP sets. Preserve the existing blocking/rate rules;
   add an allow rule for those IP sets after them and set the web ACL’s default
   action to **Block**. Manage this in your fork’s IaC so a later deploy preserves
   it. Test from both an employee VPN client and a disallowed network. Also protect
   custom alternate hostnames and any direct backend routes.
3. Complete the tenant-specific IdP callback configuration. Test that an unassigned
   user cannot issue a certificate or publish.
4. Run the server smoke check from an allowed network:

   ```bash
   REGISTRY_PUBLIC_URL=https://plugins.example.com node scripts/check-deployment.mjs
   ```

5. Obtain `RegistryRootFingerprint256` through authenticated CloudFormation, not
   through the newly deployed website:

   ```bash
   aws cloudformation describe-stacks --stack-name FdoPluginRegistryStack \
     --query 'Stacks[0].Outputs[?OutputKey==`RegistryRootFingerprint256`].OutputValue | [0]' \
     --output text
   ```

Distribute the hostname and pin through your controlled developer onboarding
channel. **Do not run the desktop’s `registry:sync-trust` for an organization
registry**: that script updates the official registry’s bundled configuration.
Private connections are configured in Settings or the CLI below.

If you instead port the backend to ECS/Fargate, place tasks behind the chosen
private ingress and implement the same API. Keep task execution permissions
(image pulls/logs/secret injection) separate from the application task role
(storage and issuer signing). [AWS describes the role separation](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/security-iam-roles.html).

## 3. Azure and GCP deployment examples

These examples start **after you have built and tested an FDO-compatible backend
image**. They configure the application compute; they do not create the missing
backend adapters, databases, workers, private DNS or signing hierarchy. Use an
immutable reviewed image digest and your own deployment configuration.

### Azure Container Apps

Provision a VNet-integrated **internal Container Apps environment**, private DNS,
employee VPN access, private storage/database access and a managed identity.
Inside an internal environment, app ingress marked `external` makes the service
reachable outside that environment through its internal load balancer; app-level
`internal` ingress is limited to other apps in the environment and is not enough
for developer laptops. [Microsoft explains these networking boundaries](https://learn.microsoft.com/en-us/azure/container-apps/networking).

Deploy to that pre-provisioned environment:

```bash
REGISTRY_IDENTITY="/subscriptions/SUBSCRIPTION/resourceGroups/rg-internal-tools/providers/Microsoft.ManagedIdentity/userAssignedIdentities/registry"
az containerapp create \
  --name fdo-registry --resource-group rg-internal-tools \
  --environment acme-internal-environment \
  --image 'acme.azurecr.io/fdo-registry@sha256:REPLACE_WITH_IMAGE_DIGEST' \
  --ingress external --target-port 8080 --min-replicas 1 --max-replicas 3 \
  --user-assigned "$REGISTRY_IDENTITY" \
  --registry-server acme.azurecr.io --registry-identity "$REGISTRY_IDENTITY"
```

Configure private ACR pull access, application storage/settings, a queue worker,
health probes and custom hostname/TLS before exposing the service to employees.
The target port must match your service. [Container Apps CLI reference](https://learn.microsoft.com/en-us/cli/azure/containerapp).

Use managed identity for service access and Key Vault references for secrets;
grant the identity the necessary vault access instead of embedding secrets in an
image. [Container Apps secret management](https://learn.microsoft.com/en-us/azure/container-apps/manage-secrets).
For a Key Vault signing adapter, use the RSA/SHA-256 PKCS#1 v1.5 `RS256` algorithm
with separate root/issuer keys. The adapter must generate and persist the public
X.509 hierarchy and FDO-signed trust/status documents; creating a TLS certificate
in Key Vault alone does not implement that protocol.
[Key Vault algorithms](https://learn.microsoft.com/en-us/azure/key-vault/keys/about-keys-details).

### Google Cloud Run

Build the API/portal image in Artifact Registry. Provision a service account,
durable metadata store, private Cloud Storage buckets, a publication worker,
scheduled trust renewal, Secret Manager access and Cloud KMS keys. Connect an
internal Application Load Balancer to Cloud Run using a serverless backend and
make that load balancer reachable over the employee VPN/private network.
Cloud Run internal ingress needs the documented VPC path; a developer’s browser
being signed into Google does not supply desktop requests with an identity token.
[Cloud Run private networking](https://docs.cloud.google.com/run/docs/securing/private-networking).

```bash
gcloud run deploy fdo-registry \
  --project acme-internal-tools --region europe-west1 \
  --image 'europe-west1-docker.pkg.dev/acme-internal-tools/tools/fdo-registry@sha256:REPLACE_WITH_IMAGE_DIGEST' \
  --service-account registry@acme-internal-tools.iam.gserviceaccount.com \
  --ingress internal --no-invoker-iam-check --port 8080 \
  --min 1 --max 3
```

The command intentionally delegates request authorization to the private network
boundary and application protocol; it does not implement browser SSO. Confirm
your organization permits disabling the invoker IAM check, and ensure that the
default service URL is unreachable from an untrusted network. Add the service’s
required settings/secrets, probes, DNS and certificate to the reviewed deployment.
[Cloud Run deployment flags](https://docs.cloud.google.com/sdk/gcloud/reference/run/deploy).

The signing adapter can use separate `RSA_SIGN_PKCS1_3072_SHA256` Cloud KMS keys
for the root and issuer. Preserve the public certificates and exact key versions
in lifecycle state; never substitute an encryption key or a PSS-only key for the
required signature algorithm. [Cloud KMS algorithms](https://docs.cloud.google.com/kms/docs/algorithms).

### HashiCorp Vault / existing platforms

Vault can manage a CA, sign developer CSRs and support a service deployed on
Kubernetes, Nomad or VMs. Keep developer keys local: use a CSR-signing flow rather
than an issuance flow that returns a server-generated private key. A developer
certificate must have digital-signature key usage, code-signing EKU
`1.3.6.1.5.5.7.3.3`, `CA=false`, and an RSA key of 2048–4096 bits.
[Vault PKI signing API](https://developer.hashicorp.com/vault/api-docs/secret/pki).

Vault is not an FDO registry. Implement account binding, publication, immutable
artifacts, signed trust history, renewal proofs and nonce-bound status responses
in the registry service. If using Transit for JSON signing, choose SHA-256 and
`signature_algorithm=pkcs1v15`; decode Vault’s versioned signature wrapper before
returning the raw signature as base64. The signing key must match the issuer
certificate registered in the trust document. An unrelated Transit key or a PKI
CRL alone cannot satisfy FDO’s status-proof checks.
[Vault Transit signing API](https://docs.hashicorp.com/vault/api-docs/secret/transit).

## 4. Connect developers in FDO

1. Connect to the VPN if required. Open **Settings → Certificates → Organization
   certificates → Connect private registry**.
2. Enter the organization name, HTTPS origin and independently distributed root
   SHA-256 fingerprint. Colons and uppercase hex are accepted. Choose **Verify
   and connect**. FDO verifies the signed trust document before saving the connection.
3. Choose **Open registry account**, sign in and obtain your developer chain/key.
4. Choose **Import developer certificate** within that organization. Select the
   chain and exactly one matching private key together; a combined PEM works too.
   File order does not matter. FDO validates issuer trust, code-signing usage,
   validity, key match and online certificate status, then encrypts the private
   key using the OS credential store.
5. Use the normal signing dialog in the editor or **Manage Plugins → Export As →
   FDO plugin archive (.zip)**. Select the certificate showing the intended private
   registry name. Upload the signed ZIP through that registry’s publishing portal.

CLI equivalent (quote selectors, which include a namespaced certificate ID):

```bash
fdo sign registry add --name 'Acme Engineering' --url https://plugins.example.com \
  --root-fingerprint 'REPLACE_WITH_ROOT_CERTIFICATE_SHA256'
fdo sign registry list --json
# Use the org-... ID returned by add/list:
fdo sign import-developer ./developer-chain.pem ./developer.key --registry 'org-REPLACE'
fdo sign list --json
fdo validate ./plugin-source --publishing
fdo sign archive ./plugin-source --certificate 'organization:ID_FROM_SIGN_LIST' --output ./release.zip
fdo sign plugin ./workspace --label 'organization:ID_FROM_SIGN_LIST'
```

Place `--profile <name>` before `sign` when using a named profile. The commands
reuse the UI’s services; they never print a private key or upload/publish code.
Root imports stay on their existing local trust path. A root imported as a local
signer does not silently become a private registry or a developer identity.

### Install private releases

The private portal must generate this **Install in FDO** link:

```text
fdo-fiddle://registry/<org-registry-id>/plugins/<plugin-id>/<exact-semver>
```

The connection ID is `org-` followed by the first 24 lowercase hex characters of
SHA-256 over the normalized HTTPS origin (including a non-default port). Obtain
it from Settings → Connection details or `fdo sign registry list`. All developers
connecting that origin receive the same ID. The reference portal’s official link
format must be adapted in your private fork; it does not automatically include it.

A link can reference only an already connected registry; it cannot enroll a new
server, provide credentials, change the pin or choose a download URL. Unknown
connections fail with setup guidance. FDO downloads the digest-addressed ZIP from
the selected origin, checks the current signed release status and source hashes,
and presents the normal installation approval. New plugins start inactive with
no capabilities granted. Updates retain the existing data and approval rules.
An ID belonging to a local/GitOps plugin or another registry is never overwritten.
Runtime checks use the installed record’s origin, not a server supplied by plugin
source. See [installation details](DEEP_LINKS.md).

## 5. Server compatibility checklist

All desktop-facing routes must return their content directly, without redirects.
Keep trust/status responses uncached and forward the request’s nonce unchanged.

| Route | Required behavior |
| --- | --- |
| `GET /api/v1/registry/trust` | Root-signed `fdo-registry-trust-v1` document with sequence, freshness, roots, issuers and authorized root transitions |
| `GET /api/v1/registry/certificate` | Current public root CA PEM; never a private key |
| `GET /api/v1/certificates/{public-key-sha256}?nonce=...` | Current certificate status and issuer-signed nonce-bound proof; active responses include the public leaf and chain |
| `POST /api/v1/certificates/{previous-public-key-sha256}/renew` | Validate old/new-key possession, request freshness and replay resistance; return an account-bound replacement certificate without receiving a private key |
| `GET /api/v1/releases/{id}/{version}/status?nonce=...` | Current release and certificate status, signer, public chain, exact signing metadata, signature and archive SHA-256, with signed proof |
| `GET /api/v1/plugins/{id}?version=...&limit=1` | Catalog display name; does not authorize a release |
| `GET /packages/{id}/{version}/{sha256}.zip` | Immutable signed FDO source archive (at most 10 MiB) |
| `/profile` and publishing/account API | Enterprise authentication, certificate issuance/recovery, ownership and server-side source/scanner checks |

Implement the wire formats from the shared validators rather than interpreting
the table as a complete protocol specification:

- [Trust transitions and status proofs](../src/utils/system/registryTrust.js):
  trust must be current (at most 49 hours per document); status proofs are
  request-nonce-, purpose-, result- and freshness-bound (at most three minutes).
- [Signing formats](../src/utils/system/registrySigning.js): RSA PKCS#1 v1.5 with
  SHA-256 over recursively key-sorted canonical JSON, exact source-file hashes,
  and `fdo-registry-v1` metadata. The archive carries neither a certificate nor
  a private key; server-side account certificates establish publisher identity.
- [Renewal request](../src/utils/system/registryIdentity.js):
  `fdo-developer-renewal-v1`, signed by the previous key with new-key proof of
  possession; the desktop persists the new protected key before requesting renewal.
- [Executable protocol fixtures](../tests/helpers/registryLifecycleFixture.js):
  signed trust transitions, status proofs and certificate chains for adapter tests.

Certificate fingerprints are SHA-256 over DER certificate bytes. Developer
identity/status IDs are SHA-256 over DER SPKI public-key bytes. Do not interchange
them. A certificate-signed `active` response without the correct nonce and purpose
is insufficient. HTTP 404 is needed for a pending renewal key not yet issued so
the client can resume safely after a lost response.

## 6. Operate, recover and validate

FDO checks signing identities on startup and every six hours, and checks online
status before signing. Active identities renew within 30 days of expiry using a
fresh RSA-3072 key. Running registry-backed plugins are checked every five minutes
and stopped on failed verification, including network outages. Plan VPN stability,
maintenance windows and monitoring accordingly; there is no offline trust bypass.

| Event | Operator action |
| --- | --- |
| Developer key compromised | Revoke it on the registry, recover the account identity and re-import; publish replacements for affected releases |
| Planned issuer/root rotation | Publish new authorities and root-authorized transitions while the previous root is still valid; retain historical public chains and sequence state |
| Root compromised or expired without transition | Distribute a replacement pin independently, disconnect/reconnect the private registry, then re-import recovered developer identities; never trust a transition signed only by the compromised root |
| Backend data loss | Restore certificate/status history, release tombstones, trust sequence/transitions and immutable packages consistently; do not reset the root or lower the trust sequence to make clients connect |
| Registry disconnected locally | Connection, trusted certificates and stored signing keys are removed from that profile; installed plugins fail verification at activation/next running check. This does not revoke server-side identities |

Monitor trust-document expiry/refresh failures, authority expiry, signing failures,
status latency/5xx, publication queue age, scanner failures, unauthorized requests
and backup restoration. Retain signing keys and data needed for rollback; rolling
back application code cannot reverse revocation or recover a deleted authority key.

Before onboarding a team, test from a clean FDO profile:

1. Wrong pin and unrelated developer chain are rejected; correct onboarding succeeds.
2. Non-employees and off-network clients cannot read private catalog/source or publish.
3. A developer exports a signed source ZIP, publishes, installs through the private
   link, reviews capabilities and activates the plugin.
4. Same-version install, update, downgrade, repair and cross-registry ID conflicts
   use the existing approval/data-preservation behavior.
5. Revoking a developer certificate, issuer, release or plugin blocks use even
   before certificate expiry; offline status blocks signing/activation.
6. Renewal survives a lost response without losing the protected pending key;
   planned root rotation succeeds and stale/rolled-back trust is rejected.
7. Disconnecting one organization leaves other organizations and local roots intact.

These are deployment acceptance checks. Desktop unit/UI tests do not provision
cloud services or establish that a live registry has passed them.
