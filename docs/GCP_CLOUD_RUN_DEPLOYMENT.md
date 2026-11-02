# Deploy an exported FDO plugin to Google Cloud Run

Start in the extracted standalone export folder. This reference uses Artifact Registry, Cloud Build, Secret Manager, a dedicated service account, and Filestore mounted at `/data` through Direct VPC egress. It preserves the selected container port and supplies credentials before the first application start. The commands create billable resources only when you execute them.

## 1. Configure the project and tools

Install a current Google Cloud CLI and Node.js 24+. Use a billing-enabled project where you can enable APIs, build images, create networks/Filestore/VMs, manage secrets and IAM, and deploy Cloud Run using the runtime service account.

```bash
PROJECT_ID="YOUR_PROJECT_ID"
REGION="europe-west1"
ZONE="europe-west1-b"
APP="fdo-hyperstack"
REPOSITORY="fdo-plugins"
IMAGE_TAG="1.0"
NETWORK="fdo-network"
SUBNET="fdo-run-subnet"
FILESTORE="fdo-data"
SHARE="data"
SETUP_VM="fdo-data-setup"

gcloud auth login
gcloud config set project "$PROJECT_ID"
gcloud services enable run.googleapis.com artifactregistry.googleapis.com \
  cloudbuild.googleapis.com secretmanager.googleapis.com \
  file.googleapis.com compute.googleapis.com iam.googleapis.com

PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
SERVICE_ACCOUNT_NAME="$APP-runtime"
SERVICE_ACCOUNT="$SERVICE_ACCOUNT_NAME@$PROJECT_ID.iam.gserviceaccount.com"
IMAGE_URI="$REGION-docker.pkg.dev/$PROJECT_ID/$REPOSITORY/$APP:$IMAGE_TAG"
# Use this deterministic service URL as the browser origin.
APP_ORIGIN="https://$APP-$PROJECT_NUMBER.$REGION.run.app"
export PROJECT_ID PROJECT_NUMBER REGION ZONE APP REPOSITORY IMAGE_TAG
export NETWORK SUBNET FILESTORE SHARE SERVICE_ACCOUNT IMAGE_URI APP_ORIGIN

node setup.cjs
```

Use a short valid service/service-account name. This guide creates new named resources; reuse their identifiers when updating instead of rerunning creation commands. Preserve the existing `.env` encryption key whenever you reuse `/data`.

Filestore has a provisioned-capacity cost independent of Cloud Run traffic. This example uses a 1 TiB Basic HDD instance; select the tier/capacity supported in your region. Keep the Filestore instance, subnet, and Cloud Run region compatible. A Cloud Storage bucket mount is not a substitute for the filesystem semantics required by this export's atomic file writes.

## 2. Build and publish the container

```bash
gcloud artifacts repositories create "$REPOSITORY" \
  --repository-format=docker --location="$REGION"
gcloud builds submit --tag "$IMAGE_URI" .
gcloud iam service-accounts create "$SERVICE_ACCOUNT_NAME" \
  --display-name="FDO application runtime"
```

Cloud Build must have permission to write to this Artifact Registry repository; configure the build service account used by your project if the build is denied. Cloud Run's service agent must be able to pull the image, especially for a cross-project registry. The application's runtime account is a separate identity.

The exported `.gcloudignore` excludes `.env`, `.env.*`, data files and `deployment/*.private.json` from the Cloud Build source upload; `.dockerignore` also excludes them from the image build. Keep both files. For an older export, add the same exclusions to `.gcloudignore` before submitting any source. Configure provider-token mappings in `deployment/services.json` before building. Image installation does not authenticate provider CLIs.

## 3. Create the network and persistent Filestore share

