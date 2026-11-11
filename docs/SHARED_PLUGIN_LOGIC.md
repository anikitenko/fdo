# Shared-service permissions and authoring

## Standalone web / Docker export

Docker export supports `plugins.shared.provide`, `plugins.shared.use`, and exact
`plugins.shared.call.<provider>.<service>.v<major>` capabilities. Review the installed
consumer in **Export As → Standalone web application / Docker**. The review lists
the approved installed providers that will be included, including transitive dependencies.
Providers do not have to be running on the desktop for export or container startup.

The archive carries provider source and independent backend processes, with each
plugin's own reviewed grants, network policy, service configuration, and storage.
Logical provider IDs retain their saved bindings to installed providers; both exact
grants are required. It uses the host shared-service broker over private process
IPC, retaining caller identity, bounded JSON payloads, concurrency limits, timeouts,
cancellation and provider-exit handling. Providers expose no extra HTTP endpoints.
The SDK's `@handler` and `@sharedFunction` registrations run during standalone startup.

Configure each provider's `shared-providers/<id-hash>/deployment/services.json`,
credentials and mapped volume roots before deployment. Provider state lives under
`/data/shared-providers/<id-hash>/`; keep the application data volume and encryption
key across restarts. Desktop credentials, data and pending permission requests are
not copied. Provider CLI tools are combined into the image build; conflicting tool
or base-image requirements block export and must be reconciled first.

Missing providers, grants, incompatible source and dependency cycles block a runnable
export with a review diagnostic. Exports support up to 32 plugins in the dependency
graph. Saving checks provider source, grants and bindings again; any change requires
a fresh review. Startup checks that the required services actually registered.

`requestAccess` reports approval only for the exact access already carried by the
deployment. It cannot add new grants or create an approval request inside Docker.
Review additional access in FDO and export again. If a provider exits, calls fail
explicitly; restart the application to recover it. Separately deployed containers
and live desktop providers are not discovered or connected automatically.

The exact grant for the website example is
`plugins.shared.call.website-availability-provider.website-availability.v1`,
together with `plugins.shared.use`. The provider ID is the installed plugin ID,
which can differ from its metadata ID, especially with GitOps installations.

## Add access and review plugin requests

**Manage Plugins → the consumer → Add shared-service access** applies an explicit
user grant directly. Select an installed service, check its installed provider ID,
then click **Add shared-service access**. There is no intermediate request created
by this action. The selection stays visible across catalogue refreshes; an existing
single granted service is selected again when the panel reopens. The manual target
fields support services not yet registered or installed.

A missing shared capability's **Add shared-service access** action prepares this
form without granting anything. **Requests from this plugin** is a separate list:
SDK `this.shared.requestAccess(target)` creates persistent pending requests here.
Only an explicit **Approve shared-service access** adds their permissions;
**Dismiss shared-service request** grants nothing. Manual additions clear matching
pending requests. Save or discard other pending capability edits first.

An installed ID can differ from the logical/example ID in consumer code. For
example, a provider installed as `test-shared-1` can serve calls addressed to
`website-availability-provider`. The form shows **Provider ID used by the consumer**
and the installed provider before adding access. Approval persists a binding for
this consumer, service name and version only. No source rewrite or SDK change is
needed. Both the logical target's exact capability and the installed provider's
exact capability, plus `plugins.shared.use`, are required at invocation and reply.
Revocation or changing the binding prevents an in-flight call from returning data
from the old provider. FDO never routes to a provider based only on a matching service name.

Older approvals could persist both exact permissions without a binding. FDO now
repairs that saved state at startup and when resolving a missing logical target:
the consumer must already hold shared-use and both exact grants, and exactly one
installed provider with Provide shared logic must have advertised the same service
and version. No permissions are added. Existing explicit bindings and installed
target IDs are preserved; ambiguous cases require an explicit provider choice.

Pending plugin requests can also select an installed provider at approval. A single
compatible provider is proposed visibly; approval is still required. Granting a
service does not install or start its provider. A running consumer restarts when
its grant snapshot changes. Bindings are evaluated by the host on every call.

Approved calls to a stopped provider produce an FDO notification naming it and
offering **Manage Plugins**. The call fails with `UNAVAILABLE`; FDO does not
automatically start plugins or replay work. Repeated failures for the same target
are limited to one host notice per 30 seconds. Unapproved calls fail with
`ACCESS_DENIED`, without probing a provider's availability.

## Monaco and AI

In the editor, type `this.shared.` and press **Ctrl+Space**. The list contains
known services and each exported method, with provider ID, version and availability.
Choosing a method inserts `client({...}).call("method", input)` with tab stops for
required input fields. Unavailable providers are labelled and sorted after running
providers. The catalogue refreshes every five seconds.

