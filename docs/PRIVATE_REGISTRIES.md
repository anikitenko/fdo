# Host and connect an organization’s private FDO registry

An organization registry uses the same certificate, signing, export, installation,
renewal and revocation protocol as the official FDO registry. Each connection has
its own HTTPS origin, independently trusted root pin and signing identities. Up to
20 connections can be saved per FDO profile. The official registry remains available.

This is an **FDO plugin registry**, not an OCI/Docker or npm registry. Azure
Container Registry, Google Artifact Registry, Amazon ECR, Harbor and Artifactory
can hold deployment images or artifacts, but do not implement the FDO trust and
release API by themselves.

The desktop repository supplies the client, public protocol validators and test
fixtures. It does **not** supply a standalone registry server, container image or
complete cloud deployment stack. The production registry's infrastructure repository
is private and is not a prerequisite readers can download.

To host your own registry, you must supply an FDO-compatible server implementing
section 5, or obtain one from a provider that supports that exact protocol. Then
follow the infrastructure steps below. Deploying a generic artifact store or an
empty container does not create a working registry. All cloud examples assume
you have first built and tested that service; no private repository access is needed
to read the contract, validators or interoperability fixtures linked here.

## Choose a deployment

| Target | Application and data | Signing authorities | Work required |
| --- | --- | --- | --- |
| AWS | ECS/Fargate behind a private ALB, S3, transactional database, SQS, enterprise OIDC | Separate non-exportable KMS root and issuer keys | Implement the FDO service and provision its infrastructure |
| Azure | Container Apps or AKS, Blob Storage, transactional database, queue, Entra ID | Key Vault RSA keys or Managed HSM | Implement persistence, identity, queue and signing integrations |
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

A deployment is not private until you enforce that network boundary. Restrict direct
storage/backend access as well as the hostname. A trusted root pin authenticates
responses; it does not make their contents confidential.

## 2. Build the service, then deploy it on AWS

### Implement and package your registry