```bash
gcloud compute networks create "$NETWORK" --subnet-mode=custom
gcloud compute networks subnets create "$SUBNET" \
  --network="$NETWORK" --region="$REGION" --range=10.42.0.0/26

gcloud filestore instances create "$FILESTORE" \
  --zone="$ZONE" --tier=BASIC_HDD \
  --file-share="name=$SHARE,capacity=1TiB" \
  --network="name=$NETWORK,connect-mode=DIRECT_PEERING"

FILESTORE_IP="$(gcloud filestore instances describe "$FILESTORE" \
  --zone="$ZONE" --format='value(networks[0].ipAddresses[0])')"
export FILESTORE_IP
```

Direct VPC egress requires an adequately sized subnet; this reference uses `/26`. Review network routes, Filestore export rules and firewall policies so the Cloud Run subnet can reach the NFS server. The new VPC's default egress permits this reference's outbound traffic; adapt restrictive policies deliberately. Cloud Run mounts NFS without file locking, so this guide uses one application writer and does not promise distributed locking.

## 4. Initialize filesystem ownership for the non-root image

The exported image runs as UID/GID 1000. Filestore's default root-owned share needs an explicit writable directory/ownership setup. Use an administrator NFS client in the same VPC; the following temporary VM is one way to perform the initial setup. It receives no service account or cloud credentials.

```bash
cat > deployment/filestore-init.sh <<SCRIPT
#!/bin/sh
set -eu
apt-get update
apt-get install -y nfs-common
mkdir -p /mnt/fdo
mount -t nfs -o vers=3,nolock "$FILESTORE_IP:/$SHARE" /mnt/fdo
chown 1000:1000 /mnt/fdo
chmod 0700 /mnt/fdo
umount /mnt/fdo
echo FDO_NFS_READY > /dev/ttyS0
SCRIPT

gcloud compute instances create "$SETUP_VM" --zone="$ZONE" \
  --machine-type=e2-micro --subnet="$SUBNET" \
  --image-family=debian-12 --image-project=debian-cloud \
  --no-service-account --no-scopes \
  --metadata-from-file=startup-script=deployment/filestore-init.sh

gcloud compute instances get-serial-port-output "$SETUP_VM" --zone="$ZONE"
```

Wait for `FDO_NFS_READY` in the serial output. If it is missing, inspect the startup logs and correct networking/mount permissions before deploying. This setup VM needs package-repository access; it uses an external IP for outbound access in this reference. No inbound SSH rule is added. An existing private administrative VM with suitable outbound access can perform the same mount/chown instead.

After confirming completion, remove only this temporary setup VM:

```bash
gcloud compute instances delete "$SETUP_VM" --zone="$ZONE" --quiet
```

Do not delete the Filestore instance: it is the application state. With an existing export or customized filesystem policy, align its writable directory mapping with the mounted share instead of changing ownership on unrelated data.

## 5. Prepare secret references and the Cloud Run configuration

The next command reads `.env` as data, creates a private upload manifest, and fills the exported Cloud Run template. It does not send secrets to Google yet. A separate secret is used for each application environment value; versions are pinned to `1` for this first deployment. No secret values are printed.

