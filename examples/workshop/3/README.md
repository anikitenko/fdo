# Workshop 3 — From FDO plugin to standalone Docker app

Take the GitHub Release Monitor from workshop 2, export it, and run the same tool in a browser without FDO running. Allow about 20–30 minutes to follow along; the planned video is approximately five minutes.

**Source:** use the complete [workshop 2 plugin](../2/README.md). This workshop changes its deployment, not its source. Import the `examples/workshop/2` folder, **not this `3` folder**. Existing workshop 2 installations can continue directly to step 2.

## 1. Before you start

- Install an FDO build containing **Container port** and the three **Cloud deployment guides** in Export As. These are recent additions; the version number `1.0.5` alone does not establish that your installed build contains them.
- Install and start Docker Engine/Desktop with **Docker Compose 2.24 or newer**. Check `docker version` and `docker compose version` in a terminal.
- Have internet access for the image/dependency downloads and GitHub's public API.
- Import, sign, grant permissions to, and activate the [workshop 2 example](../2/README.md). Check `anikitenko/fdo` successfully in FDO first.

The plugin needs these approved capabilities: `system.network`, `system.network.https`, and `system.network.scope.public-web-secure`. Declaring them in source does not grant them. No cloud account, GitHub token, AWS CLI or Azure CLI is needed for the local exercise. Local Node.js 24+ is optional; Compose can perform setup instead.

## 2. Export the installed version

1. Save and deploy any source edits first. Export reads the installed project, not unsaved editor changes.
2. Open **Manage Plugins**, find **GitHub Release Monitor**, and choose **Export As…**.
3. Set **Export format** to **Standalone web application / Docker (.zip)**.
4. Set **Container port** to `9090`. Changing it clears the previous review; select **Review installed version** again.
5. Wait for **Application conversion prepared**. Inspect **Capabilities and services** and **Deployment notes**. Configuration requirements and actual conversion blockers are different; follow any concrete instructions in your report.
6. Open **Azure deployment guide**. The dialog also lets you choose **AWS ECS Fargate** or **Google Cloud Run**, jump to a section, and copy code. Close the guide to return to Export As. Reading/copying does not execute commands or provision resources.
7. Select **Export web application** and save the ZIP. Extract it into a new working directory.

The ZIP is a runnable application project with Docker packaging. **Export does not build a Docker image or deploy a cloud service.** If the source or permissions change, review again before saving.

## 3. Build and start locally

Open a terminal **inside the extracted directory**, beside `Dockerfile` and `docker-compose.yml`. If port 9090 is occupied, choose another port in FDO and export again.

On macOS/Linux:

```sh
sh start.sh
```

On Windows PowerShell, or if you prefer explicit Compose commands on any platform:

```sh
docker compose --profile setup run --rm setup
docker compose up --build
```

Setup creates a private `.env` file once. Existing credentials and encryption keys are preserved. The first image build downloads dependencies and can take several minutes. Wait for the server's listening message, then open **http://localhost:9090**. Use `localhost` consistently: setup configures that origin for browser requests.

Sign in as `engineer` using `WEB_APP_PASSWORD` from your local `.env`. Open the file privately in an editor; do not show it in a recording or commit it. The browser's native sign-in prompt can look different on each operating system.

Compose maps `127.0.0.1:9090` to container port `9090`; this local setup is reachable from your computer. A cloud deployment uses its public HTTPS endpoint on port 443 and routes to the selected internal port.

## 4. Prove it is independent

1. Check `anikitenko/fdo` in the browser and read its **Checked** timestamp. The release tag comes from the live API and may differ from the video.
2. Quit FDO. Keep Docker and the Compose process running.
3. Reload the browser and check again. A new check still succeeds: the container has its own backend.
4. Check `anikitenko/fdo-workshop-no-such-repository-7ba9c1`. Verify the failed-check message and **Previous successful check (not refreshed)** label.
5. Restore `anikitenko/fdo` and retry.

This example makes **one request per click**. It does not poll in the background, automatically deploy a VM, or retain its form/last result after a page reload. A scheduled availability monitor is a different plugin; exporting one does not add scheduling to this example.

## 5. Understand what moved

| Exported file | Purpose |
| --- | --- |
| `backend/source/`, `backend/app.cjs` | Converted editable plugin source and runnable backend bundle |
| `frontend/`, `runtime/` | Browser interface, standalone host adapters and compiled public SDK contract |
| `Dockerfile`, `docker-compose.yml` | Build the non-root image and run it locally |
| `conversion-report.json` | Capability analysis and reviewed conversion details |
| `deployment/application.json`, `deployment/services.json` | Approved policies and deployment-specific service configuration |
| `deployment/toolchain.json`, `docs/TOOLCHAIN.md` | CLI installation requirements and setup guidance |
| `docs/AZURE_CONTAINER_APPS.md`, `docs/AWS_ECS.md`, `docs/GCP_CLOUD_RUN.md` | Bundled cloud walkthroughs |