Use the public [server compatibility checklist](#5-server-compatibility-checklist),
client validators and [protocol examples](REGISTRY_PROTOCOL.md). Implement these
application components before provisioning production infrastructure:

1. **Identity and accounts:** authenticate publishing users through enterprise OIDC;
   enforce tenant/group membership and bind each certificate's public key to its
   owning account. Desktop status and downloads use the private network boundary,
   not the browser's login session.
2. **Certificate authority and status:** issue code-signing leaves, maintain active,
   expired and revoked states, sign trust/status documents and support proof-based
   renewal. Keep the root signer separate from the routine issuer signer.
3. **Publication:** authenticate the publisher, verify the signed ZIP against their
   registered public certificate, validate source policy, inspect/scans in quarantine,
   then promote an immutable approved release. Recheck status before promotion.
4. **Catalog and downloads:** serve account/portal pages and the exact desktop API
   and package routes. Retain historical public chains and revocation tombstones.
5. **Background operations:** refresh signed trust metadata before it expires,
   renew authorities, process publication jobs and collect operational alerts.

Create your own reproducible build and deployment configuration. For a container
service, produce a reviewed image pinned by digest, supply a health endpoint,
handle graceful shutdown, and keep durable state outside the container. Configuration
must identify the canonical HTTPS origin, database, quarantine/approved buckets,
queue, OIDC provider, root/issuer key versions and scanner policy. Those are
requirements for your application, not environment-variable names defined by FDO.

Run your implementation against the public fixtures before exposing it to users:

```bash
# From the public FDO desktop checkout; validates the client contract and fixtures.
npm ci
npm run test:unit -- tests/unit/registry-lifecycle.test.js tests/unit/organization-registries.test.js --runInBand
```

These tests verify FDO's contract; they do not exercise or certify your server.
Your backend needs integration tests using the same canonical payloads and signatures,
plus the clean-profile acceptance checks in section 6.

### Provision the AWS environment

Use a dedicated account/environment and your own IaC repository. One deployment
architecture is:

```text
Employee desktop / browser -- VPN --> private DNS + HTTPS ALB
                                            |
                                     registry API / portal
                                      (ECS / Fargate)
                                            |
                  +-------------------------+--------------------+
                  |                         |                    |
            transactional DB       private S3 buckets          SQS worker
          accounts/status/releases  quarantine + approved     validation/scans
                                            |
                               issuer KMS signing permission

Separate privileged lifecycle job --> root KMS key + public trust history
```

Provision in this order:

1. **Network and ingress.** Create private subnets, employee VPN routing, private
   DNS for `plugins.example.com`, and an internal ALB with HTTPS. Allow the API task
   port only from the ALB. Provide VPC endpoints or controlled egress for image
   pulls, logs, storage, queues and signing services. Route every desktop-facing
   path through the same origin; do not redirect archives to an S3 hostname.
2. **Durable data.** Create a transactional database for accounts, certificate
   history, monotonic trust sequences, release reservations and revocation state.
   Create separate private S3 buckets/prefixes for quarantine and approved packages.
   Enable backup/version retention and restrict direct object access. Use conditional
   writes or transactions to prevent duplicate version publication and revoked
   releases being promoted concurrently.
3. **Signing.** Provision separate non-exportable asymmetric RSA signing keys for
   the root and issuer. Your CA implementation constructs the X.509 certificates
   and persists their public history. The API needs routine issuer signing only;
   a separate privileged lifecycle job controls root signing and transitions.
   A cloud signing key alone is not an X.509 CA or a registry protocol implementation.
4. **Identity and policy.** Configure enterprise OIDC, browser redirect URLs,
   employee/group restrictions, account ownership checks and explicit publisher
   authorization. Choose an approved scanner: if it sends source externally, obtain
   the organization's approval before uploading proprietary plugins. FDO does not
   require a particular commercial scanner for a custom server.
5. **Compute and workers.** Push your service image to ECR and deploy its immutable
   digest in an ECS task definition. Connect the service to the ALB, configure
   health checks and rollout rollback, and deploy the queue worker separately.
   Separate task execution permissions (image pulls, logs, injected secrets) from
   application task permissions (database, objects, queues and issuer signing).
   [AWS documents this role separation](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/security-iam-roles.html).
6. **Lifecycle and operations.** Schedule trust refresh/authority renewal, configure
   alerts and test data restoration. Preserve key versions and public certificates
   needed to verify historical releases. Inspect your IaC plan/diff before applying
   changes; do not replace durable resources or signing keys on routine updates.

There is no FDO-provided ECS task definition, `cdk.context.json`, stack name,
bootstrap qualifier or cloud output key to copy. Define those in your own
implementation. Azure and GCP below deploy the same service contract with their
platform-specific integrations.

### Bootstrap trust and onboard a developer

Create the root/issuer hierarchy and initial signed trust document through your
controlled administrative process. Obtain the **public root certificate** through
that administrative channel and compute its SHA-256 fingerprint:

```bash
openssl x509 -in organization-registry-root.pem -noout -fingerprint -sha256
```

This file must be the public registry signing root, not the HTTPS server certificate
or a certificate blindly downloaded from an unverified endpoint. Share only the
origin and public fingerprint through controlled onboarding. Never distribute a
root/issuer private key.

Before connecting FDO, check transport and routing from an employee VPN client:

```bash
REGISTRY_ORIGIN="https://plugins.example.com"
curl --fail --show-error --max-time 10 --max-redirs 0 \
  "$REGISTRY_ORIGIN/api/v1/registry/certificate" --output downloaded-root.pem
openssl x509 -in downloaded-root.pem -noout -fingerprint -sha256
curl --fail --show-error --max-time 10 --max-redirs 0 \
  "$REGISTRY_ORIGIN/api/v1/registry/trust" --output registry-trust.json
```

Compare the certificate fingerprint with the independently supplied value. These
commands only check transport/content; they do not validate the trust document's
signature or authorize an installation. FDO performs those checks during connection.
Also verify that an off-network client cannot reach private catalog or package data.
Follow section 4 to connect, import a developer identity, publish and install a test
release.

Do not run `registry:sync-trust` for an organization registry. It is an official
registry maintainer tool, not a self-hosting prerequisite; private connections use
Settings or `fdo sign registry add`.

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
connecting that origin receive the same ID. Your portal must generate this scoped
route; a link without the connection ID targets the official registry instead.

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