```bash
node <<'NODE'
const fs=require('node:fs'),e=process.env;
for(const k of ['PROJECT_ID','APP','SERVICE_ACCOUNT','IMAGE_URI','APP_ORIGIN','NETWORK','SUBNET','FILESTORE_IP','SHARE']) if(!e[k]) throw new Error('Missing '+k);
const values=require('node:util').parseEnv(fs.readFileSync('.env','utf8'));
if(!values.WEB_APP_USERNAME || (values.WEB_APP_PASSWORD||'').length<24 || Buffer.from(values.WEB_APP_SECRET_KEY||'','base64').length!==32) throw new Error('Run setup.cjs first.');
const config=JSON.parse(fs.readFileSync('deployment/gcp-cloud-run.json','utf8'));
const port=Number(values.PORT || config.spec.template.spec.containers[0].ports[0].containerPort);
if(!Number.isInteger(port) || port<1024 || port>65535) throw new Error('Invalid port');
config.metadata.name=e.APP;
config.metadata.annotations={...(config.metadata.annotations||{}),'run.googleapis.com/scalingMode':'manual','run.googleapis.com/manualInstanceCount':'1'};
const template=config.spec.template;
template.metadata.annotations={...(template.metadata.annotations||{}),
  'run.googleapis.com/execution-environment':'gen2','run.googleapis.com/cpu-throttling':'false',
  'run.googleapis.com/network-interfaces':JSON.stringify([{network:e.NETWORK,subnetwork:e.SUBNET}]),
  'run.googleapis.com/vpc-access-egress':'private-ranges-only'};
template.spec.serviceAccountName=e.SERVICE_ACCOUNT;
template.spec.containerConcurrency=1;
const c=template.spec.containers[0];c.image=e.IMAGE_URI;c.ports=[{containerPort:port}];
c.resources={limits:{cpu:'1',memory:'1Gi'}};
c.env=[{name:'WEB_APP_ORIGIN',value:e.APP_ORIGIN}];
const uploads=[],names=new Set();
for(const [name,value] of Object.entries(values)) {
  if(['PORT','WEB_APP_ORIGIN'].includes(name)) continue; // Cloud Run injects its reserved PORT.
  if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error('Invalid environment name: '+name);
  const secret=e.APP+'-'+name.toLowerCase().replace(/_/g,'-');
  if(names.has(secret)) throw new Error('Duplicate secret name: '+secret);
  names.add(secret);uploads.push({name:secret,value});
  c.env.push({name,valueFrom:{secretKeyRef:{name:secret,key:'1'}}});
}
for(const probe of [c.startupProbe,c.livenessProbe]) if(probe?.httpGet) probe.httpGet.port=port;
c.volumeMounts=[{name:'application-data',mountPath:'/data'}];
template.spec.volumes=[{name:'application-data',nfs:{server:e.FILESTORE_IP,path:'/'+e.SHARE}}];
for(const [file,data] of [['gcp-secrets.private.json',uploads],['gcp-service.private.json',config]]) {
  const target='deployment/'+file;fs.writeFileSync(target,JSON.stringify(data,null,2)+'\n',{mode:0o600});fs.chmodSync(target,0o600);
}
console.log('Private secret manifest and service configuration prepared.');
NODE
```

Upload these new secrets and grant only the runtime account access to them. Values go through standard input, not command-line arguments:

```bash
node <<'NODE'
const fs=require('node:fs'),{execFileSync}=require('node:child_process');
const secrets=JSON.parse(fs.readFileSync('deployment/gcp-secrets.private.json','utf8'));
for(const secret of secrets) {
  execFileSync('gcloud',['secrets','create',secret.name,'--project',process.env.PROJECT_ID,'--replication-policy=automatic','--data-file=-'],{input:secret.value,stdio:['pipe','pipe','inherit']});
  execFileSync('gcloud',['secrets','add-iam-policy-binding',secret.name,'--project',process.env.PROJECT_ID,'--member=serviceAccount:'+process.env.SERVICE_ACCOUNT,'--role=roles/secretmanager.secretAccessor'],{stdio:['ignore','pipe','inherit']});
}
console.log('Secrets created and runtime access granted.');
NODE
```

Run the creation step once for a new deployment. If a secret already exists, review its version instead of deleting it or generating a different encryption key. For updates use `gcloud secrets versions add SECRET --data-file=PRIVATE_FILE`, then change the service reference to the intended numeric version. Back up the vault key independently of Filestore. The private manifest contains values and must not be committed or printed; both private JSON files are excluded from exported image builds.

## 6. Deploy with storage, credentials and background CPU

