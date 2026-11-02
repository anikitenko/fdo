# Deploy an exported FDO plugin to Azure Container Apps

This reference starts in the extracted **Standalone web application / Docker** ZIP. It builds the image in Azure Container Registry (ACR), mounts Azure Files at `/data`, imports the private `.env` values as Container Apps secrets, and creates the application with its storage and credentials already configured.

The resource names below follow the author's Hyperstack deployment. Replace them for your own application. These commands create billable Azure resources; exporting from FDO does not execute them.

## Before you start

- Install a current Azure CLI and its Container Apps extension, and use a Bash-compatible terminal. The local configuration step uses Node.js 24 or newer, the same runtime required by the exported application.
- Your Azure account needs permission to create the resources and assign the storage role at the storage-account scope.
- In FDO's Export As dialog, choose the **Container port** before reviewing/exporting. It defaults to `8080`; supported export ports are `1024–65535`. The server, Compose mapping, health checks and cloud target ports use that selection. Azure's public HTTPS URL still uses port 443.
- Review the exported `deployment/services.json` and `docs/TOOLCHAIN.md`. Installing `az` or `aws` does not authenticate it. Provider API credentials and CLI/cloud roles are separate from the web app's username/password.
- This walkthrough uses SMB managed-identity mounts, currently documented by Microsoft as **preview**. The identity for this mount belongs to the Container Apps **environment**, not the application. Use a current Azure CLI/extension supporting `--azure-file-identity`; allow time for RBAC propagation. Follow Microsoft's linked prerequisites if the feature is unavailable in your environment.

## 1. Configure the deployment and sign in

Run the following from the exported project's root, containing `Dockerfile` and `setup.cjs`:

```bash
RG="rg-fdo-plugins"
LOCATION="westeurope"
ACA_ENV="fdo-env"
APP="fdo-hyperstack"
ACR="fdoplugins$RANDOM"
IMAGE_TAG="1.0"
STORAGE_ACCOUNT_NAME="myacastorageaccount$RANDOM"
STORAGE_SHARE_NAME="myfileshare"
STORAGE_MOUNT_NAME="mystoragemount"

az login
# If necessary: az account set --subscription "YOUR_SUBSCRIPTION_ID"
az extension add --name containerapp --upgrade
az provider register --namespace Microsoft.App --wait
az provider register --namespace Microsoft.OperationalInsights --wait
az provider register --namespace Microsoft.Storage --wait
az provider register --namespace Microsoft.ContainerRegistry --wait
```

ACR and storage-account names must be globally unique and meet Azure's naming rules. Keep the generated names for subsequent updates; do not rerun the random-name assignments for the same deployment.

## 2. Create the resource group, environment and registry

```bash
az group create --name "$RG" --location "$LOCATION" --output none

az containerapp env create \
  --name "$ACA_ENV" --resource-group "$RG" --location "$LOCATION" \
  --mi-system-assigned --output none

az acr create --name "$ACR" --resource-group "$RG" \
  --sku Basic --admin-enabled true --output none

az acr build --registry "$ACR" \
  --image "$APP:$IMAGE_TAG" --platform linux/amd64 .
```

Basic is sufficient for this reference's registry features; use the SKU required by your own networking and registry requirements. This reference follows the author's registry username/password approach. A managed image-pull identity with an appropriate ACR role can replace the admin credentials; it is separate from the environment's storage-mount identity.

## 3. Provision persistent `/data` storage

```bash
az storage account create \
  --resource-group "$RG" --name "$STORAGE_ACCOUNT_NAME" \
  --location "$LOCATION" --kind StorageV2 --sku Standard_LRS \
  --enable-large-file-share --enable-smb-oauth true --output none

az storage share-rm create \
  --resource-group "$RG" --storage-account "$STORAGE_ACCOUNT_NAME" \
  --name "$STORAGE_SHARE_NAME" --quota 1024 \
  --enabled-protocols SMB --output none

ENVIRONMENT_PRINCIPAL_ID="$(az containerapp env show \
  --name "$ACA_ENV" --resource-group "$RG" \
  --query identity.principalId --output tsv)"

STORAGE_ACCOUNT_ID="$(az storage account show \
  --name "$STORAGE_ACCOUNT_NAME" --resource-group "$RG" \
  --query id --output tsv)"

az role assignment create \
  --assignee-object-id "$ENVIRONMENT_PRINCIPAL_ID" \
  --assignee-principal-type ServicePrincipal \
  --role "Storage File Data SMB MI Admin" \
  --scope "$STORAGE_ACCOUNT_ID" --output none

az containerapp env storage set \
  --name "$ACA_ENV" --resource-group "$RG" \
  --storage-name "$STORAGE_MOUNT_NAME" --storage-type AzureFile \
  --azure-file-account-name "$STORAGE_ACCOUNT_NAME" \
  --azure-file-identity system \
  --azure-file-share-name "$STORAGE_SHARE_NAME" \
  --access-mode ReadWrite --output table
```