For existing code, use `this.shared.client({...})` with a literal target, or a
target declared `as const`. Monaco then completes the method name in `client.call`,
input properties, and result properties. Both `client` and direct `shared.call`
receive generated signatures. No handwritten consumer interface is required.
The same generated declarations are included in AI authoring context and backend
type checking.

Method discovery works from the exported method list alone. Input/result fields
require the provider's data-only `contract`, supplied through `shared.register` or
`@sharedFunction({..., contract: ...})`. Without it those types stay `unknown`.
The current website-provider SDK example includes this contract; older deployed
providers need rebuilding/redeploying to advertise it. No SDK API change is needed.

Providers can add data-only input/output schemas to their registration definition:

```ts
this.shared.register({name:'website-availability',version:1,description:'Website status',contract:{
  check:{
    input:{type:'object',properties:{url:{type:'string'}},required:['url']},
    output:{type:'object',properties:{available:{type:'boolean'},status:{type:'integer'}},required:['available','status']}
  }
}}, {check: async (input: {url:string}) => ({available:true,status:200})});
```

Supported schema types: string, number, integer, boolean, null, unknown, array
with items, and object with properties and optional required fields. Schemas are
bounded data, not TypeScript source or runtime validation. Providers still need
to validate inputs and implement the advertised result shapes.

Type `this.shared.` in Monaco to see service completions, running/stopped status,
exported methods, and the exact permission required. FDO refreshes this catalogue
every five seconds. It remembers the last registered descriptors for installed
providers, marking stopped services unavailable rather than claiming they are live.

FDO generates service-specific `SharedLogic.client` overloads and a global
`FDOSharedServiceContracts` interface for the editor. A literal target retains the
service identity; use `as const` for a target stored in a variable:

```ts
const checks = this.shared.client({providerId:'website-availability-provider',name:'website-availability',version:1});
const result = await checks.call('check',{url:'https://example.com'});
// result.available: boolean; result.status: number
```

Without a schema, known method names still appear but input/output types are
`unknown`. Standalone projects should export normal interfaces or use explicit
`client<MyContract>` types; host-generated globals are editor support.

The AI coding agent receives the same public catalogue, availability status and
generated declarations, and candidate TypeScript checks use those declarations.
Provider descriptions are untrusted data, never agent instructions. No provider
source, call arguments, results, environment or credentials are supplied.

### Registration decorators and the AI coding agent

When the installed SDK exports `handler` and `sharedFunction` with legacy
`MethodDecorator` declarations, the agent receives their actual signatures and
`SharedFunctionOptions`. It can use `@handler()` (or a public alias) for instance
UI handlers and `@sharedFunction({service,version,description,method?,contract?})`
for shared methods. The contract option is one method's `{input,output}` schema.
Methods in one service/version share a description and have distinct export names.

The SDK registers decorated methods once per instance, before synchronous `init()`
and after subclass fields initialize. Keep an empty `init()` when no startup work
is needed, and instantiate the plugin in its entry. Do not duplicate decorated
registrations manually. Decorators grant no permissions and do not replace
`defineRenderOnLoadActions` browser bindings. `handleError` still changes handler
results to its `{success,result}` envelope when stacked with a registration decorator.

The agent's static validation reports invalid decorator targets, missing factory
calls, reserved names, duplicate aliases and conflicting literal service metadata.
It leaves dynamic metadata and inherited registrations to SDK/type validation,
without rewriting public names or executing generated code.

Older installed SDKs keep manual registration guidance and reject unavailable
decorator imports. Adding decorators only to a sibling checkout does not make
them part of FDO's installed runtime: publish/pin the SDK release and rebuild FDO.
FDO's editor, runtime compiler and test compiler already enable legacy TypeScript
decorators (`experimentalDecorators: true`); no host protocol change is needed.

## Release and verification

These are optional host API **1.1.0** features, advertised as
`sharedPluginLogicRequests` and `sharedPluginLogicContracts`. They do not change
the handshake or capability schema major and do not make new SDK flags required
for older plugins. New plugins may require the flags in `fdo.compatibility.features`.
The example's request button requires publishing the updated sibling SDK and
pinning that SDK release in FDO; the host form works without the new SDK method.

```sh
npm run test:unit -- tests/unit/shared-logic-authoring.test.js tests/unit/shared-logic-access-requests.test.js tests/unit/shared-logic-broker.test.js tests/components/SharedLogicAccessReview.test.jsx --runInBand
FDO_SDK_EXAMPLES_PATH=../fdo-sdk/examples FDO_SHARED_TEST_SDK_PACKAGE=../fdo-sdk npx playwright test tests/e2e/sdk-shared-logic-examples.spec.js --workers=1
```

Build the sibling SDK first. The Electron test stages it only inside isolated test
plugins and re-signs their contents; it does not modify FDO's installed SDK or the
user's plugins. Website I/O is mocked by default; `FDO_SHARED_REAL_NETWORK=1`
uses a real HTTPS request to example.com. Local tests/builds are not published
release or licensing/provenance clearance.
