export function cloudTemplates(name,{persistent=false,encrypted=false}={}) {
    const probe={httpGet:{path:'/health/ready',port:8080},initialDelaySeconds:5,periodSeconds:10};
    const task={family:name,requiresCompatibilities:['FARGATE'],networkMode:'awsvpc',cpu:'256',memory:'512',runtimePlatform:{operatingSystemFamily:'LINUX',cpuArchitecture:'X86_64'},
        executionRoleArn:'REPLACE_WITH_EXECUTION_ROLE_ARN',...(persistent?{taskRoleArn:'REPLACE_WITH_TASK_ROLE_ARN'}:{}),containerDefinitions:[{name:'application',image:'REPLACE_WITH_IMAGE_URI',essential:true,user:'1000:1000',
            portMappings:[{containerPort:8080,protocol:'tcp'}],environment:[{name:'WEB_APP_USERNAME',value:'engineer'},{name:'WEB_APP_ORIGIN',value:'https://REPLACE_WITH_PUBLIC_HOST'}],
            secrets:[{name:'WEB_APP_PASSWORD',valueFrom:'REPLACE_WITH_PASSWORD_SECRET_ARN'},...(encrypted?[{name:'WEB_APP_SECRET_KEY',valueFrom:'REPLACE_WITH_ENCRYPTION_KEY_SECRET_VERSION_ARN'}]:[])],
            healthCheck:{command:['CMD','node','healthcheck.cjs'],interval:30,timeout:5,retries:3,startPeriod:30},
            ...(persistent?{mountPoints:[{sourceVolume:'application-data',containerPath:'/data',readOnly:false}]}:{})}],
        ...(persistent?{volumes:[{name:'application-data',efsVolumeConfiguration:{fileSystemId:'REPLACE_WITH_EFS_ID',transitEncryption:'ENABLED',authorizationConfig:{accessPointId:'REPLACE_WITH_EFS_ACCESS_POINT_ID',iam:'ENABLED'}}}]}:{})};
    const azure={name,location:'REPLACE_WITH_AZURE_REGION',type:'Microsoft.App/containerApps',properties:{managedEnvironmentId:'REPLACE_WITH_ENVIRONMENT_RESOURCE_ID',
        configuration:{activeRevisionsMode:'Single',ingress:{external:true,targetPort:8080,transport:'http',allowInsecure:false},secrets:[{name:'application-password',keyVaultUrl:'https://REPLACE_WITH_VAULT.vault.azure.net/secrets/application-password',identity:'REPLACE_WITH_MANAGED_IDENTITY_RESOURCE_ID'},...(encrypted?[{name:'application-key',keyVaultUrl:'https://REPLACE_WITH_VAULT.vault.azure.net/secrets/application-key/REPLACE_WITH_KEY_VERSION',identity:'REPLACE_WITH_MANAGED_IDENTITY_RESOURCE_ID'}]:[])]},
        template:{containers:[{name:'application',image:'REPLACE_WITH_IMAGE_URI',resources:{cpu:0.5,memory:'1Gi'},
            env:[{name:'WEB_APP_USERNAME',value:'engineer'},{name:'WEB_APP_ORIGIN',value:'https://REPLACE_WITH_PUBLIC_HOST'},{name:'WEB_APP_PASSWORD',secretRef:'application-password'},...(encrypted?[{name:'WEB_APP_SECRET_KEY',secretRef:'application-key'}]:[])],
            probes:[{type:'Readiness',...probe},{type:'Liveness',httpGet:{path:'/health/live',port:8080},initialDelaySeconds:5,periodSeconds:10}],
            ...(persistent?{volumeMounts:[{volumeName:'application-data',mountPath:'/data'}]}:{})}],
            scale:{minReplicas:1,maxReplicas:1},...(persistent?{volumes:[{name:'application-data',storageType:'AzureFile',storageName:'REPLACE_WITH_ENVIRONMENT_STORAGE_NAME'}]}:{})}},identity:{type:'UserAssigned',userAssignedIdentities:{REPLACE_WITH_MANAGED_IDENTITY_RESOURCE_ID:{}}}};
    const run={apiVersion:'serving.knative.dev/v1',kind:'Service',metadata:{name},spec:{template:{metadata:{annotations:{'autoscaling.knative.dev/maxScale':'1'}},spec:{containerConcurrency:1,
        containers:[{image:'REPLACE_WITH_IMAGE_URI',ports:[{containerPort:8080}],env:[{name:'WEB_APP_USERNAME',value:'engineer'},{name:'WEB_APP_ORIGIN',value:'https://REPLACE_WITH_PUBLIC_HOST'},
            {name:'WEB_APP_PASSWORD',valueFrom:{secretKeyRef:{name:'REPLACE_WITH_PASSWORD_SECRET_NAME',key:'latest'}}},...(encrypted?[{name:'WEB_APP_SECRET_KEY',valueFrom:{secretKeyRef:{name:'REPLACE_WITH_ENCRYPTION_KEY_SECRET_NAME',key:'REPLACE_WITH_KEY_VERSION'}}}]:[])],
            startupProbe:{httpGet:{path:'/health/ready',port:8080},periodSeconds:5,failureThreshold:12},livenessProbe:{httpGet:{path:'/health/live',port:8080}},
            ...(persistent?{volumeMounts:[{name:'application-data',mountPath:'/data'}]}:{})}],
        ...(persistent?{volumes:[{name:'application-data',nfs:{server:'REPLACE_WITH_FILESTORE_IP',path:'/REPLACE_WITH_SHARE'}}]}:{})}}}};
    return Object.fromEntries(Object.entries({'aws-ecs.task.json':task,'azure-container-app.json':azure,'gcp-cloud-run.json':run}).map(([file,value])=>['deployment/'+file,JSON.stringify(value,null,2)+'\n']));
}