The environment storage definition does not mount anything into an app by itself. The application's `template.volumes` must reference this storage name, and the `application` container's `volumeMounts` must mount it at `/data`. Step 5 supplies both. The image runs as UID/GID 1000; its SMB mount options make `/data` writable by that user.

If authorization initially fails, verify the role and account's SMB OAuth setting, wait for role propagation, and retry the storage/deployment step. Do not switch identities between the role assignment and mount configuration.

## 4. Prepare the app secrets and resource identifiers

```bash
node setup.cjs

ACR_SERVER="$(az acr show --name "$ACR" --resource-group "$RG" \
  --query loginServer --output tsv)"
ACR_USER="$(az acr credential show --name "$ACR" --resource-group "$RG" \
  --query username --output tsv)"
ACR_PASSWORD="$(az acr credential show --name "$ACR" --resource-group "$RG" \
  --query 'passwords[0].value' --output tsv)"
ENVIRONMENT_ID="$(az containerapp env show \
  --name "$ACA_ENV" --resource-group "$RG" --query id --output tsv)"
DEFAULT_DOMAIN="$(az containerapp env show \
  --name "$ACA_ENV" --resource-group "$RG" \
  --query properties.defaultDomain --output tsv)"

export APP LOCATION ACR_SERVER ACR_USER ACR_PASSWORD IMAGE_TAG
export ENVIRONMENT_ID DEFAULT_DOMAIN STORAGE_MOUNT_NAME
```

`setup.cjs` creates `.env` only if it does not already exist. It generates the web password and a separate encryption key, and records the export's port. Keep this file private and retain the existing `WEB_APP_SECRET_KEY` when reconnecting an existing `/data` vault.

If your plugin needs a provider token, either enter it through the plugin's own settings after deployment, or configure the appropriate `secretEnvironment` mapping in `deployment/services.json` and supply that environment variable in `.env`. Rebuild the image after changing `services.json`. Desktop credentials are not included in the export.

## 5. Generate the complete private application configuration

This creates one deployment input containing the registry reference, application secret references, selected port, health probes, and `/data` mount. It replaces the template's Key Vault placeholders with explicit Container Apps secrets read from `.env`. The local file contains secret values; it is written with mode `0600`, and must not be committed, printed, or built into the image.

Run this Node command from the same exported folder:

```bash
node <<'NODE'
const fs = require('node:fs');
const {parseEnv} = require('node:util');
const values = parseEnv(fs.readFileSync('.env', 'utf8'));
const required = ['APP', 'LOCATION', 'ACR_SERVER', 'ACR_USER', 'ACR_PASSWORD',
  'IMAGE_TAG', 'ENVIRONMENT_ID', 'DEFAULT_DOMAIN', 'STORAGE_MOUNT_NAME'];
for (const key of required) if (!process.env[key]) throw new Error('Missing deployment variable: ' + key);
if (!values.WEB_APP_USERNAME || (values.WEB_APP_PASSWORD || '').length < 24 ||
    Buffer.from(values.WEB_APP_SECRET_KEY || '', 'base64').length !== 32) {
  throw new Error('Run node setup.cjs and retain valid web credentials and encryption key.');
}
const config = JSON.parse(fs.readFileSync('deployment/azure-container-app.json', 'utf8'));
const port = Number(values.PORT || config.properties.configuration.ingress.targetPort);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid container port.');
const settings = process.env;
config.name = settings.APP;
config.location = settings.LOCATION;
delete config.identity; // Storage uses the environment's identity; no app identity is assumed.
config.properties.managedEnvironmentId = settings.ENVIRONMENT_ID;
const deployment = config.properties.configuration;
deployment.ingress.targetPort = port;
deployment.activeRevisionsMode = 'Single';
deployment.secrets = [{name: 'registry-password', value: settings.ACR_PASSWORD}];
deployment.registries = [{server: settings.ACR_SERVER, username: settings.ACR_USER,
  passwordSecretRef: 'registry-password'}];
const container = config.properties.template.containers[0];
container.name = 'application';
container.image = settings.ACR_SERVER + '/' + settings.APP + ':' + settings.IMAGE_TAG;
container.env = [{name: 'PORT', value: String(port)},
  {name: 'WEB_APP_ORIGIN', value: 'https://' + settings.APP + '.' + settings.DEFAULT_DOMAIN}];
const secretNames = new Set(['registry-password']);
for (const [name, value] of Object.entries(values)) {
  if (['PORT', 'WEB_APP_ORIGIN'].includes(name)) continue;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error('Invalid environment variable name: ' + name);
  const secret = 'app-' + name.toLowerCase().replace(/_/g, '-');
  if (secretNames.has(secret)) throw new Error('Duplicate normalized secret name: ' + secret);
  secretNames.add(secret);
  deployment.secrets.push({name: secret, value});
  container.env.push({name, secretRef: secret});
}
for (const probe of container.probes || []) if (probe.httpGet) probe.httpGet.port = port;
container.volumeMounts = [{volumeName: 'application-data', mountPath: '/data'}];
config.properties.template.volumes = [{name: 'application-data', storageName: settings.STORAGE_MOUNT_NAME,
  storageType: 'AzureFile', mountOptions: 'uid=1000,gid=1000,dir_mode=0700,file_mode=0600'}];
config.properties.template.scale = {minReplicas: 1, maxReplicas: 1};
const target = 'deployment/azure-container-app.private.json';
fs.writeFileSync(target, JSON.stringify(config, null, 2) + '\n', {mode: 0o600});
fs.chmodSync(target, 0o600);
console.log('Created private deployment file. Secret values were not printed.');
NODE
```