```bash
gcloud run services replace deployment/gcp-service.private.json \
  --project="$PROJECT_ID" --region="$REGION"
gcloud run services add-iam-policy-binding "$APP" \
  --project="$PROJECT_ID" --region="$REGION" \
  --member=allUsers --role=roles/run.invoker
gcloud run services describe "$APP" --region="$REGION" \
  --format='value(status.url)'
gcloud run services logs read "$APP" --region="$REGION" --limit=50
```

The invocation binding makes the HTTP endpoint reachable without a Google identity token; the exported app still requires its own username/password for application routes. If your organization disallows public invocation, configure an appropriate gateway/authentication flow that preserves the application's authentication rather than discarding either requirement.

Open **APP_ORIGIN**, the deterministic URL configured in step 1. Cloud Run can also return another `run.app` alias; using a different origin without updating `WEB_APP_ORIGIN` causes browser action requests to be rejected. Custom domains likewise require an origin update. Public HTTPS uses port 443; the Cloud Run port/probes match the selected internal port and Cloud Run supplies `PORT` automatically.

Manual instance count `1` and CPU throttling disabled keep capacity/CPU available for a plugin that checks services in the background. This incurs instance-based billing while idle. A request-only tool may use a different CPU/scaling policy, but setting minimum instances alone does not guarantee background CPU under request-based billing. Processes can still restart; monitoring logic must recover its schedules/state after restart.

## 7. Verify and perform maintenance updates

Check startup logs for `/data` permission failures, unreachable NFS, missing secret versions or denied Secret Manager access. Verify `/health/ready`, sign in, change a setting, and confirm that the setting survives a controlled replacement. Cloud Run does not provide a normal `docker exec` console; use logs and an explicit diagnostic job/client for deeper inspection.

This export's file-based vault needs one writer. A one-instance setting is not a distributed lock; revision changes or platform replacements can overlap. For production scale-out or strict writer guarantees, move state to transactional managed storage or implement a writer lease. For a maintenance update of this reference service:

```bash
# Remove revision tags that could bypass service-level disabling.
gcloud run services update-traffic "$APP" --region="$REGION" --clear-tags
gcloud run services update "$APP" --region="$REGION" --scaling=0
# Wait for in-flight requests to finish and verify old writers have shut down.
# Build a new tag, regenerate the service JSON and pin intended secret versions.
# Keep manualInstanceCount at 0 in the replacement JSON while applying it.
gcloud run services replace deployment/gcp-service.private.json --region="$REGION"
gcloud run services update-traffic "$APP" --region="$REGION" --to-latest
gcloud run services update "$APP" --region="$REGION" --scaling=1
```

Explicitly set `metadata.annotations["run.googleapis.com/manualInstanceCount"]` to `"0"` in the replacement JSON during this sequence; the first-deployment generator defaults to `"1"`. Leave the service disabled until old writers are confirmed stopped. Retain Filestore, the same key, and numeric secret versions across updates; do not reuse traffic-splitting/tagged revisions against the same uncoordinated vault.

The runtime service account identifies the workload to Google APIs when granted the needed roles. It is separate from the user who ran `gcloud`, the build/pull identities, and the exported web app's sign-in. AWS/Azure CLIs inside this container need their own supported federation or runtime-secret configuration and appropriate FDO process-scope environment allowances.

## References

- [Cloud Run NFS volumes, ownership and no-lock behavior](https://docs.cloud.google.com/run/docs/configuring/services/nfs-volume-mounts)
- [Direct VPC egress](https://docs.cloud.google.com/run/docs/configuring/vpc-direct-vpc)
- [Cloud Run secrets](https://docs.cloud.google.com/run/docs/configuring/services/secrets)
- [Cloud Run service identity](https://docs.cloud.google.com/run/docs/securing/service-identity)
- [CPU allocation and billing](https://docs.cloud.google.com/run/docs/configuring/billing-settings)
- [Manual scaling and disabling a service](https://docs.cloud.google.com/run/docs/configuring/services/manual-scaling)
- [Deterministic service URLs](https://docs.cloud.google.com/run/docs/custom-urls)