export function deploymentReadme(name,report) {
    return `# ${name}: standalone web application

This is a converted frontend and backend, with no Electron or FDO SDK runtime dependency.
The public contract ABI and helpers were compiled from the reviewed installed SDK;
their license notices remain in runtime/contract.cjs. The private desktop communicator
was removed. runtime/application.cjs binds the public registry to standalone storage,
HTTP actions and service implementations. The backend source is in
backend/source; frontend/application.js owns HTTP communication and browser interactions.
conversion-report.json records the converter version, source fingerprint and capability analysis.

## Run locally

1. Run sh start.sh (or node setup.cjs followed by docker compose up --build).
   Setup creates .env once, with a unique username/password and encryption key.
   Read .env locally to sign in as engineer; subsequent runs preserve existing keys.
   If configuring .env manually, set WEB_APP_USERNAME and a random WEB_APP_PASSWORD
   of at least 24 characters. Generate passwords with: node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))".
2. If the application uses credentials, independently generate WEB_APP_SECRET_KEY with
   the same command. Keep that 32-byte base64 key in your cloud secret manager. Do not
   commit it or bake it into an image. Pin its secret-manager version; key rotation
   requires re-encrypting the vault. Losing it prevents decryption of stored credentials.
3. Docker Compose 2.24 or newer is required. Open http://localhost:8080 and sign in.
   Compose binds the service to localhost. Cloud access must use HTTPS.
4. The image runs as UID 1000. Ensure mounted /data is writable by UID 1000.

For local Node development: npm ci --ignore-scripts; npm run build; load the values
from .env into the process environment and run npm start. Node 24 or newer is required.
Set WEB_APP_DATA_DIR to a writable persistent directory outside Docker.

## CLI dependencies

Tool requirements are in deployment/toolchain.json. Docker installs the selected
packages/artifacts and checks their version constraints before building the app.
Resolved versions are recorded inside the image in deployment/toolchain.lock.json.
To inspect a running deployment:

    docker compose exec application node tools.cjs check

If the app cannot start, use a one-off command sharing its volumes:

    docker compose run --rm --no-deps application node tools.cjs check

A process scope describes allowed choices, not an installation list. Legacy scopes
with one command family can be inferred. For scopes with alternatives, declare the
actual tools in the plugin package.json and export again:

    "fdo": {
      "deployment": {
        "schemaVersion": 1,
        "tools": [{"id": "azure-cli", "version": "^2.91.0"}, {"id": "jq"}]
      }
    }

The trusted catalog covers common tools. Custom requirements can use constrained
Debian package specifications or platform-specific HTTPS artifacts with mandatory
SHA-256 verification. Artifact installation copies only the declared executable;
archives are not extracted into arbitrary paths. Shell installer snippets are not
accepted. See docs/TOOLCHAIN.md in this export for the schema and examples. Unresolved
tool choices or definitions stop the image build with instructions to complete them.
Version ranges are checked against actual tools; distribution-managed packages may
resolve differently on a later rebuild. For exact rebuilds use pinned package
versions or checksum-pinned artifacts and retain the built image digest.

## Azure CLI authentication

For local use after the app starts:

    docker compose exec application az login --use-device-code
    docker compose exec application az account set --subscription "YOUR_SUBSCRIPTION_ID"
    docker compose exec application az account show

Open the URL Azure prints in your own browser and enter its device code. No browser
runs in the container. AZURE_CONFIG_DIR is /data/azure; the application-data volume
preserves the login cache. That cache contains sensitive authentication material;
it is separate from the FDO service vault. Do not copy desktop caches into an image.

If initialization requires Azure access before the app can start, authenticate using
its image and persistent volume without starting the web backend:

    docker compose build
    docker compose run --rm --no-deps application az login --use-device-code
    docker compose run --rm --no-deps application az account set --subscription "YOUR_SUBSCRIPTION_ID"
    docker compose up -d

For an unattended Azure deployment, attach a managed identity with the required
resource roles and run az login --identity (add --client-id for a user-assigned
identity) in your deployment startup step. A local Docker container does not acquire
an Azure managed identity merely because Azure CLI is installed. On other platforms,
use an explicitly configured service principal with a mounted certificate or a
federated workload token. Inject credentials at runtime; never put them into
package.json, Dockerfile, build arguments, toolchain.json or the exported ZIP.
Container app sign-in and Azure CLI sign-in are separate identities.

References: https://learn.microsoft.com/en-us/cli/azure/authenticate-azure-cli-interactively
https://learn.microsoft.com/en-us/cli/azure/authenticate-azure-cli-managed-identity
https://learn.microsoft.com/en-us/cli/azure/authenticate-azure-cli-service-principal

## Build and deploy

Build a Linux image, for example:

    docker buildx build --platform linux/amd64 -t YOUR_REGISTRY/${name}:1.0.0 --push .

Use one of the JSON deployment templates (JSON is also valid YAML). Replace every
REPLACE_WITH value, set WEB_APP_ORIGIN to the public HTTPS origin, and provision the
network, image pull identity, secret access, ingress and persistent storage first.
The templates are deployment inputs, not provisioned cloud resources. Export never
contacts your cloud account, pushes an image, deploys resources, or grants IAM roles.

- AWS ECS: register deployment/aws-ecs.task.json and create a Fargate service with
  desired count 1, awsvpc networking and an HTTPS load balancer targeting port 8080.
  Configure execution/task IAM roles, EFS access if present, and secret-manager access.
- Azure Container Apps: pass deployment/azure-container-app.json to az containerapp
  create --resource-group YOUR_GROUP --yaml FILE after configuring the environment,
  registry access, Key Vault identity permissions and Azure Files storage if present.
- Google Cloud Run: use gcloud run services replace deployment/gcp-cloud-run.json
  --region YOUR_REGION. Configure the service account, secret access and VPC/NFS
  connectivity if a persistent volume is present. For direct browser access, permit
  platform invocation and protect routes with application sign-in, or configure an
  identity-aware proxy that preserves application authentication. Two authentication
  schemes cannot share the same Authorization header.

This release uses application-owned JSON files and an atomic encrypted service vault: one writer, one replica, one active
revision. Rolling revisions may overlap even with max replicas/instances set to 1.
Stop the old revision before switching a persistent volume to a new writer. For
horizontal scaling, migrate settings and credentials to a transactional managed
database/secret service and add per-user authorization before increasing replicas.
Cloud filesystem layers are ephemeral; mounting persistent storage is required for
settings and encrypted credentials to survive replacement. NFS/filesystem semantics
must support atomic rename. Back up the volume and encryption key separately.

The container listens on 0.0.0.0:$PORT (8080 by default), exposes /health/live and
/health/ready, logs to stdout/stderr, and handles SIGTERM with a bounded shutdown.
Health routes are public and contain no application data. Other routes require
application sign-in. The browser UI uses an opaque sandbox and an HTTP action API.
State belongs to this trusted workspace and is shared by signed-in engineers.

## Conversion and security boundaries

- Desktop data, credentials, certificates, SSH profiles and desktop scope paths are absent.
- Capability grants are reviewed export inputs, not automatic cloud/IAM permissions.
- Backend HTTP/HTTPS requests and browser transports retain destination policy checks.
  Automatic fetch redirects are disabled; explicitly request any new destination.
  These checks are application safeguards, not isolation against malicious application
  code. Apply cloud egress controls and least-privilege service identities separately.
- Scoped process/fs services, encrypted secrets, SSH and auth/session transports run
  in the backend. Service configuration is in deployment/services.json. Missing
  credentials or executables produce configuration errors, never pretend success.
- pathMappings maps desktop scope roots to isolated /data/scopes directories.
  Mount the required project/configuration into these paths. Original desktop data
  is absent. Requests and policies are remapped together; argument and confirmation
  restrictions remain enforced. executables maps validated executable identities
  to installed container tools. It does not bypass argument validation.
- Azure exports install Azure CLI 2.91.0 from Microsoft packages; authenticate the
  container separately. For a local device login: docker compose exec application
  az login --use-device-code. Its cache is stored only in /data/azure. In cloud
  deployments prefer managed identity or workload identity. Never copy desktop
  login caches. See https://learn.microsoft.com/en-us/cli/azure/authenticate-azure-cli.
- Add other required binaries to Dockerfile before USER node, and map their original
  identities in deployment/services.json. Export cannot install arbitrary third-party binaries
  just from an executable filename.
- Configure SSH profiles (including host fingerprints) and secretEnvironment
  entries mapping credential names to injected environment variable names.
  Those values are encrypted into the vault on startup. Keep profiles private.
- Configure aiAssistants as records with id, name, model, purpose, provider, default,
  endpoint (OpenAI-compatible chat completions HTTPS URL), apiKeyEnvironment.
  Authentication/session requests use the same network-checked public host protocol.
  Sessions are memory-only; sign in again after backend restart.
- Desktop tray menus become browser action controls. Sudo requires an explicit
  deployment service gateway; no privileged container is enabled. X11 requires
  deployment display infrastructure and cannot create a browser desktop itself.
- An optional HTTPS gateway receives {pluginId,handler,content}, authorized with
  WEB_APP_GATEWAY_TOKEN. It must return the public service result envelope. Elevation
  returns {ok:true,stdout:string}. Export never calls a desktop FDO gateway.
- UI helpers are compiled, not fetched from a CDN. Host-injected third-party globals
  must be explicitly imported into the frontend before a plugin relying on them can
  be converted. Native modules and OS-specific programs still need a compatible Linux build;
  a compatibility declaration cannot translate arbitrary native code.
- Imported CSS style maps are materialized as adjacent .css.cjs modules. After editing
  styles, update those maps or replace them with your web application's styling tool.
- Exported source can contain authored literals. Review the source for credentials
  before distributing it, just as you would before publishing any source project.

## Verified platform contracts

- [AWS ECS Fargate task definitions](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html)
- [Azure Container Apps templates](https://learn.microsoft.com/en-us/azure/container-apps/azure-resource-manager-api-spec)
- [Cloud Run container contract](https://docs.cloud.google.com/run/docs/container-contract)

## Export warnings

${report.warnings.map(warning=>'- '+warning).join('\n')}
`;
}