For production secret management, the original `deployment/azure-container-app.json` also demonstrates Key Vault references. Configure its user-assigned identity and grant it the required secret access before using that path. Do not combine unresolved Key Vault placeholders with the `.env`-based reference above.

## 6. Create the app with secrets and storage in place

```bash
az containerapp create --name "$APP" --resource-group "$RG" \
  --environment "$ACA_ENV" \
  --yaml deployment/azure-container-app.private.json \
  --query properties.configuration.ingress.fqdn --output tsv

az containerapp revision list --name "$APP" --resource-group "$RG" --output table
az containerapp logs show --name "$APP" --resource-group "$RG" --follow
```

Open the returned HTTPS URL and sign in using the private `.env` username/password. `/health/live` and `/health/ready` are public status endpoints; application routes require sign-in. `WEB_APP_ORIGIN` must match the external HTTPS origin, including a custom domain if you add one later.

Verify the mount and tool installation using the portal's container console or:

```bash
az containerapp exec --name "$APP" --resource-group "$RG" --command /bin/sh
# Inside the application container:
test -w /data
node tools.cjs check
```

Mounting `/data` preserves settings and the encrypted vault across container replacement. Keep the volume and its encryption key together, with separate backups. For a Hyperstack plugin, configure the provider API token using that plugin's actual credential name; the web password and vault encryption key are not Hyperstack API credentials.

## Updating an existing application

- Reuse the same environment storage definition and encryption key. Build a new image tag, update `IMAGE_TAG`, and regenerate the private deployment file from the current `.env` and export template.
- Use `az containerapp update --name "$APP" --resource-group "$RG" --yaml deployment/azure-container-app.private.json` for the complete updated configuration. New image, environment-variable or template changes create a revision.
- A secret-value change alone does **not** create a revision or refresh existing replicas. Restart the affected revision with `az containerapp revision restart --name "$APP" --resource-group "$RG" --revision REVISION_NAME`, or deploy a new revision that references the updated secret.
- This export's file-based storage supports **one writer**. Keep one replica and one active revision; rolling revisions can overlap even with those settings. Plan a maintenance window and deactivate the old writer before handing the persistent volume to a replacement. Do not scale out this file-based vault without changing the storage design.
- If editing an exported `app.yaml` manually, add `template.volumes` and `containers[].volumeMounts` to the **application** container, not `nginx`. Preserve the configuration's secret definitions and references; do not apply a redacted `show` response as a complete replacement without restoring them.
- The generated private deployment file is excluded by the export's `.gitignore` and `.dockerignore`. Delete it when no longer needed; keep `.env`/the encryption key in your protected deployment records.

## CLI authentication inside the application

The identity used for the Azure Files mount, the registry pull credentials, application sign-in, and a plugin's CLI/provider authentication are separate configurations. If a plugin runs Azure CLI, attach an application managed identity with the resource roles it needs and initialize `az login --identity` in its startup process. Review its process scope's environment allowlist for identity/credential variables. The storage environment identity does not automatically authenticate a plugin's `az` or `aws` commands. See the exported README's Azure CLI authentication section.

## References

- [Azure Files mounts tutorial, including managed identity preview](https://learn.microsoft.com/en-us/azure/container-apps/storage-mounts-azure-files)
- [Storage mounts and mount options](https://learn.microsoft.com/en-us/azure/container-apps/storage-mounts)
- [Container Apps ARM/JSON and YAML specifications](https://learn.microsoft.com/en-us/azure/container-apps/azure-resource-manager-api-spec)
- [Container Apps secrets and revision behavior](https://learn.microsoft.com/en-us/azure/container-apps/manage-secrets)
- [Container console](https://learn.microsoft.com/en-us/azure/container-apps/container-console)