FDO compiles the public SDK contract and replaces desktop communication with authenticated browser/backend requests. The exported application installs **neither Electron nor the FDO SDK package** and does not call back to the desktop app. Approved capability policies are carried into the standalone runtime. Desktop credentials, signing certificates and desktop data are not copied.

## 6. Keep access and data across restarts

| Item | Meaning |
| --- | --- |
| `WEB_APP_USERNAME` / `WEB_APP_PASSWORD` | Sign in to the exported application |
| `WEB_APP_SECRET_KEY` | Encrypt the standalone service vault; not a provider token |
| Provider credentials / cloud identity | Authorize the plugin's service or CLI operations; not needed by this public GitHub example |
| `/data` | Writable runtime storage, mounted as the `application-data` named volume by Compose |

Keep the private `.env` and named volume. Back them up separately if the application starts storing important data. Do not regenerate the encryption key for an existing vault. The sample's display is transient even though the host provides persistent storage.

To run in the background, stop the foreground Compose session with Ctrl+C, then:

```sh
docker compose up -d
docker compose ps
docker compose logs --tail 50 application
```

To stop and recreate the containers while keeping the named volume and local `.env`:

```sh
docker compose down
docker compose up -d
```

**Do not add `-v` to `down`** when retaining application data. Setup can be rerun without replacing an existing `.env`. Docker can still stop when the laptop sleeps or shuts down; keeping a service running independently of the laptop requires an always-on host, such as the cloud deployments below.

## 7. Optional: choose a cloud host

Use **one** of the bundled guides for your next deployment exercise. The video previews them; it does not create cloud resources.

| Platform | Guide in the ZIP | Storage used in the reference |
| --- | --- | --- |
| Azure Container Apps | `docs/AZURE_CONTAINER_APPS.md` | Azure Files mounted at `/data` |
| AWS ECS Fargate | `docs/AWS_ECS.md` | EFS mounted at `/data` |
| Google Cloud Run | `docs/GCP_CLOUD_RUN.md` | Filestore NFS mounted at `/data` |

Each guide covers image build/push, secrets, storage, ingress, health checks and updates. Review prerequisites and provisioned-resource costs before executing it. Set `WEB_APP_ORIGIN` to the actual public HTTPS origin and configure storage/secrets **before the first start**. Keep one active writer for file-backed data; replacing revisions requires an orderly handover.

For CLI-backed plugins, installation, login and IAM permissions are separate steps. The desktop executable or desktop login cache does not transfer to the cloud. Declare required image tools in the plugin's `package.json`, then deploy and export again. Use a deployment identity or injected provider credentials with the necessary permissions; allow required subprocess environment keys in the process scope. Do not design production login around `docker exec`: managed platforms do not all provide an equivalent interactive session. Follow the authentication section of your chosen guide.

The practical use case: an availability-monitor plugin can run on an always-on host while your laptop is off, provided the plugin itself implements monitoring and any deployment action. The release checker here establishes the export workflow without requiring provider secrets or creating infrastructure.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Missing port/guide controls | Use a build containing the recent export updates; restart FDO after updating |
| Edited repository immediately reverts | Re-export with the native form-control fix (conversion contract `2.1.1` or newer); old exports retain their generated runtime |
| Review is missing or export is disabled after a port change | Select **Review installed version** and resolve reported blockers |
| Docker daemon unavailable | Start Docker; check `docker version` |
| Port already allocated | Stop the conflicting service or select another export port and review again |
| Password rejected | Use the generated `.env` for this extracted app, not your FDO/provider account |
| HTTP 403 after changing the URL | Match `WEB_APP_ORIGIN` to the address used; prefer `http://localhost:9090` locally |
| Permission denied writing `/data` | The container runs as UID/GID 1000; ensure the mounted directory is writable by that identity |
| Expected API failure | Use a public repository with a published release; wait if rate-limited |
| Cloud CLI installed but unauthenticated | Configure runtime identity/credentials and provider authorization separately |

## Production material and contributor verification

- [Recording plan](../../../docs/workshops/03-standalone-docker/README.md)
- [Narration to record](../../../docs/workshops/03-standalone-docker/narration.md)
- [Draft YouTube description](../../../docs/workshops/03-standalone-docker/youtube-description.md)

Repository contributors with dependencies and a consistent built FDO can run:

```sh
node scripts/verify-workshop-three.cjs
```

This uses a disposable FDO profile, imports the actual workshop 2 source, checks it, exports through the real dialog, builds a real local Docker image, and exercises it in Chrome after closing the disposable FDO. It creates only local workshop resources, removes its own Compose containers/volume/image afterward, and writes screenshots plus a verification report under `artifacts/workshops/03-standalone-docker/`. The extracted app and its private generated `.env` stay in that ignored artifact directory. No cloud resources are created.
