# Live UI Editor: direction and implementation roadmap

Status: workspace preview and the first focused visual-to-code editing slice are
implemented, together with component building, batched drafts, draft Undo/Redo,
named CSS class creation/assignment, isolated/shared CSS editing, searchable
declarations, declaration removal, single and combined state-rule editing/preview, max-width
responsive editing/preview (including inclusive width comparison syntax) and custom maximum/minimum/range creation, inline
class-name validation, keyboard value editing, literal element attributes, color/opacity picking, single-length number/unit controls and margin/padding side editing,
2026-10-15. Design-time native/custom dialog and popover visibility/focus/Escape, dialog/form-body insertion and reordering, simple selector-list branch edits, supported same-scope cross-container moves (including eligible populated/styled subtrees) and existing click-action connections, rewiring and disconnection are implemented. Versioned local draft recovery now preserves unapplied edits and Undo/Redo across window/app restarts, subject to exact source and SDK compatibility. Broader property editors, draft migration and backend adapters remain planned. SDK component appearance editing supports local theme hooks, reset, color/opacity and dimension controls. SDK components also support managed motion presets and overlay entrance replay.

## When a render path needs an adapter

The static preview interprets a bounded expression language; it does not execute
the plugin. An unsupported-method message identifies a preview limitation, not a
plugin compile/runtime error. The source location points to the expression that
stopped interpretation. Source stays unchanged; the plugin can still be built and
run in the IDE. Broader expression and dynamic-layout adapters remain on the roadmap.

Statically resolvable `if`/`else` branches and early returns are supported,
including stylesheet guards such as `if (!styles.shell) return ...`. Only the
selected branch is interpreted. Block-scoped declarations, local helper defaults
and array tuple parameters such as `tabs.map(([id, label]) => ...)` are supported.
Dynamic conditions, loops and arbitrary side effects remain diagnostic; no
backend, constructor or frontend lifecycle code from the plugin is executed.
String and array `includes` are supported for read-only membership checks,
including an optional numeric start position. String searches accept primitive
values, and both forms count toward preview processing budgets.
Reviewed DOM text, input, semantic and nested helpers use methods marked
`staticPreviewSafe` with HTML/class-name results in the installed, validated DOM
authoring contract. Unknown contract majors and callback-bearing builder inputs
remain unsupported. Helper-generated markup can preview even where a dedicated
visual source-edit adapter is unavailable.

The Live UI heading and window title use the plugin's literal source metadata
name, falling back to its package name and workspace name. GitOps IDs remain the
workspace identity for synchronization and draft recovery.

String `replace` and `replaceAll` now support literal searches, bounded literal
regular expressions and source-mapped render callbacks. This covers chained HTML
escaping (for example `.replace(/&/g, "&amp;")`) and replacing a placeholder with
SDK-generated markup. Callbacks are interpreted with match/index/input arguments;
no workspace callback is invoked as native JavaScript. `replaceAll` regexes require
`g`, as in JavaScript. Replacement text supports `$$`, `$&`, prefix and suffix tokens.

Quoted attribute removal such as `.replace(/class="[^"]*"/g, '')` is supported,
as are single-quoted attributes and other literal attribute names. This audited
form requires the repeated character class to exclude the closing quote and
does not allow suffixes or alternatives. General `.*` patterns remain unsupported.

Supported regexes have at most 128 characters, g/i/u flags, no captures,
backreferences, alternation or general repetition. Fixed-width patterns and
character classes are supported, plus the audited linear patterns `\s+`,
`^\s+`, `[\r\n]+` and `\r?\n`. Complex patterns still report an adapter
limit. Replacements obey the existing 500 KB output, expression and cumulative
text budgets; output is assembled incrementally so expanding replacements cannot
allocate an oversized joined string before being rejected. Module initialization,
constructors, backend handlers, network access and arbitrary methods stay disabled.

Mapped SDK markup retains its existing source mapping through supported string
composition. Structural adapters remain conservative: string substitution does
not automatically make opaque literal HTML containers visually editable.

## Literal HTML renders

Plugins returning static HTML strings/template literals can now expose an Elements
hierarchy without being rewritten to SDK builders. The adapter parses rendered HTML,
attaches preview-only selection IDs, and retains verified source offsets separately
from string values. The actual JSON Inspector literal template is covered by a fixture.
Safe replace/replaceAll operations retain provenance only for unchanged source spans,
so this plugin's submit-to-button attribute replacement still preserves its tree.

Interpolated templates retain the unchanged source spans of each template part
and literal helper argument. Concatenation, array `map().join()` composition and
the SDK's stylesheet/script wrapper preserve those mappings. This keeps authored
headings, controls and helper-generated labels selectable instead of presenting
an opaque preview. A literal label passed into a helper edits its call argument;
captions beside icons or nested controls can be changed without replacing those
children. The Inspector identifies these as direct-text edits. Mixed fragments
with several separate text nodes remain protected rather than merging content.
Unique unchanged tag endings allow adding attributes and inline overrides beside
computed classes without replacing the interpolation. Shared, transformed or
computed attribute values stay protected, with cross-file edits written to the
file that actually owns the literal.

Selecting an element shows **Source-mapped HTML**. **Show in code** uses its original
source range. Leaf text can be edited through the existing draft, diff, Undo/Redo,
validation and Apply. Entities preserve HTML text and JS string syntax, including
backticks, dollar signs, backslashes and multiline text. CSS and bindings are retained.
Literal nodes now expose **Element attributes** for aria-label, aria-description,
title and input/textarea placeholder. Select the element, expand that section, then
set/add/remove a field through the shared draft. Values use the existing 500-character,
single-line validation. Explicit empty values remain distinct from missing attributes.
Only unique, unchanged HTML start tags can be edited; duplicate attributes, SVG tags
and tags changed by render replacements are read-only. Attribute edits preserve IDs,
classes, handler targets and ARIA references. **Element style overrides** now offers
per-element inline declarations: search a CSS property, enter a value (or use the
color/length controls), then **Preview style override**. The **Current style overrides**
list shows every local declaration and supports direct edit/removal. **Add another
override** clears the current property and focuses a fresh search without applying
anything; choose another property and preview it to append to the same style attribute.
**Reset style override**
removes that declaration so existing stylesheet rules can apply again. These edits
share Undo/Redo and Apply; shared classes and embedded stylesheets remain unchanged.

Existing inline declaration order, comments and priority are preserved. Duplicate
or malformed declaration lists and transformed/shared start tags remain read-only.
Hover/responsive rules stay in the stylesheet, and a stylesheet `!important` rule
can still win over a normal inline declaration. Supported literal containers now expose direct sibling reordering through
**Position in container**, Move up/down and the existing Blueprint Alt+Up/Down
shortcuts outside text fields. Selection follows the moved source; Undo/Redo restores
exact source bytes. Moves stay within one unchanged literal container, retaining
comments/separators, IDs, attributes, nested content and bindings. Opaque elements,
meaningful interleaved text, transformed regions and browser-inferred closing tags
block movement across them. Blocks containing script/style/template or foreign
markup also remain protected. Container insertion/removal, cross-container moves and
action changes are still code-only for literal HTML; SDK controls remain separate. Mixed-content text, changed replacement
spans, ambiguous origins, escaped source spans and compositions without
verified provenance stay conservative. Script/style/template contents are not exposed
as editable elements. The existing sanitizer, opaque iframe and disabled backend
execution remain in force. Mapping is bounded to 1,000 elements and 20,000 visited
nodes, within the 500 KB preview limit. Broader literal editing/provenance adapters
remain planned.

## SDK 1.6 host integration

The installed SDK is now 1.6.0. Review its packaged
`docs/AUTHORING_COMPATIBILITY.md`, `docs/AUTHORING_AND_LIVE_UI.md`,
`docs/UI_COMPONENTS.md`, generated UI API documentation and overlay examples when
working on host integration. The new ESM/browser entries are additive; their
presence does not supply a browser module to a plugin iframe automatically.

Implemented host compatibility work:

- Published DOM authoring and UI-component JSON exports are read through package
  exports, validated against their published schemas and negotiated independently
  at contract major 1. Unknown majors and malformed contracts are not accepted.
  Missing exports retain compatibility with legacy SDKs. Invalid/unsupported DOM
  contracts produce an explicit Live UI diagnostic before rendering.
- Validated contract JSON joins the existing packaged declarations/docs/examples
  in AI SDK knowledge. The cache refreshes when the installed package/artifacts
  change at the same path. SDK fingerprints include the JSON contracts/schemas.
- Shared provider-neutral generation guidance covers retained collectors,
  recursive styles, HTML-string results, paired textarea tags and frontend
  lifecycle/module boundaries. `/ui` imports participate in symbol retrieval.
- Monaco and candidate-workspace checking accept recursive CSS maps and published
  `/ui` declarations. Type availability is not a browser-runtime guarantee.
- Static preview gives supported helpers a preview-owned isolated collector and
  interprets bounded `collectStylesFrom` calls, including standalone attachment
  statements. Only tracked helpers are accepted; arbitrary callbacks/data and
  unsupported methods remain rejected. It does not drain legacy global styles.
- Validated component metadata enables static `createDialog`,
  `createConfirmationDialog` and `createPopover` composition. The restricted
  interpreter invokes only these audited SDK markup builders with a tracked DOM
  collector and plain data; it never invokes mounts, setup or handlers.
- Component roots map to their composition calls. Unique calls with literal
  options support text-property edits and body/footer additions using the normal
  draft, Undo/Redo, diff, Apply and revision-conflict checks. Body/footer content lists
  support adjacent reordering and safe inline removal. Existing slot children
  retain their own source maps. IDs, ARIA references, generated internal controls,
  component classes, general style maps, events and controller bindings stay in code.
  The dedicated appearance editor supports the documented SDK theme hooks below.
  Computed/shared options and repeated calls are explicitly read-only.
- The deployed iframe bundles the browser-safe SDK `/ui` entry under its existing
  CSP. `await window.loadFdoUi()` exposes a view-scoped module to serialized
  frontend callbacks; no external module URL or import map is required. Monaco
  and candidate typechecking include the loader declaration.
- Mounted roots and popover anchors must belong to the current plugin view.
  The host destroys owned controllers and registered declarative lifecycles
  before replacing markup, including error/unmount paths. Late setup cleanup is
  honored; disposed module handles reject further mounts. Authors must return
  cleanup for their own listeners and asynchronous work.

### Find and add SDK components

The SDK catalog now combines published DOM helper metadata with the validated
UI component contract. It lists Dialog, Confirmation Dialog and Popover alongside
legacy helpers; search matches component names and create/mount function names.
Unknown component adapters remain code-only, and unavailable contracts produce
an explicit explanation. A metadata listing alone never enables source edits.

1. Expand **SDK catalog** and select **main** or a supported nested SDK layout in Elements.
2. Choose **Add Dialog**, **Add Confirmation Dialog** or **Add Popover**.
3. The new component is selected and revealed in design preview. Its properties,
   body/footer slots and **Component appearance** are available in the inspector.
4. Use the existing draft Undo/Redo, diff and Apply controls. Additions and styling
   can share one Apply and restore group.

Insertion uses the selected DOM receiver's published SDK entry, adds a fresh
import alias without shadowing existing code, and assigns a unique HTML ID.
Existing module directives, content, styles and bindings are preserved. The first
creation adapter supports unique top-level `main` and supported nested SDK layout
containers. Every ancestor back to main must also be a unique editable SDK layout using the same DOM owner.
Forms, overlays, shared render sites and opaque wrappers are not insertion targets.

Each catalog component also lists **Inspect** buttons for existing instances.
Those select the component root and reveal its design preview directly. Ordinary
HTML/DOM elements, including hand-built `<dialog>` nodes, use the existing
stylesheet/CSS editor; the SDK-specific appearance editor only appears on mapped
SDK composition roots. The inspector explains that distinction.

Added components start closed in the deployed plugin. Design preview reveals
them without executing handlers. Dialog and Popover openers can now be connected
visually as described below. Custom actions and confirmation callbacks still need
frontend code; adding markup grants no backend capability.

### Connect a deployed Dialog or Popover opener

After adding an SDK Dialog or Popover, select a static container and add a
**Button (unconnected)**. Select that button, then choose its target under
**Open SDK component → Overlay to open**. The button becomes enabled, and its
text can be edited normally. The deployed plugin opens the target with the SDK's
native controller; Dialog Cancel/Escape and focus return, plus Popover anchoring
and `aria-expanded`, use SDK behavior.

**Disconnect overlay opener** disables the button and restores its unconnected
state. Retargeting, disconnecting and text changes share the normal draft,
Undo/Redo, diff and Apply. Existing `renderOnLoad`, setup, handlers, styles and
plugin tests stay intact. A connected button must be disconnected before it can
be removed with the generic structure controls.

This first adapter accepts only unique, unmodified Live UI buttons and unique
SDK roots with literal IDs. Each target has one opener. Existing custom
controller code, shared/referenced targets and custom click bindings remain
read-only. Confirmation dialogs require an explicit confirm callback and are not
offered as implicit opener targets. Preview clicks remain selection-only; use
Overlay preview to inspect design states.

The host markup contract is an enabled `button[type=button]` with
`data-fdo-ui-open="component-id"` and matching `aria-controls`; dialog openers also
have `aria-haspopup="dialog"`. FDO mounts controllers within that plugin view and
removes listeners/destroys controllers before replacing markup. It does not run a
backend action or invent a confirmation callback. Foreign, missing, duplicate or
unsupported targets are rejected. SDK code using `window.loadFdoUi()` remains
available for custom mounting.

Render deduplication now compares the complete markup/on-load payload instead
of its length/prefix. A different same-length label, target or frontend action is
therefore delivered correctly; exact duplicate payloads remain suppressed.

### Arrange SDK body/footer content

Select an SDK Dialog, Confirmation dialog or Popover root in Elements or via an
**Inspect** button in **SDK catalog**. The **Dialog content / Confirmation Dialog
content / Popover content** disclosure appears first in the inspector. Inside it,
**Component slot** switches between **Body · Main content** and **Footer · Bottom
content**. Body/footer are areas inside these SDK components, not global menus.
Selecting an ordinary child shows its own inspector; **Edit Dialog content** (or
Popover/Confirmation Dialog) returns to the containing SDK root and scrolls its
content controls into view. Hand-built HTML dialogs use the existing Structure
controls; SDK-specific slots require a mapped published SDK composition call.

Its content list has a **Position** selector, Up/Down, **Inspect**, Duplicate,
Remove and **To body / To footer** controls. Choose a position to move several
places in one draft operation. Positions across opaque/shared fragments are disabled.
**Inspect** selects the block's normal text/style inspector; **Edit Dialog content**
returns to the SDK root. Inspection alone does not create an edit.

Duplicate inserts a separate inline composition immediately after a safe block.
The copy has its own source mapping, so literal text edits affect only the selected
copy. Styles initially retain their existing class; the CSS editor's default
per-element isolation still applies. Only safe inline leaves or empty containers
can be copied. Named fragments, repeated calls, IDs, action targets, nonempty
containers and SDK-generated controls stay protected. Changes accumulate in the same
visual draft; Undo/Redo and Apply work as for properties and styles.

Only uniquely mapped direct fragments can move, and both adjacent fragments must
be supported. Inline audited DOM compositions and named mapped fragments can
reorder; custom/shared fragments remain visible as read-only entries. Removal is
limited to safe inline leaf content or empty containers. Action targets, nonempty
containers and named fragments stay protected; removing named content also needs
its declaration updated in the IDE. SDK-generated actions/status/error slots are
never exposed. **To body / To footer** appends a supported fragment to the other
slot within the same component, creating the missing property when needed. The
source fragment becomes an empty placeholder. Named fragments retain their
existing declarations, and DOM identities/attributes remain intact. Custom helper
evaluation scopes and unsupported/shared fragments stay in code. Empty slots
show an explicit empty state and the addition controls.

Source edits preserve comments, parentheses and separators. Removal leaves an
empty string in the composition; the content list omits these empty placeholders.
No controller, frontend handler or backend code runs during preview.

### SDK component appearance

Select a source-mapped SDK Dialog, Confirmation Dialog or Popover, then expand
**Component appearance**. Choose background/text color, maximum width, padding,
corner radius or border. Dialogs also expose backdrop color; confirmation dialogs
expose error color. Colors include the existing color/opacity picker; dimensions
and padding include the existing length/unit and spacing-side controls. Enter
previews the current valid value; **Preview appearance** does the same explicitly.

The editor writes documented `--fdo-ui-*` hooks inside that call's
`options.style`. It creates missing literal option/style containers and preserves
existing classes, unrelated declarations, nested rules, slots and handlers. Other
components keep their original styling even when their previous generated class
was identical. Shared/imported/computed objects, spreads, duplicate keys and
computed property values remain read-only with an explanation.

**Reset appearance override** stores `null` for that local hook. SDK style
collection omits it, allowing SDK defaults or inherited theme values to apply;
it does not remove other styling or force a global theme. Changes use the same
batched draft, Undo/Redo, diff, validation, Apply and restore group. IDE changes
refresh the appearance map under the existing revision/conflict rules.

Only documented appearance hooks are writable here. Controller-owned visibility,
positioning and pending state remain protected. Host validation rejects markup,
URLs, comments and rule separators; the inspector also checks CSS values against
the browser. Ordinary CSS still applies its normal cascade and may override a
component theme value.

### Component motion and replay

Select an SDK Dialog, Confirmation Dialog or Popover root and expand
**Component motion**. Choose Fade, Fade and scale, or Fade and slide, with a
50–2000 ms duration and easing. **Preview motion** stages real source changes;
Undo/Redo, diff, Apply and the existing restore group cover motion edits too.
**None** removes only a preset created by this editor. Ordinary element selection
no longer displays the repeated “Looking for Component appearance?” callout;
component-specific help stays in the SDK catalog and component inspector.

Presets live inside a literal `options.style["&"]` group. They use native
`[open]` / `:popover-open` transitions, `@starting-style` and discrete
`display`/`overlay` transitions. They preserve other appearance properties and
controller-owned positioning/visibility. A reduced-motion media rule disables
transitions and movement. The emitted CSS also works in the deployed SDK
controllers; it is not a preview-only animation. Existing custom motion, open-state
rules, computed/shared style objects and modified preset groups remain read-only
instead of being overwritten or adopted silently.

Use **Replay entrance** beside the overlay selector to reopen the current design
overlay. It creates no draft operation, workspace edit or snapshot, and runs no
plugin handler. Replay is available for existing mapped overlays too: it replays
their authored CSS rather than inventing a different animation. A new close or
selection cancels a pending replay. SDK popover exit transitions can finish before
preview concealment; a close completion cannot conceal a reopened popover.

Browser/Electron integration checks cover live CSS transitions, replay without
workspace changes, reduced motion, Undo/Redo, preset removal, Apply and reopening
during popover exit. Deployed dialog/popover controllers are checked for actual
opacity transitions, focus restoration, pending-operation teardown and reduced
motion inside the production sandbox.

### Mounting SDK components in deployed plugins

Compose markup in backend `render()` using `DOM` and `createDialog` (or the
confirmation/popover builder) from the same `/ui` entry, finishing with
`dom.renderHTML(...)`. Mount in a self-contained frontend callback, for example:

```ts
function renderOnLoad() {
  return defineRenderOnLoad(async () => {
    const ui = await window.loadFdoUi();
    const root = document.querySelector<HTMLDialogElement>('#settings');
    const button = document.querySelector<HTMLButtonElement>('#open-settings');
    if (!root || !button) throw new Error('Settings controls are missing');
    const controller = ui.mountDialog(root);
    const open = () => controller.open(button);
    button.addEventListener('click', open);
    return () => {
      button.removeEventListener('click', open);
      controller.destroy();
    };
  }, {language: 'typescript'});
}
```

`defineRenderOnLoad` is imported from the SDK root in backend code.
Serialized callbacks cannot capture imported mount functions or backend state.
Use the existing capability-checked request transport for backend work; loading
UI components grants no backend capabilities. Confirmation callbacks must honor
cancellation signals when doing asynchronous work.

The standalone design preview only simulates visibility/focus/Escape. It does
not mount these controllers, execute setup or send backend requests. Arbitrary
custom components, runtime-generated options, new event wiring, arbitrary component root style-map editing and backend
simulation remain outside this adapter.


### Verification

The opener extension passed 343 focused tests across 31 suites, plus eight
render-content and shared authoring-contract checks. Both builds and two native
Electron scenarios passed. The visual scenario connects two openers, checks
disconnect/Undo, applies and deploys into the production iframe, verifies native
Cancel/Escape/focus, preserves the original backend action and reconnects after
rerender. The SDK lifecycle regression also passes. Its inspector screenshot was
reviewed.

The motion extension passed 343 focused unit/component tests across 29 suites,
both builds and three distinct native Electron scenarios (Live UI motion,
deployed SDK controllers and existing custom overlays). Targeted checks were
rerun after the final popover exit/reopen guard.

The catalog/creation extension passed 322 focused tests across 26 suites, both
development builds and two native Electron scenarios. The new scenario starts
from Blank, creates all three components through the catalog, opens appearance
automatically, styles the new popover, checks Undo/Redo, validates Apply and
reopens an existing dialog through Inspect. Its screenshot was reviewed.

The SDK host integration baseline passed 355 focused unit/component tests across
29 suites. The appearance extension passed 329 focused tests across 25 suites,
plus native Electron appearance and component property/slot scenarios. Appearance
checks cover local color changes, unchanged neighbors, reset, Undo/Redo, validated
Apply and IDE-to-preview refresh; its screenshot was visually reviewed.
Development main and
renderer builds passed (main retains its existing `js-yaml` `safeLoad` export
warning). Native Electron scenarios verify:

- Component properties/slots through draft Undo/Redo, Apply and IDE-to-preview
  refresh (`tests/e2e/live-ui-editing.spec.js`).
- Real mounts, Escape/focus restoration, view ownership, pending confirmation
  cancellation, cleanup before DOM replacement and stale-handle rejection in the
  production `allow-scripts` iframe. Parent-document access is denied; no new CSP
  relaxation is needed (`tests/e2e/sdk-ui-components.spec.js`).
- All eight starter templates and their deployed interactions
  (`tests/e2e/plugin-templates.spec.js`).

The SDK 1.6 initialization script returns a cleanup function. The host now
executes that script within the view lifecycle and retains its cleanup, rather
than immediately invoking cleanup as an initializer. Ordinary function-based
`renderOnLoad` callbacks remain supported. Regression tests use the installed
SDK's actual generated action script.

## Remaining work at a glance

The editor already supports source-backed drafts, SDK component composition, collection
items, styles, generated local/text/JSON actions and isolated mock responses. The remaining
work is broader than additional inspector controls:

1. **Interaction authoring:** extend SDK async buttons beyond the local/text/JSON presets, extend confirmation flows beyond explicit text results, and extend Toast Region queues beyond explicit enqueue buttons to notification routing.
   Static states and initial toast composition work. Local/text/JSON async actions and
   text confirmation flows supply their own controller wiring; custom callbacks and queue
   wiring still require the IDE.
2. **Layout and source adapters:** Dashboard/divided/Resizable layouts, Split Grid lifecycle
   preservation, broader static expressions, cross-container/component moves and dynamic
   or custom overlay patterns. Unsupported expressions must retain a useful source location.
3. **Backend authoring and simulation:** more operation presets, nested payload/result
   mappings, richer output types and cancellable progress. Local actions, text/JSON handler
   generation, result mapping and controlled loading/success/error/latency simulation are
   implemented. Design previews must continue to avoid real services and arbitrary handlers.
4. **Durable drafts and AI collaboration:** version-1 local draft recovery across window/app
   restarts is implemented. Next: migrate saved operations and richer selection context, and coordinate AI edits
   with pending visual edits under revision/validation/guide-approval rules. Selected
   collection-item context still lives in the open editor session; draft Undo/Redo is persisted.
5. **Advanced styling:** compound/nested conditions, additional media features/units,
   complex selectors and broader property widgets. Supported width ranges, interaction
   states, selector-list branches, class assignment, colors, lengths and spacing are implemented.
6. **Integration coverage:** expand end-to-end checks across these adapters, templates and
   supported platforms, including runtime CSP, focus, accessibility and controller disposal.
   Current regression coverage validates supported slices, not every SDK authoring pattern.

## What works now

Open a plugin in the IDE and choose **Live UI editor**. The separate window shows
an element hierarchy, a preview that fits the available space, a focused inspector,
and a collapsible SDK catalog. The legacy graph and preview-width selector have
been removed. Resize the window to see the layout at different available widths.

Source/CSS changes are published while connected (750 ms checks, skipped during
snapshot restore). Static rendering is tested against all eight bundled templates.
The restricted interpreter never runs module initialization, plugin constructors,
init, backend handlers or renderOnLoad. Unsupported expressions produce a source
location and explanation. Native top-level dialogs can be opened explicitly for
design and hidden children can be selected/edited. Plugin-driven dialog actions,
backend actions and dragging Split Grid gutters are not simulated yet.

### Design a native dialog

For a statically rendered, source-mapped top-level `<dialog>`, **Dialog preview**
offers **Dialogs closed** and each eligible dialog with its source location. Choose
one to show it in the iframe's native top layer, including the emitted `::backdrop`
styles. Selecting a dialog or its mapped child in Elements also reveals it;
selecting an element outside closes it. Only one design dialog is shown at a time.
Nested/unmapped overlays and dynamic creation need later adapters. Custom dialogs
and popovers use the additional bounded adapter described below.

Dialogs start closed in design preview, even if their source contains `open`.
The preview-only state never changes source attributes, creates a draft step or
saves a snapshot. **Close dialog preview** or native Escape closes the dialog;
Escape also synchronizes the selector. Focus and Tab use native modal behavior,
with the dialog's original descendant tab order restored while open. On closing,
the bridge restores the previous in-frame focus where available. Selecting the
child again, or choosing the dialog from the selector, reopens it.

This remains selection mode: clicking Configure, Save or Cancel selects the
control without running its plugin handler. Form submission, backend actions,
validation and real services remain blocked. The fixed host bridge alone calls
`showModal`/`close`, accepts only mapped eligible dialogs and requires the parent
window and current token. No renderOnLoad/setup/handler code is evaluated.

Edit dialog text, attributes or supported styles with the usual draft controls.
The shown dialog is restored after a candidate rerender while its selection
remains inside; Undo/Redo and validated Apply keep the real bindings unchanged.
Closing the preview does not discard a draft. Opening/reopening a new Live UI
window starts with dialogs closed again. Modal layout is bounded by the actual
iframe viewport, so large dialog content can require its own native scrolling.

Supported static `dialog` and `form` bodies now expose **Structure → Add component**
and direct-child arrangement. Add the existing text, input, disabled button,
container or result presets with their current SDK DOM instance. New buttons keep
`type="button"` and start disabled; no implicit form submission is introduced.
Direct children can be reordered with the existing controls and Undo/Redo.
Original form names, action targets, handlers, CSS and modal relationships are
retained. SDK overlay creation is available through the component catalog above.
Generic dialog/form creation and moves between these bodies are not included:
dialog/form roots and their direct contents do not expose cross-container moves,
and dialog/form bodies are not offered as cross-container destinations. Existing
non-empty/linked-content removal protections still apply.

### Design custom dialogs and popovers

Top-level source-mapped elements with `role="dialog"` or `role="alertdialog"`,
and elements with a native `popover` attribute, are now discovered alongside
native dialogs. When either kind exists, the controls say **Overlay preview**,
**Overlays closed** and **Close overlay preview**. Options identify custom dialogs
and popovers explicitly. Selecting a mapped child reveals its containing overlay.
Only one overlay is shown at a time, including when switching between kinds.

Custom-dialog preview removes the root's `hidden` attribute and sets its
`aria-hidden` to false. It retains the authored classes, positioning and inline
styles; it does not guess open/closed class names or execute handlers. If the
root's computed display remains none, preview temporarily overrides just that
property with `display: block !important`, as explained beside the controls.
Authored visibility changes driven by selectors such as `[aria-hidden="false"]`
take effect before that fallback. Hidden ancestors, class transitions, separate
backdrops and arbitrary popup conventions are not simulated. A root still hidden
by other CSS such as visibility/opacity needs editing in the CSS field or IDE.

Custom roots receive preview focus. For a custom dialog with `aria-modal="true"`,
Tab/Shift+Tab cycle through its available descendants, or focus the root if none
are available. This is a design focus helper, not a recreation of a framework's
modal manager; unrelated content is not made inert by the custom adapter. Escape
and the external close control hide the overlay and restore prior in-frame focus
where available. Real buttons remain selection targets with no handler execution.

Native popovers use `showPopover`/`hidePopover` and the real top layer. Preview
temporarily sets `popover="manual"` so author-specific light-dismiss behavior does
not race element selection. Escape and the external control close them explicitly.
No invoker positioning or JavaScript positioning library is simulated; authored
CSS governs layout. Modal keyboard trapping is not applied to nonmodal popovers.

Visibility overrides, `aria-hidden`, tabindex changes and manual popover mode are
preview-only. They never enter draft patches, workspace source, snapshots or
deployed code. Text/style edits, Undo/Redo, source conflicts and validated Apply
use the existing workflow, preserving the plugin's real hidden state and handlers.
Creating an overlay preset, nested overlays and framework-specific popup adapters
remain future slices. To opt existing SDK markup into this adapter, use an
explicit dialog role or the native popover attribute rather than a guessed CSS class.

### First visual-to-code workflow

1. Select an element in the preview or element hierarchy. **Show in code** opens
   its mapped SDK call in Monaco. Moving the Monaco cursor into a supported call
   selects the corresponding element in Live UI.
2. Choose a supported edit: plain literal text, an existing top-level CSS
   declaration, or a supported missing declaration on an unambiguous base class. Computed content, raw HTML fragments and unmapped styles stay
   read-only. Direct edits to imported/conditional/complex-selector declarations and
   duplicate declarations of the same property are not writable in this slice.
3. **Preview change** updates the candidate without changing the workspace.
   Expand **Source diff** to review all changed files. Shared text/style sources
   show their current rendered-use count.
   CSS edits default to **This element only**: the first edit copies its effective
   class and assigns the copy to this element. **Shared class** explicitly edits
   every use of the original selector, including uses outside this preview.
   CSS edits affect the chosen base or supported state declaration; preserved
   complex selectors/media rules may override
   it at the current size. Continue making supported edits in the same draft,
   including changes to other elements and CSS files; the IDE remains unchanged.
4. **Apply to workspace** validates the complete candidate through TypeScript and
   the normal build contract. The owning IDE rechecks source and snapshot identity,
   preserves a restore point and persists the edited workspace in a grouped
   working snapshot in one transaction for the entire draft. Use the IDE's
   Recent/Timeline controls to restore.

Behavior tests remain an explicit IDE action; Apply does not run plugin backend
code or generated tests automatically. The SDK call and handler bindings are
preserved. Text entered through the inspector is escaped before being stored as
an HTML-producing string literal. Existing CSS values replace a parsed declaration
only; adding a property clones and updates its single base rule. Element isolation
adds a separate class and changes only the selected SDK call’s class expression.
Both paths preserve unrelated rules, comments, states and media queries.

Source or snapshot changes invalidate a pending draft. The candidate/diff remains
visible with **Source changed**, Apply is disabled, and Discard returns to current
source. Validation failures leave the draft retryable. A repeated Apply of the same
successful draft does not duplicate the edit. Snapshot-persistence failures roll
back the source edit and snapshot pointers; storage-restoration problems are
reported explicitly. Each successful edit records snapshot context for later AI
requests and invalidates any older in-flight AI apply.

### Design groups and checkpoints

Consecutive **Apply** operations in one Live UI session update one persisted
working snapshot instead of creating a snapshot for every click. The first edit
preserves the complete pre-design workspace as its restore point. If the current
snapshot already exactly matches all workspace files, it is reused as the restore
point; otherwise a new restore point captures unsaved edits. Every successful
Apply still saves the latest source to storage and validates TypeScript/build.
A hundred uninterrupted design edits therefore add at most two snapshots, rather
than two hundred. Previewing or discarding a draft creates no snapshots.

On the draft review, select **Keep this change as a checkpoint** when reaching a
milestone. Apply saves that milestone and seals the group; the next edit starts a
new working snapshot. Source changes outside Live UI (including guide/documentation
files), AI edits, restores, renamed/deleted snapshots, snapshot branching and a new
Live UI session prevent continuation of the previous working group. Earlier saved
checkpoints and restore points are never overwritten by grouping.

The IDE owns group state and checks exact workspace contents, snapshot identity,
restore revision and snapshot ancestry before updating a working snapshot. Only
the current, latest, unbranched snapshot tagged for that Live UI session may be
updated in place. Persistence failures restore the previous content, snapshot
pointers and stored workspace; a failed edit does not advance its group.

**Restore returns to the start of the entire applied group**, not the preceding
individual visual edit. **Undo/Redo** works inside an unapplied draft; after Apply,
use workspace restore points. Use explicit checkpoints
for milestones you want to restore independently. Group tracking is session-local;
the latest working snapshot itself is persisted normally and remains saved after
closing the window or restarting FDO. The next session starts a new group rather
than modifying that previous snapshot. AI history identifies each apply as an
update to a working snapshot and uses the latest workspace files.

### Arrange freely, then Apply once

Movement controls live beside the canvas and stay available while a draft is open.
**Move up** / **Move down** immediately update the draft preview and retain the
selected element. For a large move, **Position in container** jumps directly to
any supported slot, including first/last. The movement buttons align with the
bottom of the position selector and wrap when space is limited.

**Move to container** immediately appends the selected element to an eligible
container in the same draft. Options include source file/line to distinguish
similar containers. This first adapter moves existing identifier-backed elements
without relocating their definitions or action bindings, plus supported inline SDK
compositions. Populated groups can include nested same-instance `createElement`
calls, string concatenation, literal attribute maps and primitive inputs. Direct
`createClassFromStyle(styles["key"])`/`styles.key` registrations are supported for
verified imported stylesheet bindings, so visually styled elements and populated
containers do not have to be rebuilt to move them. The destination
must use the same DOM instance and render scope; referenced variables must already
be available when that container is rendered. The current parent, the element
itself, its descendants, repeated/dynamic regions and other render scopes are
excluded. Each primitive/CSS binding must have the same value at the source and
destination. The adapter checks names against the destination's captured render
scope, not just source spelling. Calls to render helpers such as `escapeText()` or
`classFor()`, spreads, arbitrary object access, computed SDK methods and unsupported
expressions keep their evaluation site and stay in the IDE. The arrangement area
explains unsupported compositions or the absence of an eligible destination.
This is a bounded syntax adapter, not a general refactoring/effect-analysis engine.

Moves preserve surrounding comments and concatenation by leaving an empty string
at the old composition site; empty placeholders do not appear as arrangement
slots. This preserves code rather than reformatting it. Returning to the original
container may still leave a source difference; Undo restores the exact original
source. Each move is one Undo/Redo step, retains selection (including inline SDK
calls), and can be combined with text/style edits before a single validated Apply.
The existing up/down controls continue to arrange children within their new parent.

**Alt + ↑ / ↓** moves the selected element using BlueprintJS `useHotkeys`.
`KeyComboTag` renders the platform's key labels (Option on macOS, Alt on Windows
and Linux), and Blueprint's hotkeys help lists these commands under Live UI editor.
The shortcuts work from the Live UI window and from the preview iframe, not just
when the element list is focused. Inspector text inputs/editors retain their native key
behavior. Moving is disabled at the first/last slot, for ambiguous elements, while
an operation is running, during a source conflict and after disconnection. Held-key
repeat is ignored; use the position selector for a long move.

The sandbox's fixed bridge forwards only those two Alt-arrow key presses. The
parent checks iframe identity, opaque origin, current token and the permitted key
before routing it through Blueprint's document hotkey handler. Workspace handlers
and arbitrary keyboard shortcuts are not enabled in the iframe.

Continue selecting elements in the hierarchy or canvas while drafting. Add,
remove, reorder, edit text and change supported CSS values in the same draft,
including across multiple existing files. **Undo** / **Redo** reverses/reinstates
unapplied operations; making a new edit after Undo discards that redo branch.
While the full draft history is retained, Undoing everything leaves no source
changes and disables Apply while retaining Redo. Moving an element back to its original place also disables Apply if the net
diff is empty. Discard drops the entire draft without creating a snapshot.

**Apply to workspace** validates all changed files together, then commits and
persists them as one design-group update. A write or persistence failure rolls
back every file and the snapshot transaction. The normal revision/conflict guards
still apply. Source diffs are collapsed by default; expand them to inspect each
file. **Show in code** is disabled while a draft exists because its locations refer
to candidate code that is not yet in the IDE.

Draft selection is remapped by host-owned source ranges and movement provenance,
including inline SDK calls whose temporary element IDs change after reordering.
The draft summary shows **changed files**, derived from differences against the
workspace, rather than the number of actions in Undo history. Repeated movements
within one render file remain one changed file. Moving back to the original
composition removes that file from the summary; if every file matches the base,
**No unapplied changes** is shown and Apply is disabled. Undo/Redo does not inflate
the count, and source diffs use neutral source/stylesheet descriptions rather than
presenting action-history totals as pending work.

Undo history retains up to 100 operations and four million characters. Older
steps roll off automatically so a long arranging session can continue; this does
not remove pending source differences or modify workspace files. When history has
rolled off, a notice explains that Undo reaches only its retained baseline.
**Discard** still returns to the workspace source, even when older Undo steps are
no longer available. An individual operation exceeding the history budget is
rejected without changing the draft. Drafts and their Undo history remain session-local and are lost when closing the Live UI window. Backend
simulation and durable drafts remain future work.

### Preview boundary and lifecycle

The preview uses trusted installed SDK DOM methods and the production CSS
transformation, with bounded expression/depth/text budgets. Workspace scripts,
event handlers and navigation/resource attributes are stripped. The opaque sandbox
iframe permits only a fixed, nonce-authorized host selection bridge, with resource
requests blocked. Selection messages must match the current iframe, token and
source-mapped element; they cannot write files. All edits are proposed and checked
by the host, then applied only by the owning IDE.

Sessions are scoped to their IDE and visual window. Source/snapshot changes produce
revisions, and stale results are ignored. **Show IDE** focuses the owner; Live UI is
independent, not always on top. Owner closure/reload disconnects and retains the
last preview; reopen Live UI from the IDE to reconnect. Visual-window closure
releases its session. Unapplied drafts and Undo/Redo history are saved locally and
offered for explicit recovery when reopening the same workspace. Source/SDK changes
block automatic restoration; recovery never applies files by itself.

Implementation entry points:

- [WorkspacePreview.jsx](../src/components/live-ui/WorkspacePreview.jsx): hierarchy,
  inspector, SDK catalog, draft review, conflict feedback and Apply.
- [EditorSection.jsx](../src/components/live-ui/EditorSection.jsx):
  reusable native disclosure cards with Blueprint icons and keyboard focus.
- [classNames.js](../src/utils/plugins/authoring/liveUi/classNames.js):
  shared class-name validation and correction messages for the form and host.
- [useLiveUiConnection.js](../src/components/live-ui/utils/useLiveUiConnection.js):
  IDE source/selection publication, source reveal and validated apply relay.
- [liveUi.js](../src/ipc/liveUi.js): sender-scoped sessions, revisions, proposal and
  apply coordination, duplicate suppression, SDK metadata and owner lifecycle.
- [staticPreview.js](../src/utils/plugins/authoring/liveUi/staticPreview.js):
  restricted AST interpreter and source/style mappings.
- [cssResponsive.js](../src/utils/plugins/authoring/liveUi/cssResponsive.js):
  preset widths, query parsing/identity, max/min/range validation and boundary previews.
- [cssStates.js](../src/utils/plugins/authoring/liveUi/cssStates.js):
  canonical single/combined state names and strict selector matching shared by the host, inspector and preview bridge.
- [selectorListEdits.js](../src/utils/plugins/authoring/liveUi/selectorListEdits.js):
  separates an editable branch from a simple CSS selector list, retaining the other branches and declarations.
- [cssColors.js](../src/utils/plugins/authoring/liveUi/cssColors.js):
  color-property detection, literal color reading and explicit hex/alpha formatting.
- [cssLengths.js](../src/utils/plugins/authoring/liveUi/cssLengths.js):
  supported single-length properties, literal parsing and property-specific sign/unit checks.
- [CssLengthEditor.jsx](../src/components/live-ui/CssLengthEditor.jsx):
  number/unit controls that update CSS text before explicit preview, with invalid-input feedback.
- [cssSpacing.js](../src/utils/plugins/authoring/liveUi/cssSpacing.js) and
  [CssSpacingEditor.jsx](../src/components/live-ui/CssSpacingEditor.jsx):
physical margin/padding shorthand expansion and per-side fields, retaining untouched sides and explicit preview.
- [CssColorPicker.jsx](../src/components/live-ui/CssColorPicker.jsx):
  native color input, opacity slider and text-preserving fallback controls.
- [cssProperties.js](../src/utils/plugins/authoring/liveUi/cssProperties.js):
  runtime CSSOM discovery, property syntax checks, search ranking and common value presets.
- [CssPropertyPicker.jsx](../src/components/live-ui/CssPropertyPicker.jsx):
  Blueprint Suggest search, Existing/Add labels and keyboard property selection.
- [attributeEdits.js](../src/utils/plugins/authoring/liveUi/attributeEdits.js):
  literal attribute discovery, managed-field guards, validation and host-owned edits.
- [AttributeEditor.jsx](../src/components/live-ui/AttributeEditor.jsx):
  attribute selection, keyboard preview, removal and accessible validation feedback.
- [sourceRanges.js](../src/utils/plugins/authoring/liveUi/sourceRanges.js):
  shared comment-preserving node/comma removal for attributes and action bindings.
- [actionBindings.js](../src/utils/plugins/authoring/liveUi/actionBindings.js):
  syntax-only click-action discovery, ownership/reference guards and atomic connect/change/disconnect edits.
- [sourceEdits.js](../src/utils/plugins/authoring/liveUi/sourceEdits.js):
  supported text/CSS edits and routing semantic operations against host-owned source ranges.
- [styleIsolation.js](../src/utils/plugins/authoring/liveUi/styleIsolation.js):
  effective SDK style copying, selector serialization and unique local-class planning.
- [styleAssignments.js](../src/utils/plugins/authoring/liveUi/styleAssignments.js):
  eligible source/style bindings and same-instance SDK class registration.
- [draftEdits.js](../src/utils/plugins/authoring/liveUi/draftEdits.js):
  host-owned batched draft operations, selection remapping, Undo/Redo and combined diffs.
- [moveDependencies.js](../src/utils/plugins/authoring/liveUi/moveDependencies.js):
  bounded inline composition checks and source/destination dependency matching.
- [structuralEdits.js](../src/utils/plugins/authoring/liveUi/structuralEdits.js):
  supported container/child mappings, component presets and structural patches.
- [applyVisualEdit.js](../src/components/live-ui/utils/applyVisualEdit.js):
  final source/snapshot checks, restore points, persistence and rollback.
- [previewDocument.js](../src/components/live-ui/utils/previewDocument.js):
  sanitization, fixed selection/dialog bridge, token, element hierarchy and dialog ancestry.

### Component building (first supported slice)

Select a static container (`main`, `section`, `div`, `article`, `aside`, `header`,
`footer`, `nav`, `dialog` or `form`) in the hierarchy. Under **Structure**, choose **Container**,
**Text**, **Text input**, **Button (unconnected)** or **Result panel**, then
**Preview addition**. New markup is appended inside the selected container using
its existing SDK DOM instance. Empty containers can be selected in the hierarchy
and populated even when they have no visible canvas area.

Select a supported direct child and use **Move up** / **Move down** or
**Position in container** to reorder its source composition within the draft.
Controls work with Tab and Enter as well as a mouse.
**Preview removal** replaces an eligible leaf's SDK call with an empty string,
retaining variable references and surrounding composition. Several operations can be combined before the same validated,
restore-point-backed Apply as text/CSS edits.
Closing and reopening Live UI reconstructs the structure from committed source.

Structural editing currently supports string-concatenated child expressions and
single elements referenced by local identifiers or direct SDK calls. Reordering
swaps expression ranges and retains comments between them. A variable containing
multiple sibling elements remains an opaque group. Shared/repeated calls/output,
non-empty container removal and elements with action-target attributes remain
protected. Existing enabled buttons and form controls with binding identifiers
cannot be removed visually. TypeScript/build validation remains the final gate
for every edit; follow-up behavior tests are explicit in the IDE.

New inputs use an accessible label; result panels use a live status role. New
buttons start disabled; connect an existing click action below or wire a new one in code. These
presets add markup only: use stylesheet-class assignment to apply existing styles.
They do not create CSS rules or backend logic. Existing click actions and supported
cross-container moves now have focused adapters. New/custom action logic, deleting
whole subtrees and more dynamic compositions remain future work. No secondary
visual document is added to workspace source; action connections use an ordinary
HTML target attribute and a declarative SDK binding.

### Edit accessible labels, descriptions and hints

Select an element and expand **Element attributes**. The Attribute picker offers
**Accessible label** (`aria-label`), **Accessible description** (`aria-description`)
and **Tooltip** (`title`), plus **Placeholder** for input/textarea elements.
Choose a field, enter a value and press Enter or **Preview attribute**. Existing
values appear in the field; **Remove attribute** deletes the source property.
An empty string is retained as an explicit value, distinct from a missing property.
Values accept up to 500 characters on one line without control characters.
Validation errors are associated with the input and clear when corrected.

This adapter writes only literal values in a unique direct SDK `createElement`
call with a static attribute object. Computed field values are shown read-only;
other literal fields in the same object can still be edited. Shared/repeated
calls, spreads, computed keys and duplicate attribute names require the IDE.
IDs, relationships such as `for`/`aria-describedby`, binding targets, classes,
event handlers, navigation and disabled state are not exposed here. Button titles
managed by click-action connections are read-only so editing a hint cannot break
connection ownership. Accessible descriptions remain compatible with managed
connections and removable static leaves.

The host stores literal text and the installed SDK escapes it when rendering
attributes; it does not pre-escape values or insert markup. New properties are
added without replacing surrounding expressions, and removal preserves adjacent
comments/commas through the shared source-range helper. Attribute changes retain
selection, share draft Undo/Redo and can be combined with text, structure, action
and CSS edits before one validated Apply. Source/snapshot conflicts use the same
guards. Reopening reconstructs values from source; no sidecar metadata is created.

### Assign existing stylesheet classes

New components can use existing plugin styles without leaving the draft. Select
an element, expand **Stylesheet class**, choose **Assign existing class**, and
click **Preview style assignment**. The operation replaces the element's current
class expression or adds a class property to its attribute object. Review the
source diff, combine it with other edits, and Apply once. Undo/Redo includes class
assignments. Existing CSS rules and other elements' class expressions are retained.

The host offers up to 200 class entries from default CSS imports available in the
element's module and scope. It emits the real SDK expression
`dom.createClassFromStyle(styles["className"])` using that module's actual binding
names. The DOM instance must include this element in its `renderHTML` output; helper
instances that return raw markup without emitting their styles, and markup added
after HTML was emitted, remain read-only for this adapter.
Shared/repeated calls, computed/spread attribute maps and ambiguous duplicate class
properties also remain read-only. User-supplied paths/aliases/source replacements
are never accepted as style targets. Full candidate validation still applies.

This is a styling adapter for milestone 4. New rules can now be created by
isolating an existing class or creating an empty named class. Simple
hover/focus/active state rules and their combinations are editable. Complex/unsupported conditional state selectors,
multi-class composition and broader responsive layout editors remain planned. New buttons can reuse supported existing click actions; new/custom behavior
still needs action wiring in code; style assignment does not
enable backend simulation or plugin-driven dialog actions. Native dialog visibility
is handled separately by the design-only controls described above.

### Connect a new button to an existing click action

Select a newly added unconnected button and expand **Click action**. Choose
**Connect existing click action** to connect and enable it immediately in the
draft. The action is a frontend `renderOnLoad` handler, such as `run`, which may
already call a backend handler; it is not the backend handler name itself.
Reusing it preserves its existing inputs, result targets and behavior. Give the
button suitable text/styles through the other inspector controls.

This adapter recognizes a direct `renderOnLoad()` return of the imported SDK
`defineRenderOnLoadActions` (including an import alias), with literal handlers and
bindings. It offers named function handlers already used by an unambiguous click
binding. Existing identity selectors must be disjoint (`[data-role="…"]`,
`[data-fdo-action="…"]` or `#id`); broad/class-based click selectors are excluded
to avoid attaching a second listener. Dynamic objects/spreads, custom event
options and non-click handlers require the IDE. Existing enabled/bound buttons
are not rewired by this slice.

The host gives the button a unique `data-fdo-action="visual-action-N"` target,
sets its disabled flag to false, updates the placeholder title and appends a
click binding to the existing handlers. The new target is optional (`required: false`),
so plugin views that omit this button keep their existing on-load behavior. It preserves comments, trailing
commas, handler bodies, setup and unrelated bindings. All changed files form one
Undo/Redo step; selection and follow-up text/style edits remain available. Undo
reverses an unapplied connection; after Apply use workspace restore points.
Connected buttons cannot be removed visually while their binding exists.

For an unmodified Live UI connection, **Change click action** replaces its handler
and click-default option in place, keeping the same target. **Disconnect action**
removes only that target's binding and HTML marker, disables the button and restores
its unconnected title. The button can then be connected again or removed. Existing
handlers, setup and unrelated controls are retained. Both operations are individual
Undo/Redo steps, including when markup and bindings share `/index.ts`; Apply and
reopening use the normal source-based workflow.

These controls require one unique rendered target and one matching generated
binding with the expected static fields. Extra token references anywhere in the
workspace (including tests/comments), repeated targets, duplicate bindings, extra
binding options and customized connection attributes make it read-only. The
inspector explains that the connection is shared, referenced or customized and
must be edited in the IDE. This conservative adapter does not infer arbitrary
code dependencies. It never deletes handler implementations. Removing binding
nodes preserves adjacent comments and trailing commas; Undo restores exact bytes.
Disconnect/reconnect can retain harmless whitespace differences, so use Undo to
return to the exact prior source.

Preview clicks only select elements. Neither `renderOnLoad`, setup, handlers nor
backend requests run in the visual sandbox. Apply uses the normal TypeScript/build
validation and grouped snapshot transaction. Reopening reconstructs the connection
from source; there is no separate action graph or stored visual model.

### Element-only and shared CSS edits

**Apply CSS to → This element only · Separate class** is the default. When you
create a button and assign an existing class, its first CSS change makes a unique
class such as `.button-local`, copies the effective SDK style map, and reassigns
only that button’s class expression through the rendering DOM instance. Other
users of `.button` keep their original styles. The selector shown in **Style
source** changes to the new class so the result is visible in the inspector.

Copy names form a flat family: `.button-local`, `.button-local-2`,
`.button-local-3`, and so on. Copying an already copied class continues that family;
it does not append `-local-local`. Names are reserved using exact identifier
boundaries throughout the current workspace, so an existing `.button-local-20`
does not block `.button-local-2`. Existing names/references are never overwritten.
Suffix normalization is naming only; it does not grant element-local ownership.

Copies include imported declarations, supported nested states/descendants and
media/supports/container rules. The original CSS and imports remain unchanged;
the new rules are appended to the same imported stylesheet. Unsupported selector
structures or ambiguous/multiple-class/source ownership explain the limitation
and require **Show in code**. There is no automatic fallback to shared editing.

Further element-only changes in the same draft reuse its separate class. One
Undo/Redo covers the first edit’s CSS addition and source reassignment together;
Discard removes both. One Apply validates and saves both files in the existing
snapshot transaction. After Apply or reopening, a new element-only editing draft
creates a fresh copy; local ownership is tracked by the host’s current draft,
not inferred from class names or comments in user code.

Choose **Shared class · Every use** only when the original class should change.
A warning identifies the selector and current visible-use count, and explains that
other uses outside this preview also change. This choice resets to element-only
when another element or style source is selected, or a class is reassigned.
Shared editing preserves the existing unambiguous base-rule restrictions.

### Inspector disclosure sections

Structure, stylesheet tools, new class creation, source diffs and the SDK catalog
use a shared card-style disclosure: Blueprint icons, a descriptive subtitle,
rotating chevron, hover background and visible keyboard focus. Enter and Space
expand/collapse the native summary; native expanded-state semantics are retained.
Reduced-motion settings disable transitions. Nested tools keep a distinct border
and background rather than appearing as unstyled browser triangles.

### Create a class from scratch

Select an eligible element, expand **Stylesheet class → Create a new class**,
choose an already imported CSS file and enter a class name without a leading dot.
**Create and edit class** appends an empty rule, assigns it on the element’s
rendering SDK DOM instance and focuses the searchable property field. A new button
can now be styled without borrowing another component’s class. If the requested
name already exists, use the next free `-2`, `-3`, etc. suffix; the resulting name
is shown in **Style source**.

Names start with an ASCII letter and contain only letters, numbers, underscores
or hyphens, up to 80 input characters; reserved object names are rejected. The
form explains these rules before input. Invalid names show a specific inline
message as you type or leave the field: remove a leading dot, replace spaces with
hyphens, start with a letter, remove punctuation, shorten to 80 characters or avoid
reserved names. The field exposes its invalid state and message to assistive
technology; creation stays disabled until corrected. Errors clear immediately
when fixed. Collisions are not errors: automatic numeric suffixes are explained
separately. The same validation function is used by the form and host planner.
The host derives file/binding/source ranges from its own preview. Empty imported CSS
files are valid targets, but arbitrary paths, computed/shared attribute maps and
DOM instances that do not emit the element’s HTML remain unavailable.

This replaces the selected element’s previous class expression with an empty
style, rather than copying its appearance. Use element-only editing above to
preserve an existing design. Subsequent edits in the current draft reuse the new
class. Creation and assignment are one Undo/Redo step, participate in the existing
multi-file Apply, and retain action-target and other attributes. Redo returns to
CSS editing after Undo temporarily removes the class. Direct SDK class assignments
retain their source identity even if two empty/equal style maps have the same
generated SDK hash; the inspector does not confuse their CSS source rules.

### Edit a CSS length with number and unit controls

Supported size, spacing, offset, font-size, border width/radius and letter/word
spacing properties offer **Length** and **Unit** controls beside the CSS text field.
Only a single literal length is decoded, including unitless zero. The unit menu
offers supported common font-relative, percentage, viewport and absolute units;
the bundled browser filters unsupported property/unit combinations. Negative
values are available for margins, offsets, outline-offset and letter/word spacing,
but not padding, sizes, gaps or border widths. Percentages are omitted where the
property does not accept them.

Changing the number or unit updates the CSS value field only. Switching units
keeps the number; it does not convert the rendered size. **Preview change**, or
plain Enter in the length field, creates one draft operation. Repeated number/unit
adjustments before Preview do not create snapshots or Undo steps. Text edits,
Undo/Redo and selection changes update the controls from the current CSS value.
Empty/invalid numbers show a correction message and retain the last valid CSS text.

Expressions such as `calc(...)`, CSS variables, keywords such as `auto`, and
multi-value spacing/radius remain intact and editable as text. Valid multi-side
margin/padding uses the sides editor below instead of showing a reset control.
For unresolved values, **Use a single length** explicitly replaces the whole
value with `0px` before editing. Opening
the controls never collapses a shorthand or resolves an expression. This widget
uses the existing element-only/shared scope, responsive/state context, conflict
guards and validated Apply transaction. Unitless line-height, grid tracks,
transforms, arbitrary custom properties and other multi-value widgets remain future work.

### Adjust margin and padding sides

For `margin` and `padding`, expand **Spacing sides** to edit **Top**, **Right**,
**Bottom** and **Left** independently. The editor expands the usual one-, two-,
three- or four-value shorthand and keeps each original side token and unit until
you change it. For example, changing Left in `8px 16px` to `2rem` produces
`8px 16px 8px 2rem`; the other sides retain their values. Equivalent identical
tokens are compacted back to the shortest shorthand when you explicitly edit.
Opening the section does not rewrite anything. The single-length controls remain
available for changing a uniform length.

Each side accepts one literal length (including zero and percentages). Margins
also accept negative lengths and `auto`; padding rejects both. Empty/invalid
fields show a correction message and preserve the last valid CSS text, including
other unfinished side inputs. Keywords, comments, `!important`, variables and
functions such as `calc(...)` stay in the CSS text editor; the sides editor does
not evaluate or replace them. Logical margin/padding pairs and other shorthands
remain future work.

Side edits change the CSS text field first. **Preview change** or plain Enter in
a valid side field creates one draft operation, using the existing scope,
state/responsive context, Undo/Redo and Apply transaction. Units are not converted,
and these are physical sides rather than writing-mode-dependent logical sides.
Longhand declarations or other cascade rules can still override the shorthand;
this editor does not remove them or change their order.

### Choose CSS colors and opacity

Select a color property in **CSS declaration** to show the native **Color** picker
and keyboard-accessible **Color opacity** slider beside the existing value editor.
Supported targets include `color`, properties ending in `-color` (including named
custom properties), and SVG `fill`/`stroke`. Shorthands such as `background`,
images and shadows stay text-only; edit `background-color` for a solid background.

The swatch reads hex (including alpha), numeric RGB/RGBA, named and supported HSL
values. Opacity is shown as a percentage; picker output is six-digit hex at full
opacity or eight-digit hex with alpha. The opacity slider uses whole percentages,
and alpha is encoded as an eight-bit channel. Original source spelling and
precision are retained until a picker/opacity choice explicitly replaces the value.

Variables, `currentColor`, advanced color spaces, gradients and other unresolved
expressions remain text values. Their fallback swatch is not a resolved preview;
the helper explains that choosing a solid color will replace the expression.
**Use solid black** provides an explicit choice even when the fallback is already
black. Text input and Enter-to-preview continue to accept browser-supported CSS.

Choosing a color changes the CSS value field only. **Preview change** adds one
operation to the host draft, and **Apply to workspace** validates/saves the draft.
Dragging the picker/slider does not create extra Undo steps or snapshots. Selection,
Undo/Redo, responsive rules, combined interaction states, element isolation/shared
scope and source conflicts use the same workflow. Opening the picker, inspecting a
named color or switching rules does not rewrite CSS. The native chooser follows
the operating system/browser; no workspace code or backend action is executed.

### Edit one branch of a simple CSS selector list

Lists such as `.button:hover, .button:focus` or `.button, .secondary` now expose
their supported class/state declarations in the normal inspector. Every branch
must be a plain class selector with only the supported interaction states. Lists
containing attributes, descendants, combinators, pseudo functions, selector comments
or other states stay read-only. No raw selector editor is exposed.

The inspector explains when the selected rule belongs to a list. On a shared-class
edit, the host splits out the chosen class/state before adding, changing or
removing its declaration. The remaining branches keep their original body,
including comments and `!important`. The edited branch follows the remaining
branches at the original source location. If an element matches both branches
at equal specificity, this gives the explicit edit precedence; other cascade
rules and higher-specificity selectors still apply. The split can duplicate
body comments, and selector-list separator whitespace is normalized.

For example, changing Hover color in `.button:hover, .button:focus {color: red}`
produces `.button:focus {color: red}` followed by `.button:hover {color: green}`.
Focus keeps its value. Removing a declaration removes it from the chosen branch
only, even if the resulting branch is empty. Duplicate properties, repeated
equivalent branches and multiple matching rules retain the existing ambiguity
protections. Element-only edits continue to copy the effective class and leave
all original selectors intact.

Base states, combined interaction states and supported responsive rules use this
same behavior. Splitting is one draft operation with exact-source Undo/Redo and
validated Apply; opening the inspector does not rewrite CSS or execute handlers.

### Edit and preview CSS interaction states

Choose **Edit → CSS declaration → CSS state**: Base, Hover, Focus, Focus visible
or Active, plus combinations such as **Hover + Focus visible**. All combinations
of these four interactions are offered. Existing top-level rules such as
`.button:hover:focus` expose their editable declarations. Equivalent orders
(`:focus:hover` and `:hover:focus`) share one editing context; source spelling is
preserved. Duplicate declarations across equivalent rules are unavailable and
ambiguous additions are refused. A missing state rule is created when its first
property is previewed. Search/add/change/remove properties using the same controls
as Base. Duplicate properties remain unavailable, and adding to multiple matching
rules is refused rather than guessing cascade ownership.

Scope remains explicit. **This element only** copies effective styles first when
needed, assigns the copy to the selected call and edits its state rule. Further
state/base edits in the draft reuse that copy. **Shared class** edits every use of
the original class, with the existing warning. Imported, nested and complex
selectors are preserved. Supported top-level maximum/minimum/range media variants are editable
through Responsive rule; other conditional variants remain read-only. Local state
rules can override imported values through normal cascade.

Choosing a state is a preview setting, not a draft edit or snapshot. The sandbox
adds a host-controlled attribute only to the selected source-mapped element and
adds equivalent `:is(:state,[data-fdo-ui-state~=state])` alternatives alongside
emitted class-state CSS, retaining one pseudo-class of specificity per interaction.
This also permits native and forced states to combine.
Focus visible also previews Focus. Normal selector specificity, declaration order
and media conditions remain in effect. Attribute-selector literals, descendant
selectors, selector functions and repeated pseudo-classes are not rewritten. Selection outlines are hidden while a state is forced
so authored focus outlines can be inspected. The preview does not dispatch clicks,
focus events, backend calls or action handlers. It is a styling aid, not an
interaction/accessibility test. Real pointer states can still affect browser CSS.

State messages use the existing source/token-checked fixed bridge and a strict
state allowlist. Workspace-supplied state/selection markers are stripped. Forced
attributes/selectors exist only in preview HTML and are never saved to plugin
source. Choosing another element returns the inspector to Base and clears the old
forced state. Selection scrolls the mapped element into view inside the preview,
including newly inserted elements below the fold. Undo/Redo, source conflicts, validation, grouped snapshots and
multi-file Apply use the same host draft transaction as base edits.

### Responsive maximum, minimum and range editing

**Responsive rule** offers **All widths**, 480/768/1024px maximum-width presets,
and supported existing top-level width rules in the mapped CSS file (integer
widths 1–10000). These include `(max-width: Npx)`, `(min-width: Npx)` and inclusive
pairs `(min-width: Npx) and (max-width: Mpx)` in either order. Inclusive comparison
forms such as `(width <= 640px)`, `(640px <= width)`,
`(600px <= width <= 900px)` and `(900px >= width >= 600px)` are also supported.
Single comparison terms can be paired with `and`, including a conventional min/max
term. Equivalent conditions share one context; their original source spelling/order
is retained when edited. Ambiguous equivalent selectors/properties receive the
same protections across both syntaxes. Choose a breakpoint to edit its base or supported state declarations.
The first property creates a missing media/class rule. Existing unique rules are
updated in place, preserving comments, sibling selectors, other breakpoints,
imports, base declarations and unsupported conditions. Ambiguous duplicate rules
cannot receive new properties; duplicate properties stay read-only.

If a matching media block exists, a missing class/state rule is inserted before
its closing brace. If several blocks match but none contains the target selector,
a separate media block is appended rather than choosing a source block arbitrarily.
A unique existing selector can still receive properties regardless of other blocks
at the same width. Effective element-only copies preserve responsive styles and
support further base/state/breakpoint edits in the same class and draft.

Selecting a breakpoint also sets the iframe’s actual viewport width: the maximum
for a narrower rule, the minimum for a wider rule, or the midpoint for a range.
Range controls preview both inclusive endpoints and one pixel outside each bound;
minimum-width controls preview one pixel below. Overlapping conditions remain
active according to normal CSS cascade, rather than being hidden to fake an
isolated preview. **Fit preview**
returns to the available canvas width while keeping the CSS editing context;
**Preview at Npx** restores the selected breakpoint width. Larger viewports can
be inspected with horizontal scrolling instead of silently scaling the plugin.
These are preview controls, not source edits or snapshots, and do not restore the
removed legacy width-select box. The breakpoint selector chooses a CSS editing
context rather than a display-only width preset. Choosing **All widths** edits the
unconditional rule; it does not disable media queries in the preview.

Element-only/shared scope, state preview, Remove declaration, Undo/Redo, conflicts
and validated multi-file Apply remain unchanged. Preview at wider sizes to verify
that the base design remains intact. Existing custom max-width values are offered, and new widths can be created
through Custom breakpoint below. Strict `<`/`>` comparisons, other units/features,
`screen`/`or` combinations, nested
media/supports/container conditions and media-query renaming/deletion are future
slices. Strict comparisons are not rounded to integer boundaries because viewports
may have fractional CSS-pixel widths. New width ranges emit conventional paired
min/max clauses; existing comparison syntax is preserved. There is no raw selector/query text accepted by this UI.

### Create or select a custom breakpoint

Expand **Custom breakpoint** below **Responsive rule** and choose **Rule type**:
Maximum width (narrower), Minimum width (wider), or Width range (between). Enter
one bound, or minimum and maximum, and press **Enter** or **Create breakpoint**.
Whole pixels from 1 to 10000 are supported; range minimum must not exceed maximum,
and both bounds are inclusive. Equal bounds describe one exact viewport width. Inline validation explains missing input, units, spaces, decimals
and out-of-range values, with screen-reader error wiring and disabled submission
until corrected. No raw media-query text or arbitrary source is accepted.

A new condition creates an empty Base rule in the current scope. Maximum and
minimum rules at the same number remain distinct; ranges match by both bounds,
not by object identity or the spelling/order of `and` clauses. Element-only mode
copies effective styles and updates the selected class assignment first when
needed; shared mode changes only the stylesheet. Creating the empty responsive
rule and assigning its private class are one Undo/Redo step. Imported effective
styles at that width are retained/reused in the copied class. Base/state values
can then be added with the existing property picker.

After creation, the condition is selected, the iframe uses a width inside it and
focus moves to **CSS property**. If the width is already offered (including a
preset or an existing media block for another class), **Use breakpoint** selects
it without writing source or adding an Undo step. Its first property edit can
create a missing class/state rule. No duplicate media rule is created just by
selecting the same width again.

Undoing creation retains the requested width as **Not in draft**, explains that
Redo can restore the rule, and hides unmapped property controls. Redo restores
editing; creation can also be repeated as a new Undo branch. Discard removes all
pending source/CSS changes. Apply validates and saves the entire draft through
the existing grouped snapshot transaction, and reopening discovers the custom
width from the actual stylesheet.

### Add missing CSS declarations

In **Edit → CSS declaration**, use the Blueprint searchable **CSS property**
picker. Search fragments/abbreviations such as `bg col` or `bordr rad`, or hints
such as `round corners`, `spacing` and `font size`. Results include a category and
**Existing** / **Add** labels. Arrow keys choose a result; **Enter** selects it and
moves focus to **CSS value**. Type a value and **Enter** again previews the edit.
Mouse selection follows the same focus flow. Escape closes the list without
selecting a different property; unmatched queries show an explicit empty result.
The field displays the number of available properties.

The previous 29-property list was an FDO restriction, not an SDK restriction.
The installed SDK takes CSS property/value records, and the production CSS parser
preserves declarations. The picker now discovers properties exposed by the running
Chromium CSSOM: computed-style longhands plus style/prototype shorthands and vendor
aliases, filtered through `CSS.supports(property, "initial")`. Existing declarations,
including supported custom-property names already in the class, are also listed.
This tracks the bundled browser rather than claiming to enumerate every property
in every CSS specification or future browser. A small common-property seed remains
only as a fallback when browser discovery is unavailable. Host editing no longer
uses that seed as an allowlist.

Values are checked with the running browser's `CSS.supports` before preview. The
host independently validates property-name syntax, rule ownership, duplicate
properties and source ranges; it never accepts arbitrary replacement source. Quick
value choices for common layout properties (`display`, flex/grid alignment, sizing
modes, overflow and similar) populate the value field and retain focus. You can
still type any supported value instead of using a preset. Pressing Enter on an
unchanged value creates no draft edit.

Adding is available only when the class has exactly one top-level base rule in
the mapped CSS file. Empty base rules can receive properties. Multiple base rules,
imports without a local base rule, duplicate declarations and state/media-only
rules are not guessed or flattened. Existing editable declarations can still be
changed where their source is unambiguous. Adding preserves other properties,
comments, state selectors, media queries and unrelated rules.

The CSS inspector keeps the selected class, property and edit mode after preview,
so adding several properties does not require repeatedly selecting CSS mode or
returning focus to a long property dropdown.
Shared-rule feedback counts currently rendered uses of that class. Additions
participate in the same batched draft, source diff, Undo/Redo, validation and grouped
snapshot Apply as other edits.

**Remove declaration** removes the selected editable base or supported state property in the current
scope. It is disabled for missing, duplicate or unmapped declarations. Element-only
removal copies the effective style first when needed; shared removal edits the
original class only after an explicit scope choice. Source comments, other
properties, states and responsive rules remain intact. A state, imported rule or
inherited value may still supply the property after removal, so removal does not
promise a particular computed value. Undo/Redo and multi-file Apply work exactly
as for value changes. No arbitrary CSS replacement or selector is accepted.

New classes are supported through the two paths
above; advanced responsive and complex/conditional selector editors remain future work.

Next: expand structural/style adapters while retaining the batched patch
transaction, source preservation, revision and validation guarantees.

## Why revisit it now?

FDO already has an IDE, AI coding assistance, runnable plugin templates, snapshots,
and SDK UI extensions. The original Live UI Editor was intended to let developers
build plugin interfaces by connecting blocks. Its next purpose should be to make
those interfaces easier to construct and refine while keeping their existing code
usable in the IDE.

The key requirement from the discussion is **bidirectional connection to the IDE
and existing source**. A separate generator whose output must be copied into an
editor does not satisfy it. Likewise, a visual change must not discard working
logic, styling or AI-generated code.

Proposed product direction: a visual companion to the plugin workspace, with a
rendered canvas, component tree, properties inspector, code navigation and a
reviewable source diff. Prefer familiar components such as containers, text,
buttons, inputs, result panels and dialogs over exposing SDK constructor arguments
as the main authoring experience. The old method graph has been removed by
product decision; future structural editing belongs in the element hierarchy and
rendered canvas.

## Removed legacy UI

The standalone graph components, generated-code modal, graph-only styles,
`OPEN_LIVE_UI_WINDOW` channel and preload entry have been removed. A `/live-ui`
route without a connected session explains how to open it from the IDE. Old
`ui-flow` localStorage data is neither loaded nor deleted; there is no automatic
migration into a plugin workspace.

### SDK-generated metadata is an existing integration

The SDK generates `@anikitenko/fdo-sdk/dist/dom-metadata.json` on release. The
current editor already reads it through
`window.electron.system.getFdoSdkDomMetadata()`:
[preload.js](../src/preload.js) → `GET_FDO_SDK_DOM_METADATA` in
[system.js](../src/ipc/system.js) → `resolveFdoSdkDistPath()` → the installed SDK
artifact. Reuse this path rather than importing a copied JSON file into FDO's
renderer bundle.

At review time, installed SDK 1.5.2 provides 10 DOM helper classes, 10 constructors
and 64 methods. Class entries describe constructors and methods; parameters have
names, type strings, descriptions and optionality. Methods also expose return
descriptions and, where supplied, `uiName`, `uiSkip` and examples. These counts are
an observation of that release, not limits to hard-code. The inspected artifact
covers DOM helpers; do not assume it inventories every non-UI SDK API.

[DOMMetadataParser.js](../src/components/live-ui/utils/DOMMetadataParser.js) and
[mapParamsToSchema.js](../src/components/live-ui/utils/mapParamsToSchema.js) already
provide class/method lookup and parameter-to-form-schema conversion. Audit and
extend these adapters before inventing another metadata format.

## Metadata-driven catalog and inspector

Use generated SDK metadata as the primary inventory of available UI constructors
and methods. Keep a small FDO presentation/authoring adapter for the parts metadata
does not describe:

| Metadata supplies | Proposed editor use |
| --- | --- |
| `className`, constructor and method names | Discover SDK helpers; identify supported calls in source. |
| Constructor/method parameters and optionality | Generate property fields, required-field hints and argument editors. |
| Type strings | Choose supported primitive/union/object controls; use an explicit advanced/code fallback for complex types. |
| `uiName`, descriptions and examples | Human-readable labels, search and contextual documentation. |
| `uiSkip` | Omit marked methods from the ordinary insertion palette while preserving existing source references. |
| Return descriptions | Display output hints; use declarations/runtime validation to establish actual types. |

The FDO adapter should define semantic categories, child slots, element selection,
source-edit rules, style ownership, safe preview behavior and useful presets. For
example, a dialog preset combines markup, CSS and action bindings; a raw method
signature alone does not express focus behavior or how to edit that composition.
The ordinary palette can offer **Button**, **Text** and **Dialog** while an advanced
SDK browser exposes the underlying helpers. Preserve exact SDK call identity
underneath both views.

Do not duplicate the SDK's entire method/parameter catalog in handwritten FDO
configuration. New SDK entries should become discoverable from refreshed metadata;
they should become visually writable only when their editing contract is supported.
Metadata discovery alone must not imply safe round-trip editing of every method.

Proposed version and failure handling:

- The metadata response now includes the resolved SDK version and metadata
  fingerprint. Version FDO's writable authoring adapters separately when added.
- Load metadata from the SDK actually used for that workspace's build. Verify
  whether the current host SDK resolver and workspace build always agree before
  supporting workspaces with different SDK versions.
- Validate the metadata shape, retain unknown fields, and refresh catalog/schema
  caches when the resolved version or fingerprint changes.
- Recheck a draft against updated signatures before applying. Removed/changed
  methods need a compatibility explanation and source fallback, not automatic
  deletion or argument guessing.
- The connected preview catalog has actionable loading/error/empty states and
  Retry. Metadata availability is independent of source-edit validation.

Examples and descriptions are documentation, not executable setup scripts. Type
strings can include broad or complex types, and return descriptions are prose;
neither is a substitute for SDK declarations, source mapping, validation and
tests. Most importantly, this metadata does not establish which existing code
produced a preview element. AST/source maps and stable element identity are still
needed for bidirectional editing.

## Existing foundations to reuse

- [Plugin templates](PLUGIN_TEMPLATES.md): eight deterministic starters now use
  `styles.css`, including Local utility, Dashboard, Resizable workspace and Styled
  dialogs. Start with a small supported subset of their render patterns.
- [Template factory](../src/components/editor/utils/virtualTemplates.js) and
  [starter generators](../src/components/editor/utils/templates/starterFiles.js):
  stable fixtures for visual import, edit and round-trip tests.
- [VirtualFS.js](../src/components/editor/utils/VirtualFS.js), Monaco models and
  existing snapshot/apply flows: inspect and reuse their contracts rather than
  writing directly to plugin files or localStorage from the visual window.
- [Snapshot stabilization notes](TODO_EDITOR_SNAPSHOT_STABILIZATION.md): account
  for workspace loading, restore completion and model replacement.
- [CSS transformation](../src/utils/esbuild/plugins/cssStyleModule.js): the build
  and Node test paths share SDK style-map compilation, including CSS imports,
  selector states, descendants and media rules.
- [Plugin runtime renderer](../src/components/plugin/PluginPage.jsx): useful
  reference for iframe isolation and action transport. Preview needs its own
  explicit policy; do not assume deployed runtime behavior is safe for editing.
- [Plugin UI actions](PLUGIN_UI_ACTIONS.md): quickbar/sidebar handlers are already
  separate integration points. Visual UI work must preserve them.

## Proposed developer experience

1. Open **Live UI editor** from an existing plugin workspace. It identifies the
   workspace and snapshot, rather than starting an unrelated graph.
2. See the rendered interface and its component tree. Select an element to inspect
   supported properties, style rules and its existing action binding.
3. Use **Show in code** to select the corresponding source in the IDE. An IDE
   selection can select the corresponding supported visual element.
4. Make a visual edit. Preview the candidate immediately, without overwriting
   workspace files. Show which files/properties will change.
5. Choose **Apply to workspace** after reviewing the diff. Validate the candidate,
   create a restore point, and commit the edit through the IDE's apply path.
6. If the IDE or assistant changes source, refresh the visual model from the new
   workspace revision. If visual edits are pending, show a conflict instead of
   silently replacing either version.
7. Undo/Redo inside the draft, or restore applied changes through workspace history.
   Both views refresh, and later
   AI requests receive the current files and restore context.

The separate window must remain usable beside the IDE: Show IDE brings the IDE
forward without a permanently on-top visual window. Closing/reopening preserves
the workspace's visual draft or clearly offers to discard it. Native BlueprintJS
controls should provide the surrounding FDO UI and clear empty/error states.

## Source ownership and round-trip limits

Workspace source is authoritative. A visual document is a derived, versioned model
plus optional authoring metadata, not a second independent implementation of the
plugin. Canvas coordinates and selection are editor preferences; UI element order
and layout properties are source behavior.

Bidirectional does **not** require perfect decompilation of arbitrary TypeScript.
Start with explicit, recognizable patterns and expand support with tests:

| Source feature | Initial proposed handling |
| --- | --- |
| Static SDK `DOM.createElement` composition | Import supported elements and map editable arguments back to source. |
| Literal text and simple attributes | Edit only when a unique writable source location is known. |
| `styles.css` class entries | Edit supported declarations using the CSS parser; preserve unrelated rules, comments, imports, states and media queries. |
| Existing declarative action bindings | Display binding details; preserve callbacks and backend handlers. |
| Computed values, loops, conditionals, helper calls | Show as dynamic/custom regions with source navigation; preserve their source verbatim. |
| Unrecognized code or ambiguous shared styles | Explain the limitation and offer Show in code; never guess a destructive rewrite. |

Use AST-aware source edits and deterministic parsing for the supported subset.
Do not use regex rewriting of TypeScript or require an AI provider to perform a
basic visual edit. AI can later propose conversion or improvements as reviewable
workspace edits.

Before implementing writable import, decide how stable element identity is
represented. Proposed approach: source mappings for the current revision plus
explicit stable authoring IDs where needed, with optional workspace metadata for
canvas state. Avoid using line numbers, generated CSS hashes, or temporary DOM
positions as persistent identities. Do not introduce runtime-visible attributes
or a new workspace file format without documenting the contract and migration.

Styles remain standard CSS. Imported style maps must be registered on the same
SDK `DOM` instance that emits the final HTML. The editor must not flatten nested
style-map objects into class strings or convert stylesheet source into `styles.ts`.
Shared CSS changes must show all affected elements; “this element only” needs an
explicit new class rather than silently changing every use of a shared selector.

## Workspace synchronization and recovery

The IDE should own the workspace and be the only writer. The visual window sends
edit proposals over a scoped bridge; it does not receive unrestricted filesystem
access or silently write another editor's models.

Define the bridge before adding more block types. At minimum, operations need:

- Workspace/session identity and authenticated sender ownership.
- A workspace revision covering file contents, plus the selected snapshot.
  Snapshot ID alone is insufficient because unsaved edits can change its models.
- Read current sources, subscribe to revision/restore events, and reveal a mapped
  source location.
- Validate/preview a candidate edit, then apply its file patches against the exact
  base revision. Include an operation ID to prevent duplicate applies.
- Acknowledgement containing the resulting revision/restore point, or structured
  failure details with an actionable recovery choice.
- Unsubscribe/dispose behavior when either window closes or changes workspace.

Proposed states and transitions:

| State | Expected behavior |
| --- | --- |
| Loading | Wait for workspace readiness, then import and preview its current revision. |
| Ready | Views agree; selection and navigation do not modify source. |
| Draft | Visual edits exist against a recorded base revision; Discard is available. |
| Validating | Validate candidate files and build preview; keep current workspace intact. |
| Applying | Recheck revision and commit through the workspace apply/restore-point flow. Block duplicate Apply. |
| Conflict | Source changed since draft creation. Reload/discard or explicitly rebase supported edits; never overwrite silently. |
| Error | Retain the draft and diagnostics; retry the failed operation or return to code. |
| Disconnected | IDE is closed/unavailable. Preserve the draft, disable Apply, and offer reconnection. |

Cancel or supersede stale asynchronous parses/builds so an older result cannot
replace a newer preview. Validation failure changes no workspace files. If the
existing apply flow cannot guarantee a complete commit/rollback, resolve that
before advertising atomic visual edits. Restore invalidates mappings and rebuilds
the model before editing resumes. Record visual applies/restores in the existing
workspace history so AI follow-ups are grounded in the actual current source.

Draft persistence must be versioned and scoped to workspace identity, with its
base revision. Handle unavailable storage explicitly. Preserve the old `ui-flow`
data until an explicit import/discard choice; it cannot be safely assigned to an
arbitrary plugin automatically.

## Preview and action behavior

Preview must show candidate UI without deploying the plugin or replacing a
currently installed version. Match the SDK CSS and layout behavior used by the
real build, including narrow widths and dialog top-layer rendering.

Use an isolated preview iframe with a narrowly defined selection bridge. Keep
selection/resize overlays separate from plugin markup. A preview message must not
be able to write workspace files or grant capabilities.

Backend simulation is a future phase, requested as the intended way to observe
backend-driven UI changes live. It is not implemented by this editing slice.
Design a clearly labelled simulator mode with controlled handler responses,
loading/success/error cases and state transitions, separate from selection mode.
It should exercise UI updates without deploying or contacting real services.
Choose and test its execution/state-isolation boundary before running backend
logic or renderOnLoad. Do not quietly substitute real plugin execution.

When simulation is added, show which data/actions are simulated. Do not execute arbitrary plugin backend
code in the host renderer merely to discover what its UI looks like. Inspect and
design the preview build/execution boundary before reusing a deployed runtime.
Real integrations, if later supported, need an explicit connected mode that uses
normal capability checks; preview itself grants no extra permissions.

In selection mode, clicking a button selects it instead of invoking its action.
In interaction mode, UI controls and native dialogs work normally against the
preview's declared transport. Plugin iframe form submission is blocked today;
retain the templates' explicit click/Enter action bindings rather than loosening
the sandbox to make a demo work.

## Implementation milestones and acceptance gates

### 1. Workspace connection and static preview — implemented

Implement workspace identity, revision subscriptions, lifecycle handling and
isolated preview first. Start with Blank and Local utility; inspect the existing
preview infrastructure before choosing how to execute candidate rendering.
Load the installed SDK metadata through the existing IPC path, expose useful
loading/failure states, and establish SDK-version alignment with the build.

Acceptance: opening from plugin A loads A's current editor source, not a deployed
or stale copy; source edits and restore refresh the preview; opening B never
reuses A's preview/draft; unsupported/import failures have an actionable state.

### 2. First deterministic visual-to-code edit — implemented for the supported subset

Add a small parser/source map and inspector for static elements. Support changing
a literal label and a basic CSS declaration, then Show in code, diff, Apply and
restore-point integration. This is the first complete bidirectional slice.

Acceptance: an edit changes only the intended source; behavior/tests and unrelated
code remain intact; the IDE updates immediately after Apply; source changes during
a visual draft produce Conflict; a failed validation preserves both source and
draft; repeated Apply cannot duplicate the edit; restore refreshes both views.

### 3. Build interfaces from components — first supported slice implemented

Add container/text/input/button/result building blocks and structural operations:
insert, reorder, move and delete within supported regions. Include keyboard
selection and operation controls, not just drag-and-drop. Reuse template patterns
and real SDK APIs rather than generating speculative ones.

Verified slice: add all five presets, populate a new nested container, reorder
within an existing container, remove eligible leaves, reopen from committed code,
and preserve the utility's original CSS, backend source and passing real tests.
The Electron suite exercises insertion, keyboard reordering, Apply, reopen and
removal. Same-scope cross-container moves now preserve identifier-backed action
targets and supported nested/styled inline SDK compositions, with destination eligibility, descendant
protection, selection remapping and atomic Undo/Redo. Broader cross-container
expressions, new/custom action logic and dynamic structures remain planned; the complete
acceptance gate remains open.

Full acceptance: build a small local utility visually, reopen it from code, and
continue editing without losing structure, styles or existing backend bindings.

### 4. Rich layouts, CSS and dialogs — named classes, isolation, interaction states and width-query editing implemented

Expand to Dashboard, divided layouts, Resizable workspace and Styled dialogs.
Add responsive properties, state selectors and explicit shared-style handling.
Preserve Split Grid setup/cleanup and modal accessibility when editing structure.

Verified first slice: assign an existing class to a new or eligible existing
element, preserve its action-target attributes, register styles on the DOM instance
that emits the markup, Undo/Redo the assignment and validate through real tests.
Supported missing properties can be added to one unambiguous base rule, with
existing comments, state rules and media queries preserved. Element-only edits
copy effective styles and update CSS/source atomically; shared edits require an
explicit scope choice. Empty named classes can also be created in imported CSS
files and styled immediately, with collision-safe naming and one Undo/Redo step.
Inspector sections use accessible disclosure cards; class-name errors explain the
correction inline. Editable base declarations can be removed in either scope.
Simple Hover/Focus/Focus visible/Active declarations can be added, edited, removed and
forced visually on the selected element. Simple maximum/minimum/range media rules support
the same edits at preset, discovered and newly created custom widths, with
exact-width previews. Custom-width input validates inline, supports Enter-to-edit
and selects existing contexts without producing draft history. Minimum-width and inclusive
range rules use the same transaction and state controls, with preview buttons at
and outside their bounds.
Native top-level dialogs now have explicit design visibility, selection-based
revealing, native top-layer/backdrop rendering, focus/Tab, Escape and an external
close control. Text/style drafts preserve selection and dialog visibility through
rerenders, while real Save/Cancel handlers remain unchanged and inert in preview.
Explicit custom dialog roles and native popovers now support design visibility,
selection-based revealing and Escape, with custom-modal focus cycling and authored
state preserved by Apply. Advanced responsive/complex-selector editors, nested or
framework-specific popups and actual
plugin-driven dialog interactions remain planned.

Full acceptance: emitted styles match deployed behavior; narrow layouts remain usable;
dialogs support focus/Cancel/Escape; custom/dynamic regions survive edits; changing
layout does not remove quickbar/sidebar functionality.

### 5. Durable drafts and AI collaboration

Finish draft persistence/reconnection, migration, operation history and selection
context for AI requests. AI edits must use the same revision/validation/apply rules
as manual code and visual edits. Preserve existing guide approval requirements.

The first selection handoff is implemented: select a committed element and choose
**Edit with AI**. FDO opens its mapped source range in Monaco and selects the AI
Coding Agent tab (or focuses its already detached window). The existing prompt and
action remain unchanged; submitting the request is a separate developer action.
Source is checked again while the editor mounts, so intervening edits, workspace
switches, restore and window closure cannot select stale source. Pending or saved
visual drafts must be applied or discarded first. AI edits continue through the
existing request lifecycle; finish or stop a running request before changing its
source selection. Requests use the existing candidate validation, guide approval and snapshot transaction; this
handoff does not apply visual changes or rebase conflicting drafts.

Acceptance: close/reopen with a draft, restore while a draft exists, switch
workspaces and apply an AI follow-up without lost updates or misleading history.

## Verification strategy

- Parser/patch tests: supported round trips, comments/import preservation, dynamic
  regions, shared selectors, source-map invalidation and unsupported syntax.
- Metadata tests: class/method discovery, `uiSkip`, required/optional arguments,
  complex-type fallback, unavailable/malformed metadata and SDK signature changes.
- Bridge/state tests: stale results, simultaneous code/visual edits, duplicate
  Apply, restore, disconnect/reconnect, storage errors and workspace isolation.
- Real build and Node tests: verify candidate workspaces through the production
  SDK/CSS contracts, not mocked stylesheet exports alone.
- Electron tests: real IDE plus Live UI window; code-to-preview and visual-to-code
  edits, diff/apply, restore, independent workspaces, keyboard interactions and
  dialog/responsive behavior.
- Manual validation: use a template and a plugin with custom code. Verify visible
  unsupported regions and useful diagnostics, not just the happy path.

Current Live UI checks and template fixtures:

```sh
npx jest tests/unit/live-ui-css-colors.test.js tests/components/CssColorPicker.test.jsx tests/unit/live-ui-attributes.test.js tests/components/AttributeEditor.test.jsx tests/unit/live-ui-actions.test.js tests/unit/live-ui-static-preview.test.js tests/unit/live-ui-source-edits.test.js tests/unit/live-ui-css-states.test.js tests/unit/live-ui-responsive.test.js tests/unit/live-ui-media-queries.test.js tests/unit/live-ui-structure.test.js tests/unit/live-ui-draft-edits.test.js tests/unit/live-ui-style-assignments.test.js tests/unit/live-ui-style-isolation.test.js tests/unit/live-ui-css-properties.test.js tests/unit/live-ui-class-names.test.js tests/components/CssPropertyPicker.test.jsx tests/unit/live-ui-apply.test.js tests/unit/live-ui-bridge.test.js tests/components/WorkspacePreview.test.jsx tests/components/live-ui-preview-document.test.js tests/components/editor/utils/VirtualFS.test.js --runInBand
npx jest tests/unit/live-ui-css-lengths.test.js tests/components/CssLengthEditor.test.jsx --runInBand
npx jest tests/unit/live-ui-css-spacing.test.js tests/components/CssSpacingEditor.test.jsx --runInBand
npx jest tests/unit/live-ui-selector-lists.test.js --runInBand
npx playwright test tests/e2e/live-ui-workspace.spec.js tests/e2e/live-ui-editing.spec.js --workers=1
npx jest tests/unit/plugin-starter-templates.test.js --runInBand
npx playwright test tests/e2e/plugin-templates.spec.js --workers=1
```

Build main, preload and renderer before Electron tests when implementation changes.
The Live UI suites verify source/CSS mapping and focused edits, before/after diff,
apply and snapshot restore, conflict rejection, sender ownership, retry/duplicate
behavior, persistence rollback, source/preview selection, metadata retry and
resource limits. Grouping tests apply 100 edits without snapshot growth, verify
persisted working content and restore-point contents, explicit checkpoint boundaries,
manual/guide changes, restore/new-session/branch boundaries and failed persistence. Structural tests also verify all presets, nesting, reordering,
removal, shared-output protection, multi-root groups, imported-helper parent
ownership, comments/trailing commas and real utility test execution after edits. Batch tests verify repeated movement,
direct positioning, selection remapping, multi-file diffs, Undo/Redo branching,
stale predecessor rejection, empty diffs, bounded history and multi-file rollback.
Net-change regressions repeatedly move back and forth, verify zero/one changed
files against the original source, and preserve pending edits after Undo-history
rollover. CSS additions cover empty rules, duplicate/multiple-rule rejection and
source/comment/state/media preservation. Property-search tests cover CSSOM
longhands/shorthands/vendor discovery, partial and semantic ranking, keyboard
selection, empty results, ambiguous-rule filtering, custom properties and declarations
outside the former curated list. Electron checks exercise more than 200 runtime
properties and the full search → Enter → value → Enter flow, plus common value
choices and an unchanged workspace before Apply.
Style tests verify unchanged CSS, source/binding preservation, assignment to a newly
inserted element, Undo/Redo, computed/shared/forged targets and DOM instance ownership.
Isolation tests cover imported/state/responsive style preservation, unaffected
shared elements, name collisions, repeated edits without extra copies, atomic
multi-file Undo/Redo and host rejection of ambiguous targets. Electron also
exercises new button → assigned class → isolated edits → Apply, explicit shared
editing and scope reset when selecting a different element. Named-class tests
cover empty imported stylesheets, exact name collisions, four successive applied
copies without suffix nesting, forged paths/names, ambiguous source rejection and
distinct source ownership for two empty classes with identical SDK hashes.
Electron verifies creating a class for a new unstyled button, property focus,
editing, multi-file Undo/Redo and validated Apply. Additional coverage checks
class-name correction messages, screen-reader error wiring, disabled/re-enabled
creation, native Enter/Space disclosure toggling and declaration removal with
comment/state/media preservation and atomic isolation Undo. State tests cover
new rules, shared edits/removal, isolated base/state preservation, duplicate and
selector-injection rejection, forced-selector specificity/condition preservation
and marker stripping. Combined-state tests cover canonical ordering, all 15
interaction combinations, equivalent-rule ambiguity, responsive edits and
atomic isolation. Electron verifies forced Hover, Focus visible and Hover + Focus
visible on one element, combination-over-single specificity, returning to Base,
real focus outlines, Undo/Redo, validated Apply,
selection reset and absence of preview markers in saved CSS. Responsive tests
cover new/existing media insertion, copied media preservation, base/state editing,
removal, duplicate/query-injection rejection and atomic Undo. Electron verifies
an exact 480px viewport, narrow-only styling, wider base preservation, responsive
Hover, Undo/Redo, Apply and code-to-preview reopening. Custom-width tests verify
empty-rule creation, imported effective-style reuse, shared CSS-only changes,
duplicate/invalid creation rejection and input correction messages. Electron also
checks Enter-to-property focus, existing-width selection without Undo steps,
missing-breakpoint Undo feedback, Redo and persisted custom-width discovery.
Minimum/range suites cover reversed-bound errors, query identity in either source
order, equivalent duplicate rejection, state/base edits, removal and source
preservation. Electron verifies minimum boundaries, both inclusive range ends,
outside widths, overlapping rules, Hover, Undo/Redo, Apply and reopening.
Comparison-query checks cover both operand orders, ascending/descending inclusive
ranges, mixed conventional/comparison pairs, unsupported strict/fractional/unit
conditions, duplicate bounds, isolation and original-syntax preservation.
The 2026-10-14 comparison-query slice passed 85 focused unit/component tests,
three native Electron responsive tests (including editing an existing comparison
query, both inclusive boundaries, outside preview, Undo/Redo and validated Apply),
and development main/preload and renderer builds. Broader roadmap items above
remain open; this was a focused verification run rather than a full application suite.
Electron checks include control-bottom alignment and real Blueprint hotkeys from
the parent window and the preview iframe, while text fields retain native behavior.
Cross-container checks cover action-binding preservation, literal inline moves,
source-scope/variable restrictions, descendant/forged destinations, retained
selection through text edits and atomic Undo/Redo. Electron verifies immediate
destination selection, nested preview output, unchanged workspace before Apply
and persisted source with the original backend module.
Action tests cover alias discovery, unsupported/dynamic/broad selectors, forged
handlers, distinct targets, same-file selection, two-file Undo/Redo and protection
of existing bindings. An isolated installed-SDK runtime check executes the actual
existing handler with a stub transport and verifies one call and its result update.
Electron checks connection, disabled/enabled state, inert preview clicks, atomic
Undo/Redo, follow-up text, inspector callout bounds, validated Apply and source-based reopening.
Connection-edit tests cover stable targets, handler/default-option changes,
disconnect/removal/reconnect, same-file selection, shared/custom/reference rejection
and comment-safe first/middle/last/only binding removal. Electron checks rewire,
Undo/Redo, Apply/reopen, disconnect, removal, inspector control bounds and absence
of orphaned targets/bindings. Installed-SDK runtime checks also confirm only the
replacement action is dispatched, with no listener attached after disconnection.
Attribute suites check raw-text SDK escaping, literal/computed/shared distinctions,
ID/event/managed-title rejection, invalid values, empty versus absent values,
comment-safe removal, exact Undo, retained selection and action compatibility.
Component checks cover Enter, held-key prevention, read-only/disabled controls
and accessible validation correction. Electron verifies literal placeholder
escaping, accessible name updates, descriptions, removal, Undo/Redo, inspector
bounds, unchanged workspace before Apply, preserved backend source and reopening.
Color suites cover hex/RGB percentages/alpha, transparent values, unsupported
expression preservation, browser named/HSL normalization, explicit choices,
disabled controls and external value synchronization. Electron verifies color and
opacity changes before Preview, combined-state responsive styling on an isolated
class, unaffected shared users, Undo/Redo, variable text preservation, inspector
bounds, unchanged source before Apply and persisted alpha without preview markers.
Length-widget checks cover literal parsing, sign/unit restrictions, expression and
shorthand preservation, explicit replacement, invalid/empty numeric input,
disabled controls and external value synchronization. The 2026-10-14 slice passed
77 focused unit/component tests and three native Electron tests (length controls,
color controls and responsive max-width regression), plus the renderer development
build. The length Electron test checks Enter preview, unit changes, responsive
Hover isolation, Undo/Redo, inspector bounds, unchanged source before Apply and
persisted values after reopening. Its screenshot was visually inspected.
Spacing-side checks cover all four shorthand expansions, unchanged side tokens,
negative/automatic margins, nonnegative padding, expression/comment preservation,
partial input and synchronized text/Undo values. The 2026-10-14 slice passed 94
focused unit/component tests, two native Electron tests (side controls and the
single-length regression) and the renderer development build. Electron verifies
responsive Hover isolation, retained right/bottom/left values, Enter preview,
Undo/Redo, inspector bounds, unchanged source before Apply, preserved backend
source and reopening. The final screenshot was visually inspected. Valid
multi-side shorthands use the sides editor without a redundant single-length reset.
Selector-list checks cover shared branch updates/additions/removals, base and
combined states, responsive queries, retained comments/importance, exact-source
Undo/Redo, element-only isolation, unsupported grammar and repeated equivalent
branches. The 2026-10-14 slice passed 100 unique focused unit/component tests
across its verification runs, two native Electron tests (selector branches and
minimum/range regression), and both development application builds. Electron
verifies the pre-edit explanation, distinct Hover/Focus output, Undo/Redo,
CSS-only shared Apply, retained render source and persisted state after reopening.
Dialog-preview checks cover eligible ancestry, nested/unmapped exclusions,
closed initial state, forged parent/token rejection, original tab-order restoration,
authenticated cancellation and reselection of the same closed dialog. The native
dialog scenario checks top-layer/backdrop rendering, focus/Tab, inert opener and
Cancel clicks, Escape synchronization, unchanged snapshots for visibility controls,
automatic child revealing, text/CSS changes, Undo/Redo, explicit close/reopen,
preserved handler source and validated Apply/reopening.
The 2026-10-14 dialog slice passed 72 focused unit/component tests, four native
Electron scenarios (dialog design, existing keyboard/stylesheet controls,
selector-list editing and workspace refresh/reconnection), and the renderer
development build. The native dialog screenshot was visually inspected; large
content scrolls within the dialog when the available preview viewport is short.
The follow-up dialog/form-body slice passed 52 focused unit/component tests,
including the edited dialog template's real Node tests, two native Electron
scenarios and both development application builds. Native checks verify that the
dialog select and close button share their height and bottom edge, form-body
addition/reordering, retained sibling content, Undo/Redo, text/style Apply and
reopening. The final aligned-controls screenshot was visually inspected.
The custom-overlay follow-up passed 53 unique focused unit/component tests across
verification runs, three native Electron scenarios (custom dialog/popover design,
native dialog/form regression and iframe keyboard regression), and the renderer
development build. Tests cover eligible/mixed ancestry, hidden-root overrides,
authored style retention, manual popover mode/restoration, forged requests and
authenticated Escape. Electron verifies native popover top-layer state, custom
modal focus cycling, inert buttons, text/style editing, Undo/Redo, Apply/reopen
and preservation of authored hidden/ARIA/popover state. The popup screenshot was
visually inspected. This verifies the explicit role/popover patterns, not arbitrary
framework widgets or nested overlay managers.
Populated-group movement tests cover nested same-instance SDK calls, primitive
inputs, registered stylesheet maps, unavailable inputs, helper/spread/object-read
rejection, exact atomic Undo, retained parent/child editing and unchanged CSS.
Electron checks moving a styled group with a connected button, its new hierarchy,
computed styles, Undo/Redo, nested text edits, Apply and source-based reopening.
The snapshot/restore test hit the existing “IDE is synchronizing. Retry Apply.”
guard during this verification run and passed when rerun alone. No Apply guard
was relaxed; treat that path as timing-sensitive when investigating future failures.
The template suites separately verify the fixtures. They do not
prove support for arbitrary code, unrestricted cross-container moves or backend simulation.

## Decisions to make before implementation

1. Final label: keep **Live UI editor**, or use **UI Designer** with Live Preview
   as a mode. This document uses the current label for continuity.
2. Legacy graph removal is decided and implemented. Do not reintroduce it as an
   advanced mode without an explicit product request.
3. Extend the supported source patterns and stable-ID strategy for structural
   editing. Current element IDs and source ranges are scoped to a revision, not
   persistent identities across arbitrary code rewrites.
4. Preview execution and mock transport boundary, including which existing host
   components can be reused safely without activating a deployed plugin.
5. Whether workspace metadata is needed and where it is persisted/snapshotted.
6. Which generated SDK signatures receive writable semantic adapters first, and
   how workspace SDK resolution/version changes invalidate imported visual drafts.

Avoid expanding into capabilities composition, organization distribution or a new
general workflow engine as part of this UI effort. Those remain separate product
concerns unless explicitly brought into scope.

## Resuming in a new session

Suggested handoff prompt:

> Read docs/LIVE_UI_EDITOR.md and inspect its referenced implementation paths.
> We want a visual plugin UI builder connected bidirectionally to the IDE, with
> workspace source authoritative and unsupported code preserved. Check which
> milestones are actually implemented before starting. Preview, source selection,
> focused text/CSS edits, diff and restore-point-backed Apply are implemented. The
> legacy graph and width selector are removed. Milestone 3 has a first supported
> slice: insert five presets, reorder within containers and remove eligible leaves.
> Same-scope cross-container moves support identifier-backed elements and eligible
> populated/styled inline groups. Nested same-instance SDK calls, string composition,
> stable primitive inputs and registered CSS bindings retain children/styles/actions.
> Helper calls, arbitrary object reads, spreads, other scopes, cycles and unavailable
> inputs are rejected with an arrangement explanation. Moves remain one Undo/Redo step.
> New disabled buttons can reuse existing static declarative click actions, with
> atomic target/binding edits and Undo/Redo. Unmodified unique connections can
> change action or disconnect without deleting handlers; custom/shared bindings
> and new action logic stay in code.
> Preview actions never execute. Reopening discovers connections from source.
> Element attributes now edit literal aria-label, aria-description, title and
> input/textarea placeholder fields with Enter-to-preview and removal. IDs and
> managed action titles stay protected; computed/shared attributes remain read-only.
> SDK attribute escaping, Undo/Redo, Apply and reopening use the existing workflow.
> Native top-level dialogs have design-only visibility controls. Selecting a
> dialog child reveals it; native focus/Tab and Escape work through the fixed
> bridge. Dialog text/styles survive draft rerenders, Undo/Redo and Apply.
> Explicit custom dialog roles and native popovers also have visibility-only design
> previews. Manual popover mode and hidden/ARIA/display overrides never enter source.
> Save/Cancel handlers, framework-specific popups and nested interactions remain future work.
> CSS color properties now have a native picker and opacity slider. Choices update
> the value field before Preview; variables/advanced expressions remain text and
> are not rewritten by opening the picker. State/responsive/isolation rules remain
> compatible, and alpha is preserved in explicit picker output.
> Single CSS lengths have number/unit controls and Enter-to-preview. Expressions,
> keywords and multi-value shorthands stay as text unless explicitly replaced;
> unit changes keep the number and use the same isolated/shared draft workflow.
> Margin/padding also offer a Spacing sides disclosure for physical Top/Right/
> Bottom/Left edits, preserving untouched side values. Expressions stay text-only;
> negative/auto margins and nonnegative padding are checked before preview.
> Consecutive visual applies share a persisted working snapshot, with explicit
> milestone checkpoints and automatic group boundaries for external edits/restores.
> Movement, insertion/removal, text and CSS edits can accumulate in one draft,
> with direct positioning and Undo/Redo before one validated multi-file Apply.
> Blueprint hotkeys work across the Live UI window and sandbox preview. Eligible
> elements can receive existing stylesheet classes through their rendering DOM
> instance. CSS edits default to a separate class for the selected element, copying
> effective states/imports/responsive rules; editing a shared class requires an
> explicit choice. Copies use a flat numbered `-local` family. New named classes
> can be created in imported CSS files, then styled immediately. Disclosure cards
> use keyboard-accessible native controls; inline class-name errors explain how to
> correct invalid input. Editable base/simple-state declarations can be removed.
> Hover, Focus, Focus visible and Active rules can be edited and visually forced
> on the selected element without executing handlers. Combined interaction states
> are editable, including reordered equivalents; complex selectors remain read-only.
> Simple selector lists can be split on edit so only the chosen class/state changes;
> remaining branches keep their declarations, and Undo restores the exact list.
> Simple max-width media rules are editable at preset/discovered widths, with
> exact-width preview and Fit preview controls.
> Custom max-width creation validates whole pixels, uses Enter-to-property focus,
> and preserves scope/Undo/Redo; existing widths are selected without draft edits.
> Minimum and inclusive range rules use structured bounds, canonical matching and
> preview checks at/outside the boundaries. Existing inclusive whole-pixel width
> comparisons use the same controls, preserve their original syntax and share
> ambiguity protection with equivalent conventional rules. Strict comparisons,
> other units/features and nested/media-type queries remain planned.
> Broader query/selector editing remains planned. Multi-file
> isolation/class creation is one Undo/Redo and one Apply. Supported declarations can be added to an unambiguous base CSS rule.
> The CSS property picker discovers the bundled browser’s property inventory,
> supports partial/semantic search, and moves to value entry on Enter. Enter again
> previews the edit; common layout values also have quick choices.
> Pending summaries count net changed files, and Undo history rolls off safely
> instead of blocking long sessions. Broader responsive/style editors remain planned.
> Combined states retain responsive scope, isolation and Undo/Redo.
> Expand the documented structural/style limits next; backend simulation is future work. Reuse existing
> workspace revisions, snapshots, validation and CSS handling; do not rewrite
> arbitrary plugin code or treat this design draft as already shipped behavior.

At the end of each implementation session, update status, completed acceptance
gates, actual source/test entry points, remaining decisions and known limitations
here. A passing template test is not evidence that Live UI synchronization works.


### SDK slot arrangement verification (2026-10-14)

`liveUi/sdkSlotEdits.js` derives direct content entries from the restricted AST
interpreter and plans host-owned source edits. `SdkComponentEditor.jsx` displays
slot-scoped ordering/removal controls. The source adapters and inspector passed
346 focused tests across 31 suites; main and renderer builds passed (the existing
main-build js-yaml warning remains). The Electron component property/slot scenario
passed ordering, removal, exact Undo/Redo, Apply and subsequent IDE-source refresh.

Coverage includes nested concatenation/comments, named-fragment removal protection,
action-target protection, slot boundaries and first/last movement limits. Shared,
opaque and SDK-generated content remain protected; cross-slot movement and custom
controller/action authoring remain future work.


### SDK content discovery and cross-slot transfers (2026-10-14)

`SdkSlotEditor.jsx` separates content from text properties and appears first for
mapped SDK roots. Its slot selector explains Body and Footer, and empty slots have
a Blueprint NonIdealState. The child inspector offers a contextual jump to the
containing SDK component, using the sanitized preview tree without a source edit.

`liveUi/sdkSlotEdits.js` supports body/footer transfers within the same literal,
unique component call. It preserves named declarations and DOM identities, appends
to an existing destination or inserts its missing property, and retains source
comments/separators. Different helper evaluation scopes remain protected.

353 focused tests across 31 suites passed, including both destination source
orders, absent destination properties, action-target preservation, exact draft
Undo/Redo, invalid destination rejection, and content-section navigation. Both
builds passed with the pre-existing main-build js-yaml warning. The Electron slot
scenario passed child-to-component navigation, transfers in both directions,
Undo/Redo, Apply, unchanged index.ts and later IDE-to-preview refresh. Cross-component
moves, custom controller actions and dynamic/shared compositions remain pending.

### SDK content block editing verification (2026-10-15)

`SdkSlotEditor.jsx` now exposes Inspect, Duplicate and a direct Position selector
for source-mapped slot blocks. Inspection uses the normal element selection flow,
without a source request. Host-owned `sdkSlotEdits.js` validates every destination
and permits positional movement only across a contiguous run of supported blocks.
It rotates exact source fragments while retaining intervening comments/separators.
Duplication is limited to safe inline leaves/empty containers with no identities or
action targets; named/shared content remains protected. Copies get independent
AST locations, retaining existing classes and the normal CSS isolation workflow.

357 focused tests across 31 suites passed, including independent copied text,
exact Undo/Redo, positional movement in both directions, invalid positions, opaque
barriers and identity protection. Main and renderer builds passed with the existing
main-build js-yaml warning. The native Electron slot scenario passed duplication,
Inspect, independent text changes, third-to-first positioning, Undo/Redo and Apply,
while preserving index.ts and later IDE-to-preview refresh. Backend simulation,
durable draft persistence, broader layout adapters and custom action creation
remain pending as listed above.

### Bounded string replacement adapter verification (2026-10-15)

`liveUi/stringPreview.js` implements bounded string replacement and validates
literal regexes before native search. `staticPreview.js` dispatches only primitive
string replace/replaceAll calls and interprets callbacks through its existing
expression/call budgets. Replacement output is accumulated with a size guard,
including prefix/suffix expansion. Regex backreferences, captures, general
repetition/alternation and unsupported flags remain diagnostic, not executed.

401 focused tests across 32 suites passed. New coverage compares literal searches,
replacement tokens, global/case-insensitive search, empty matches, Unicode progress
and whitespace normalization with native semantics. It verifies callback isolation,
per-match budgets, output expansion limits, rejected patterns and retained source
mapping for SDK markup inserted through a placeholder. Main and renderer builds
passed with the existing main-build js-yaml warning. The Electron replacement
scenario passed preview, escaped text, mapped source edits, Undo/Redo and validated
Apply while preserving index.ts. Structural adapters do not infer editable
containers from arbitrary literal HTML, and dynamic/complex render paths remain
in the roadmap.


### Literal HTML structure verification (2026-10-15)

`htmlLiteralPreview.js` adds host-owned source provenance and parse5-based HTML
locations without altering intermediate string values or SDK arguments. The pinned,
already installed parse5 7.3.0 is now a direct production dependency. The string
replacement adapter reports unchanged spans; final selection IDs are injected only
into the preview HTML. Existing SDK source mapping runs separately.

The actual installed test-json-validator sources were inspected read-only and passed
a local preview audit with more than 20 mapped elements. The portable fixture covers
its full render template and attribute-replacement behavior. The focused regression
run passed 405 tests across 33 suites; the final literal suite additionally passed
its multiline-string case (five tests total). Electron verified hierarchy visibility,
retained styles, plain-text editing, Undo/Redo, validated Apply, unchanged index.ts and
Show in code navigation to render.tsx. Both builds passed with the existing main-build
js-yaml warning. The installed plugin files were not modified.


### Literal HTML attribute editing verification (2026-10-15)

`htmlLiteralAttributes.js` describes the supported accessible labels, tooltips and
placeholders using parse5 source ranges. It requires an unchanged, unique start tag,
rejects duplicate attributes, and chooses an HTML quote compatible with the outer
JavaScript literal. The shared attribute planner replaces complete attributes,
inserts missing fields before the closing marker, or removes only the source
attribute. Entities preserve both HTML value and JS grammar. Text encoding uses the
same helper. IDs, classes, styles, event handlers, data-action targets and ARIA
reference identifiers remain protected. Preview ID insertion also preserves trailing
slashes belonging to unquoted values instead of treating every slash as self-closing.

415 regression tests across 34 suites passed before the final slash-edge cases;
the final targeted run passed 31 tests, including both new cases. Coverage includes
quoted/unquoted HTML, all three outer JS quote styles, metacharacters, set/add/remove,
empty-vs-missing semantics, transformed/duplicate tags, protected field rejection,
exact Undo/Redo and preservation of the JSON inspector's binding identifiers.
Both builds passed with the existing main-build js-yaml warning. The native Electron
scenario verifies placeholder and accessible-label edits, Undo/Redo, validated Apply,
retained CSS/bindings, unchanged index.ts and source navigation. Broader literal
layout/CSS editing, dynamic render adapters and durable drafts remain pending.


### Local HTML style override verification (2026-10-15)

`htmlLiteralStyles.js` describes and plans per-element inline declaration edits on
unique, unchanged HTML start tags. `HtmlInlineStyleEditor.jsx` reuses the browser's
searchable property inventory, color/opacity picker and length controls. Enter after
property selection focuses the value input after it becomes enabled. Existing
comments, declaration order and !important priority are preserved; removing a final
declaration removes the style attribute. Shared classes and embedded CSS are retained.

The host validates one declaration value, rejects selector/declaration injection,
invalid operations and duplicate/malformed inline lists, and uses the enclosing JS
literal's safe quote/entity encoding. Reset removes an override; stylesheet rules,
including their own !important precedence, then apply normally. These controls edit
base inline declarations, not hover/media rules or shared stylesheet selectors.

426 regression tests across 36 suites passed. The final focused run passed nine
inline-style unit/component tests, including keyboard focus, per-element isolation,
all enclosing quote styles, priority/comments, exact Undo/Redo, readonly/injection
cases and JS metacharacters. Both builds passed with the existing main-build js-yaml
warning. The Electron JSON inspector scenario covers inline color changes, reset,
Undo/Redo, subsequent attribute edits, validated Apply, retained embedded stylesheet
and plugin bindings, unchanged index.ts and source navigation. Broader structural
literal edits, dynamic render adapters and durable drafts remain roadmap work.


### Compact inline formatting and multiple overrides (2026-10-15)

The inline CSS serializer no longer infers stylesheet indentation for new
attribute declarations. Formatting trivia before declarations and after the list
is normalized; values, comments and priority are retained. New overrides produce
compact source such as `style="text-align: right; color: #123456"`. Existing
newline entities used only for CSS formatting are cleaned on the next override
edit; actual newlines inside CSS values/comments remain encoded when necessary.
`&#10;` is an HTML newline entity, not a CSS property or a required delimiter.

The inspector lists current declarations with direct edit/remove controls and an
explicit Add another override action. Adding focuses an empty property search;
editing a list entry focuses its value. Each operation uses the same draft and
Apply, and removing one declaration leaves the others intact. Targeted tests cover
three-property accumulation, selective removal, clean source, existing formatting,
semantic CSS-string preservation and the multiple-override list/focus workflow.

Verification: 429 regression tests across 36 suites, both builds and the native
Electron JSON inspector scenario passed. Electron covers adding color/alignment,
list-based edit/removal, preservation of the other declaration, Undo, clean saved
source and validated Apply. The multiple-override inspector screenshot was reviewed.
The main build retains its pre-existing js-yaml export warning.

### Literal HTML sibling arrangement verification (2026-10-15)

`htmlLiteralStructure.js` derives direct sibling positions from parse5's authored
nodes and verified string provenance. Host-owned move patches rotate complete
source fragments, retain intervening comments/whitespace, and supply relocation
ranges so selection follows its source across new preview IDs. Existing position
controls and Blueprint movement shortcuts are reused. Protected destinations are
disabled in the selector and independently rejected by the host.

Only same-container sibling runs in supported HTML containers are movable. Every
moved/crossed block must have intact source, an explicit closing tag (or be a void
HTML element), and a mapped HTML subtree. Significant interleaved text, omitted
closing tags, unrepresented script/style/template elements, foreign markup and
transformed container contents remain barriers. This adapter does not authorize
container insertion/removal, cross-container movement or action changes.

435 tests across 37 suites passed, along with both builds and the native Electron
JSON inspector scenario. Coverage includes direct and adjacent movement, comments,
nested fragments, binding IDs, exact Undo/Redo, invalid destinations, barriers,
source selection and disabled UI positions. Electron checks position selection,
Alt+Down outside inputs, Undo/Redo, saved order after Apply, later local style/attribute
edits, unchanged embedded CSS/index.ts and source navigation. The main build retains
its pre-existing js-yaml export warning. The inspector screenshot was reviewed.


### Passive literal text duplication (2026-10-15)

**Duplicate text** copies a source-mapped static text leaf after itself and selects
its copy. Edit its text, reorder it, Undo/Redo, and apply with the rest of the draft.
Supported leaves include paragraphs, headings, spans and emphasis in unchanged
mapped containers. IDs, data attributes, event handlers, ARIA references, controls
and nested markup block duplication. Exact source markup is retained; class names
are shared, so use local inline overrides when styling just the copy.

### SDK guide recovery during workspace repair (2026-10-15)

When scoped repair encounters an outdated SDK guide, it leaves files untouched and
offers **Update guide and resume repair**. This rechecks the current workspace,
adds `/SKILL.md` to the confirmed repair paths, migrates the existing product guide
against the installed SDK, and pauses for human approval before generating repairs.
The guide sees all existing workspace paths, including retained acceptance tests.
Cancellation or failed validation does not apply the candidate transaction.

Verification: source/draft unit tests and the native Electron JSON inspector scenario
cover duplicate selection, independent copy text, Undo/Redo, existing ordering,
style/attribute edits and Apply. Guide recovery component tests cover the explicit
retry action and unchanged files on failure; Node IPC/generation tests cover typed
metadata, guide-first approval, cancellation and retained workspace context. Both
Electron builds pass. Broader Codex CLI tests currently encounter the existing
`js-yaml` `safeLoad` incompatibility; that is separate from this recovery flow.

### Review-driven SDK helper migration (2026-10-15)

**Review workspace** now includes handwritten production HTML in its source
checks, even when plugin tests pass or the model reports no defects. Findings
identify the affected file, fragment locations and tags. **Review & repair**
includes those files in its scoped repair request and asks the selected provider
to migrate the complete UI composition to installed SDK helpers. Existing SDK
metadata/declarations determine valid APIs; generic `dom.createElement` handles
tags without a dedicated helper. Wrapping raw HTML in `renderHTML` does not count
as migration.

Migration preserves content, hierarchy, IDs, classes, data/ARIA attributes, input
escaping, style collectors and frontend/backend bindings. Source inspection does
not execute plugin code. Tests, snapshots, docs and JSON samples are excluded;
ambiguous user-data strings and unsupported compositions require review before
rewriting. After repair the host rescans current sources; remaining raw markup
keeps the report partial with concrete locations, even if tests pass. Review alone
leaves files untouched. This is an AI-assisted repair, not a blanket text codemod
or a new ban on valid legacy plugins.


### SDK components inside nested layouts (2026-10-15)

The SDK catalog can now append Dialog, Confirmation Dialog and Popover to supported
nested `section`, `div`, `article`, `aside`, `header`, `footer` and `nav` layouts,
as well as the top-level `main`. The catalog identifies the selected insertion
container before Add. Every rendered ancestor back to main must have its own
unique, editable SDK composition using the root render DOM owner. Different DOM
collectors remain protected until their style ownership can be verified. Forms, native/custom overlays, popovers,
shared/repeated calls and opaque literal wrappers block insertion beneath them.
Leaf and unsupported component sites stay disabled, and the host independently
checks eligibility.

Insertion uses the selected container's DOM receiver and SDK entry, keeps existing
content and siblings, generates collision-free IDs/import aliases, and selects the
new component with appearance/slot editing available. Additions share the existing
draft, exact Undo/Redo, source validation, one Apply and grouped restore history.
No plugin handlers or backend code execute during preview.

Verification: 446 Live UI regression checks passed across 37 suites. After adding
the DOM-owner guard, 46 focused insertion/component/opener/catalog/preview checks
passed, including a new ownership test. Both Electron builds passed (the main
build retains the existing js-yaml warning). Native checks passed for the existing
three-component top-level catalog and the new nested-dialog flow: correct rendered
parent, preserved siblings, selected component appearance, exact Undo/Redo,
protected form descendants, unchanged source before Apply, persisted nested
composition, unchanged index.ts and Inspect reopening after Apply. The nested
dialog screenshot was reviewed.

### Independent SDK leaf duplication (2026-10-15)

Select an eligible inline SDK `dom.createElement(...)` leaf and choose
**Structure → Duplicate element**. It creates a second inline composition after
the original and selects the copy for immediate text/style editing. Supported
leaves include passive text, result panels, empty layout containers and disabled
unconnected buttons. Existing stylesheet classes are reused; use style isolation
when changing only the copy's shared-class styling.

Eligibility requires a unique direct child composition, safe same-DOM inputs and
no identity or binding attributes. IDs, ARIA references, connected/active controls,
SDK overlay roots, custom dialog/control roles, unsafe populated containers, executable
tags, named/shared fragments and repeated render sites remain protected. No new
IDs or declarations are guessed, and caller-supplied source ranges are ignored.
The host validates every operation independently of the disabled button.

Duplication shares the existing draft and one Apply with text, styles, arranging
and other edits. Selection follows the copy; Undo/Redo restores exact source and
selection. Original style registration and backend/frontend handlers stay intact.


Verification: all 462 Live UI checks across 38 suites passed, including SDK
compilation of duplicated leaves, copy selection, independent text/style behavior,
exact source/selection Undo/Redo and rejection of identities, bindings, shared
fragments, active/custom controls, overlay roles and executable/populated content.
Both Electron builds passed with the existing main js-yaml warning. The native
Electron scenario passed independent copy editing, preserved emitted styling,
protected bound buttons, disabled unconnected button copies, unchanged workspace
source before Apply, one Apply, and unchanged index.ts/styles.css. Its screenshot
was reviewed.


### Populated SDK container duplication (2026-10-15)

**Structure → Duplicate element** now supports populated SDK cards and layout
sections when their entire inline subtree is safe. The inspector shows how many
SDK elements will be copied, or a concrete reason that a block is protected. The
whole copy is selected; select any copied child to edit it independently. Shared
stylesheet classes and registration remain intact; local style isolation is still
available when only the copy should change.

The host checks each descendant's source identity, same-DOM ownership, allowed
tags/roles/attributes and child expressions. IDs, ARIA references, binding/data
attributes, active controls, overlays, shared/repeated declarations, arbitrary
helper calls and raw/named HTML block the whole operation. Safe primitive text
reads, nested inline SDK composition, disabled unconnected buttons and verified
style inputs are supported. Exact source/comment copying, Undo/Redo, selection,
source validation and one Apply use the existing draft pipeline. Populated
container removal remains protected because deleting it can require relationship
updates elsewhere.

Verification: 471 regression checks across 38 suites passed. After tightening the
passive-role allowlist (including explicit tab/menu-item-toggle rejection), 73
focused structure, duplication, SDK component and inspector checks passed. Both
Electron builds passed with the existing main js-yaml warning. Native leaf and
populated-card scenarios passed: copy selection, clicking/editing copied children,
shared emitted styling, exact Undo/Redo, protected nested IDs, explanations,
unchanged source until one Apply and preserved index.ts/styles.css. The card
screenshot was reviewed.


### Create a local frontend handler (2026-10-15)

Select a newly inserted, unconnected SDK button and open **Create local action**.
Choose an unused Text/Result panel (or an existing uniquely managed result), enter
**Result text**, and click **Preview new action**. This creates a new zero-input
frontend handler, a click binding and a stable result marker in one draft. The
button becomes enabled. Apply saves the related source files together; Undo/Redo
reverts the whole operation. Disconnect disables the button while retaining the
handler for **Connect existing click action**.

The initial preset is **Set result text**. The SDK callback uses `textContent`, so
HTML-like input is shown as text and empty text clears the result. It makes no
backend request and captures no module/backend closure. Existing handlers and
bindings remain intact. A direct, literal `defineRenderOnLoadActions` contract is
required; custom setup, shared/opaque options and custom button wiring remain
code-only. Output targets must be unique SDK text leaves with supported attributes.
Managed markers are checked against both source literals and rendered markup;
ambiguous identities and controls are excluded. Handler/button/result names avoid
workspace collisions. The frontend callback runs only in the deployed runtime;
selection-preview clicks still select elements.

### Path from handler authoring to backend simulation

Handler creation has started; general backend simulation is still pending. It no
longer needs to wait for every structural/CSS adapter to be complete. The next
interaction milestones are:

1. A simulator action model and Run/Reset controls for supported local presets,
   with state separate from source drafts and no arbitrary handler execution.
2. A mocked backend bridge with explicit response data, latency and
   loading/success/error states. No real services or credentials are needed.
3. Backend handler presets with input/result contracts, matching SDK registration
   and frontend bindings, plus diagnostics before switching to the real runtime.

Durable draft recovery, broader layouts/styles and richer handler authoring remain
separate roadmap work. These milestones are a delivery sequence, not a claim that
an isolated backend executor already exists.

Verification: 482 Live UI checks across 40 suites and 12 HTML/review checks passed,
including installed SDK execution exactly once, plain-text/HTML-like data,
no backend call, empty action contracts, multi-file/same-file source, target
ambiguity, forged requests and disconnect/reconnect. Both Electron builds passed
with the existing main js-yaml warning. The native authoring flow passed new
handler/binding/marker creation, inert preview clicks, atomic Undo/Redo,
disconnect/reconnect, unchanged workspace before Apply and persisted source files.

### Local action simulation: Run and Reset (2026-10-15)

Select a connected **Set result text** preset and open **Local action preview**.
**Run local action** shows its result text; **Reset simulation** restores every
simulated result to its authored text. Ordinary canvas clicks continue selecting
components. Neither command creates pending edits, changes workspace files or
adds snapshots. Draft changes, Undo/Redo, Apply and refresh rebuild the preview
and discard transient simulation state.

The host recognizes the complete callback AST, not its name: a zero-input arrow
with exactly the generated querySelector and guarded textContent assignment.
Custom callbacks, added calls, dynamic text, custom setup and ambiguous targets
stay code-only. Only connected, uniquely managed buttons and unique supported
SDK text leaves receive simulator metadata. The sanitized iframe independently
checks button/target identities, target tags and leaf structure. Authenticated
parent messages select an allowlisted action; they cannot supply arbitrary code,
selectors or replacement text. Serialized result text escapes script delimiters;
textContent preserves HTML-like values as plain text. SDK handlers and backend
code are never executed in preview.

This completes the first interaction milestone above. Mocked backend responses,
latency and loading/error scenarios are next; real backend simulation and backend
handler creation remain pending.

Verification: 473 checks across 33 Live UI suites passed, including callback
shape rejection, message authentication, inert HTML-like text, target validation
and repeated Run/Reset. Both Electron builds passed (existing main js-yaml
warning). The native authoring scenario passed Run/Reset, unchanged pending-edit
count and source, Undo/Redo, disconnect/reconnect and Apply. Screenshot reviewed.

### Mock backend scenarios and iframe autofocus (2026-10-15)

In **Local action preview**, change **Simulation mode** to **Mock backend
response**. Choose success or error, supply JSON/error text, a loading message,
and latency from 0 to 10,000 ms. **Run mock request** immediately shows loading
and then the configured result, with distinct loading/success/error outlines and
aria-busy while pending. JSON is formatted and displayed as plain text, including
nested values. Invalid JSON, excessive payloads, empty messages and invalid delays
prevent Run. Error messages are plain text too.

This first mocked bridge uses the selected preset's uniquely managed result
leaf. It does not call or generate a backend handler, execute plugin callbacks,
request credentials, or send network traffic. The deployed action retains its
authored behavior. Mock settings and result state are temporary and never enter
the workspace draft or snapshot history. Backend handler authoring and automatic
mapping of arbitrary existing handler contracts remain next steps.

A newer Run cancels the pending response for the same result target. Running the
local action cancels its pending mock too. Reset cancels all pending mocks and
restores authored text, aria-busy and simulation decoration; source/draft refresh
recreates the iframe. Messages require the parent and current token, an allowlisted
action, and independently validated bounded scenario data. Timers cannot overwrite
newer results or Reset. A mocked error is an expected scenario outcome, not a
source validation failure.

Design preview removes autofocus attributes before insertion. Rendered plugin
HTML and supplied React intrinsic elements are also normalized before mounting,
without rewriting workspace files, input values or explicit focus callbacks.
Literal React text stays literal. Custom components/dynamically inserted markup
remain their author's responsibility; shared AI guidance now avoids autofocus in
sandboxed UI and recommends SDK or user-triggered focus. Sandbox isolation is
unchanged. This addresses Chromium's blocked cross-origin subframe autofocus
warning without granting extra iframe permissions.

Verification: 490 checks across 37 suites and both Electron builds passed (the
existing main js-yaml warning remains). Two native Electron scenarios passed:
local/mock Run, JSON/error display, loading, pending Reset, unchanged draft/source,
Undo/Redo and Apply; plus actual sandboxed SDK UI with autofocus removed, no
blocked-autofocus console warnings, explicit input focus, overlay focus restoration
and controller disposal. Mock error screenshot reviewed.

### Typed backend action creation (2026-10-15)

Select a new, unconnected SDK button and expand **Create backend action**. Choose
**Backend result element**, enter **Backend request text**, then click **Preview
backend action**. The first preset, **Send text to backend**, creates:

- A typed `{text: string}` input and a success/error result union.
- A backend function accepting `unknown` with runtime validation (object request,
  string text, maximum 2,000 characters). Success returns text and its length.
- SDK `PluginRegistry.registerHandler` registration in the plugin's init method.
- A self-contained asynchronous frontend handler using the SDK transport, loading
  text, pending-click protection, response validation, plain-text JSON/error
  output and finally-block loading cleanup.
- A managed result marker and declarative click binding.

All related edits share one draft operation and one Apply. Undo/Redo restores the
whole operation; disconnect disables the button but retains its frontend/backend
handlers and types for reconnecting. Existing init code, handlers and unrelated
source remain intact. Names avoid workspace collisions. Supported source requires
a direct literal TypeScript action contract, an ordinary synchronous zero-input
init method, and unique managed button/result identities. Custom setup and opaque
initialization remain code-only. Same-file render/entry source is supported.

**Backend action preview** only offers mock execution, seeded with a typed success
response for the configured text. Canvas clicks still select. Even a forged local
Run command cannot execute a backend descriptor. No backend function or SDK
transport runs in the design iframe. After Apply, build and deploy the plugin to
exercise the real handler. The generated result displays JSON/error as text, so
markup-like payloads never become elements.

This is a fixed-text round-trip preset, not a general backend code generator.
Binding request fields to managed UI inputs is next, followed by additional
handler presets, richer result mapping and diagnostics for switching from mock
data to real services. Arbitrary backend execution in preview remains excluded.

Verification: 484 Live UI checks across 36 suites passed. Both Electron builds
passed with the existing main js-yaml warning. Installed-SDK tests covered a real
request/result round trip, malformed inputs, duplicate-click protection, rejected
requests, error envelopes, atomic history, repeated naming, same-file source and
mock-only backend descriptors. The native Electron scenario created the action,
mocked it without execution, applied, built, deployed and exercised the actual SDK
transport successfully. Disconnect/reconnect and Undo/Redo passed. Screenshot
reviewed.

### Bind backend text requests to UI inputs (2026-10-15)

**Create backend action → Request text source** now offers **Fixed text** and
**UI text input**. For UI input, select **Backend request input** as well as the
result element. Add an **Input** component first if needed. The preset binds a
unique SDK textarea or text/search input through a collision-free managed marker.
The marker, frontend read, backend registration/types, result marker and click
binding are one reversible draft operation. Existing fixed-text actions continue
to work. Disconnect retains the input relationship for reconnecting.

The deployed handler reads `.value` on every click. Empty text is valid; values
over 2,000 characters are rejected before transport and again at the backend
boundary. A missing, disabled or read-only input shows a useful error and clears
loading without sending a request. Input elements also retain a runtime
text/search type check. Both frontend and backend continue to display data as
plain text.

Custom IDs/data wiring, shared source, duplicate managed markers, password and
non-text inputs are excluded. The adapter validates both source and rendered
identity and the complete generated callback shape. It does not guess selectors
for arbitrary existing controls. Input and result sources may be in different
modules; changes use the existing multi-file history and Apply pipeline.

**Backend action preview** identifies the bound input. Its editable mock JSON is
seeded from the authored input value (up to the request limit), not live backend
execution. Ordinary design-canvas clicks continue selecting elements. Build and
deploy to test actual typed values and transport. Editable mock request fixtures,
additional handler presets and richer response-to-component mapping remain next
interaction work.

Verification: 487 checks across 36 suites and both Electron builds passed (the
existing main js-yaml warning remains). Two native scenarios created, mocked,
applied, built and deployed fixed/input-bound presets. The deployed input-bound
handler read changed values on later clicks, accepted empty text and rejected
oversized input while clearing loading. Installed-SDK tests also covered missing,
disabled and read-only inputs without transport, text/search versus password
filtering, forged identities, ambiguous markers, callback changes and exact
Undo/Redo. The input-bound screenshot was reviewed; binding choices and preview
messages use input labels/placeholders instead of empty text labels.

### Framework class names, input controls and request fixtures (2026-10-15)

**Class names** accepts space-separated names such as `pure-button
pure-button-primary`, with no leading dots. On unique SDK elements with literal
attributes, it appends names to the existing SDK string class expression. Editing
or clearing the field preserves that expression; assigning/copying stylesheet
styles preserves the extra names too. Duplicate tokens are normalized. Invalid
selectors, control characters and excessive input show validation errors. This
adds no CSS rules and shares the normal draft, Undo/Redo and Apply pipeline.
SDK components with opaque options and shared/computed attribute maps remain
code-only. Design preview loads the same bundled PureCSS stylesheet as the plugin
host through an explicitly allowed local stylesheet URL; untrusted workspace links
are still removed and external resources remain blocked.

**Add component** now separates **Textarea (multiline)** and **Input (single
line)**. Single-line controls start as `type="text"`. **Input control → Input
type** edits supported literal types, including text, search, email, URL, telephone,
password, number and date/time. Empty, unbound controls can switch between input
and textarea without losing labels/classes. Non-empty content and custom wiring
stay protected. Managed backend textarea bindings retain their control kind;
bound single-line inputs only allow text/search, consistent with the handler
contract. Unsupported controls explain why the type needs editing in the IDE.
Slot insertion also offers the single-line preset.

Backend preview adds **Mock request text** and **Mock response source**. Choose
**Echo mock request fixture** to derive the typed success JSON from temporary
request text, or keep **Custom JSON response**. Fixtures are bounded and validated
again by the fixed preview bridge. They change neither the authored input nor
workspace files and execute no backend code. Loading/error/latency and Reset keep
their existing behavior. Richer response mapping and additional handler presets
remain next interaction milestones.

Verification: 493 checks across 38 suites and both Electron builds passed (the
existing main js-yaml warning remains). Native checks passed actual PureCSS
computed styling, single-line creation, email/textarea/text conversion, exact
Undo/Redo, unchanged source before Apply and persisted class/type edits. The
input-bound native scenario also passed editable echo fixtures without changing
the input or source, then built/deployed and exercised the real SDK transport.
Screenshot reviewed. CSS isolation and responsive/style regression suites passed
with extra class names preserved.

### Map backend response fields to result elements (2026-10-15)

**Create backend action → Result display** now selects **Full response · formatted
JSON**, **Returned text**, or **Text length** for the typed text preset. After
creation, **Backend result mapping** can change the display and choose another
supported result leaf. **Preview result mapping** updates the managed selector,
display expression and any needed result marker in one reversible operation.
Apply persists the changes together. Request input, backend function/types,
registrations, unrelated callback code and comments stay intact. The old result
marker remains available for later reuse.

Only the complete recognized preset exposes this editor. Shared/opaque targets,
modified callbacks, forged identities and unknown display fields are rejected.
Mapping uses literal known fields, never expressions or user-supplied code.
Returned strings are assigned with textContent; numeric zero and empty text are
preserved. Loading/error handling and runtime response validation remain intact.

Mock preview takes its display from the source-derived action descriptor, not the
Run message. The same custom JSON or echo fixture can therefore preview JSON,
plain text or a number. Missing/wrong-type mapped fields produce a visible mock
error rather than silently showing a fallback value. Reset and source changes
retain the existing cancellation behavior. Design preview still never runs backend
code, even for mapped actions.

These are fields of the current typed text contract. Additional handler presets
and their result contracts come next; arbitrary nested paths and multi-component
response mapping remain future work.

Verification: 498 checks across 39 suites passed, plus focused callback-comment,
empty/zero field, malformed mapping and fixed-bridge override checks. Both Electron
builds passed with the existing main js-yaml warning. Two native scenarios passed
full-JSON compatibility and mapped plain-text retargeting, atomic Undo/Redo, mock
fixtures, unchanged old output and source until Apply, then build/deploy and actual
SDK execution. Changed/empty input and oversized-input validation remained correct.
The mapped result screenshot was reviewed.

### Inspect JSON backend preset (2026-10-15)

**Create backend action → Backend preset → Inspect JSON locally** creates a typed
JSON inspection handler using either fixed request text or a managed UI input.
It retains the same 2,000-character request boundary, input/result markers, SDK
registration, loading cleanup, atomic history and Apply behavior as the text
preset. Existing Send text actions remain compatible. Names avoid collisions
across both presets.

Successful results contain `summary`, `valueType`, `itemCount` and
`topLevelKeys`. Objects report their own top-level keys/count; arrays report their
length and no object keys; null, strings, numbers and booleans report their type
with count zero and no keys. Nested values are parsed but are not flattened.
Malformed JSON returns a typed error with the parser's explanation. Invalid
transport inputs and oversized requests are rejected before parsing.

Result display/mapping is contract-specific: full JSON, summary, value type,
item count or top-level keys. Empty key arrays and zero counts remain visible.
Keys and errors are plain text, including markup-like or special property names.
Runtime frontend validation checks the success envelope, type enum, count and
key types before displaying the selected field. Modified callbacks remain
code-only; changing mappings preserves unrelated code/comments and the backend.

**Mock response source → Inspect mock JSON fixture** uses the trusted,
self-contained inspection helper also emitted into the generated backend. It
never invokes plugin handlers. Valid fixture text generates matching typed JSON;
malformed text produces a simulated error with normal latency/loading behavior.
Custom mock JSON remains available, including missing-field/error scenarios.
Source-derived preset/mapping metadata controls display in the fixed bridge.

This adds a useful second handler contract. Arbitrary backend execution, nested
field paths and one-response-to-multiple-components mapping remain separate
milestones.

Verification: 502 checks across 39 suites and both Electron builds passed (the
existing main js-yaml warning remains). Installed-SDK checks covered the emitted
JSON backend, all JSON value categories, typed failures, contract-specific mapping
and plain-text frontend output/loading cleanup. Two native scenarios passed:
existing text compatibility and JSON preset authoring, Undo/Redo,
disconnect/reconnect, fixture keys/error states, unchanged source before Apply,
build/deploy, actual bound-input SDK requests, object/array/null responses and
malformed-input cleanup. The JSON preset screenshot was reviewed.

### Remove generated actions and map multiple results (2026-10-15)

The Inspector's **Actions** section lists generated local and backend actions,
including disconnected ones, with a filter and control-use count. Select an entry
and click **Remove generated action**. For one managed connected control this
also disconnects/disables its button. For a disconnected action it removes the
unused callback directly. Backend cleanup removes the unchanged generated SDK
registration, backend helper, input/result types, private SDK import and owned
comment. Input/result elements and unrelated source remain intact. Unused managed
markers are released, which also unlocks input-kind editing; markers referenced
by other actions or custom selectors remain.

Removal is one draft operation. Undo restores the complete action and all related
files; Apply persists removal. Rebuild/redeploy to update a running plugin.
Disconnect remains separate and preserves reusable code. Multiple controls,
modified callbacks/backend contracts, unreadable modules and external references
block automatic cleanup with an explanation. Checks include identifiers, literal
and static-template handler references, namespace imports and star re-exports.
Only recognized presets with private, unchanged generated dependencies are
removed automatically; custom code stays in the IDE.

**Backend result mapping → Add result output** maps a single SDK response to up
to four distinct supported text/result elements. Each has a contract field choice.
For example, a JSON Inspector can display summary, item count and top-level keys
separately. Output rows can also be removed. One Preview/Apply includes callback
changes and new markers; request input and backend implementation remain intact.
Generated callbacks validate the response and locate all outputs before success
writes. The primary result owns loading/errors; extra results retain their last
successful values on failure and update together on success. All output remains
plain text. Callback comments are retained when restructuring output mappings.

Mock preview supports the same outputs and per-field validation. Missing fields
fail the primary result without partially writing extra results. Reset restores
all authored text, state decorations and aria-busy values. Pending requests that
share any output are cancelled before newer runs; local Run also cancels a mock
using its target. Cancellation restores affected targets, so no orphan loading
indicator or late response overwrites a newer result. No plugin callback/backend
code executes in design preview.

Verification: 512 regression checks across 41 suites passed, plus a focused shared
marker ownership check (513 checks covered in total). Both Electron builds passed
with the existing main js-yaml warning. Two native scenarios passed disconnected
local removal and multi-output JSON authoring, Apply/build/deploy, actual SDK
summary/count/keys output, connected backend cleanup, exact removal Undo/Redo and
saved source without generated dependencies. Ownership checks covered modified
code, shared controls, external references and releasing only unused markers.
The multi-output screenshot was reviewed.

### SDK 1.7 authoring components

The installed `ui-components.json` contract (1.2.0) now enables all 11 known
composition adapters. SDK catalog adds Progress Bar, Toast, Inline Alert, Toast
Region, Async Action Button, Tabs, Disclosure and Accordion alongside the existing
overlays. Each insertion uses its own required options, unique root ID, SDK import
alias and the selected layout's style collector. Insertions and property edits
participate in the existing draft/Undo/Redo/Apply flow.

Component properties support declared text, booleans, numbers (including null for
indeterminate progress) and known enum choices. Component appearance includes
feedback/progress/notification-region custom properties. Opening/closing motion
presets remain scoped to overlays. Tabs and accordions start with two items;
Item management and composed toast progress authoring are described below.
Native Disclosure body uses the existing Component content editor. New async
buttons start disabled: the developer must supply an explicit frontend `onAction`
and enable them, using its AbortSignal when doing cancellable work.

**Component state preview** changes only the isolated preview DOM. It can reveal
or hide feedback, open disclosures/accordion sections, show indeterminate progress
and simulate async pending/success/error/cancelled feedback. As authored restores
the sanitized original markup. A new source draft resets simulations. Only
host-issued component descriptors, a parent message and the random frame token
can select states. No mount functions, callbacks, transport or backend handlers
execute. Tabs can be designed through `activeKey`; runtime keyboard selection
requires their mounted controller. Toast queues remain explicit runtime behavior.

Runtime `window.loadFdoUi()` now owns every supported mount controller, including
feedback, navigation and async actions. FDO destroys those controllers before
replacing a view, aborting owned async work and clearing owned toast timers/queues.
Declarative overlay openers accept compatible component-contract major 1 versions
instead of hardcoding 1.0.0. SDK child-controller ownership remains with the SDK;
do not mount region-owned toasts or accordion-owned disclosures separately.

The coding evidence index schema-validates the published `ui-previews.json` and
checks its component-contract version, identities and states. Preview changes now
invalidate installed-knowledge identity and SDK fingerprints. Provider-neutral
generation and repair guidance covers the new components, explicit callback and
queue ownership, HTML-string composition, optional ARIA omission and cleanup.
ESM default/CommonJS identity, named exports and absence of serialized undefined
ARIA attributes are covered by installed-package regressions. These checks do not
assert that every real AI provider will follow its supplied contract correctly.

Validation for this integration: 607 regression checks across 45 suites passed;
final inspector cleanup passed eight focused component checks. Both webpack builds
passed (the pre-existing main-process js-yaml warning remains). Native Electron
coverage passed component insertion/property/state preview and Apply/build,
Dialog/Popover declarative opener deployment, mounted tabs/disclosure/feedback,
async duplicate protection and controller cancellation/disposal before rerender.
The component inspector screenshot was reviewed. Real-provider generation remains
for manual validation; the integration checks do not make network AI requests.

### Tab and accordion item management

The SDK catalog search placeholder is now **Search SDK…**, sized for the narrow
left column while retaining its accessible name, **Search SDK catalog**.

Select an SDK Tabs or Accordion instance to find **Tab items** or **Accordion
sections** in the inspector. Add an empty item (selected automatically), edit its
label, move it up/down, set disabled/initial-open state, or remove an eligible
empty item. New keys avoid existing workspace strings; existing keys and body
expressions remain unchanged. Adding appends after existing items, preserving the
default active tab. Labels are plain text escaped by the SDK.

These operations require a unique component with literal, unambiguous item objects
and literal keys, with at most 50 items. Shared/computed collections remain in the
IDE. Computed labels/state fields are individually read-only. Supported item content editing is described below; removing an item with authored content is
blocked. Removal also protects item keys/derived IDs referenced elsewhere, explicit
active tabs and the last enabled tab. Reference detection is conservative and may
require reviewing consumers in code. Exclusive accordions select an initially open section atomically; other literal
open states are closed in the same edit. Computed peer states require IDE review.

Source edits preserve comments (including commas within comments), body expressions,
IDs and unrelated source. Each edit is one draft operation with Undo/Redo; Apply
persists the batch. No frontend controller or backend handler is run while editing.

Validation: 180 focused regression checks across 12 suites and both webpack builds
passed (existing main-process js-yaml warning unchanged). The native Electron
scenario exercised tab/accordion add, rename, reorder, removal and Undo/Redo,
verified unchanged workspace source before Apply, then applied and compiled the
result. It also checked the shortened catalog placeholder and existing SDK state
previews. Catalog/collection screenshots were inspected.

### Tab and accordion item content

Each selected collection item now has its own **content** section. Use **Add to
slot** and **Preview slot addition** to append an SDK text block, container,
textarea, single-line input, disabled/unconnected button or result area. Existing
body expressions are retained and concatenated with the new SDK builder call,
using the component's DOM receiver and style collector.

The content list reuses source-backed inspection, duplicate, move and remove
operations. Inspect a block to edit its text, attributes and styles, then use
**Edit Tabs content** or **Edit Accordion content** to return. Opaque HTML,
shared fragments, action identities and unsupported expressions retain their
existing protection. No generated component internals are treated as authored
blocks. Removing all safe content blocks leaves an empty expression that permits
item removal, subject to the existing key/reference/active-tab checks. No cleanup
of shared declarations or custom code is inferred.

**Preview item** reveals that tab panel or accordion section using fixed host
DOM operations. Inspecting a child reveals its containing item automatically.
Other panels/sections respect the preview's selected state and accordion multiple
setting; nested component scopes are kept separate. This is visual simulation,
not mounted keyboard behavior, queue processing or backend execution. Source edits
reset the preview. Only source-derived component IDs/keys and authenticated parent
messages can request a preview; user-supplied selectors/code are not accepted.

The component inspector retains item selection as child additions change preview
node IDs, using component source identity. All source operations remain in draft
history and Apply; workspace source is unchanged until Apply.

Validation: 206 regression checks across 16 suites passed, plus 15 focused
inspector/selection checks after the native-discovered selection fix. Both webpack
builds passed (existing main-process js-yaml warning unchanged). The native
scenario added text/result content to nondefault tab and accordion items,
reordered and inspected it, edited escaped text, returned to the parent content,
verified unchanged source before Apply and compiled the applied result. Unit
checks covered protected fragments/identities, empty-content cleanup, exact
Undo/Redo and parent/token/key validation for preview messages.

### Move content between collection items

Tab and accordion item content now has a **Move content to** picker. Choose
another editable item, then click **Move** beside a supported block. The existing
source expression is removed from its original body and appended to the selected
destination body in one draft operation. A successful move selects the destination
item in the inspector; use **Preview item** to reveal it. Failed/blocked operations
keep the original selection. The operation does not copy or regenerate the block.

Keys, IDs, bindings and comments remain in source. In particular, a block with an
existing action identity can move without becoming duplicable or removable.
Existing shared/computed fragment and lexical-scope checks remain in force;
opaque content cannot be moved, invalid/same-item destinations are rejected, and
transfers stay inside the same source-mapped SDK component. This does not provide
cross-component or arbitrary cross-container movement. Placement-dependent CSS or
custom handler assumptions still need review after an intentional relocation.

Move participates in the existing Undo/Redo and Apply flow. Until Apply, workspace
files remain unchanged. Moving back appends to the original item; Undo restores
the exact previous content ordering and source bytes.

Preview item also scrolls the revealed body into the canvas viewport. Validation:
180 regression checks across 11 suites, 22 focused preview/collection checks and
both webpack builds passed (existing main-process js-yaml warning unchanged).
Native Electron coverage exercised transfers within both Tabs and Accordion,
destination selection, preview/viewport visibility, exact Undo/Redo, unchanged
workspace source before Apply and compilation afterward. Screenshots were reviewed.

### Remember collection item navigation

Selecting an item now records its key per SDK component in the open Live UI
session. Inspect a block (including nested body content), edit it, then choose
**Edit Tabs content** or **Edit Accordion content** to return to its owning item.
The inspector shows a **Return to … in …** hint for that context. Canvas and
Elements selection infer the item from the owning SDK markup; nested lookalike
markers in custom HTML do not override the actual direct panel/section container.

Unique literal component IDs plus source path and SDK identity retain context
when source offsets or generated preview node IDs change. Ambiguous/computed IDs
use source-call location instead. Missing item keys fall back to the first item;
item additions and successful transfers record their resulting selection. Context
is separate for each component and clears for a different workspace. Navigation
changes do not request a source patch, create a snapshot or enter draft history.

This is session memory in the open Live UI window. It is not persisted draft
history or recovery after closing/restarting the window; that remains part of the
durable-draft roadmap.

Validation: 43 focused component/preview checks passed, including nested context,
remembered/missing keys, source-offset and preview-ID changes, source-free
navigation and existing overlay navigation. Renderer webpack build passed. Native
Electron coverage verified return to the nondefault item after inspecting/editing
content, including after a cross-item transfer, followed by Undo/Redo and
Apply/build. The navigation-context screenshot was reviewed.

### Saved initial tab and accordion states

**Tab items → Default tab** now chooses the saved initial tab by label, with only
enabled items offered. **First enabled tab (SDK default)** removes the explicit
`activeKey` property and restores SDK selection behavior. The free-text activeKey
property is replaced by this picker. Item navigation and **Preview item** remain
separate: previewing another panel does not change the saved initial tab.

The host inserts/updates only a literal `activeKey`, or removes that property and
its separator while retaining comments. Computed/shared expressions remain
read-only. Disabled/missing keys are rejected, and existing active/last-enabled
tab removal/disable guards remain. Setting and resetting a previously absent
activeKey introduces no net source edit, including whitespace.

In an exclusive Accordion, setting **Section initially open → true** sets other
literal open item states to false in the same atomic draft operation. Multiple
mode retains independently open sections. A computed open peer blocks the edit
with an explanation rather than being rewritten. Keys, bodies, styles and
unrelated properties are preserved. Undo/Redo restores the entire initial-state
change together; Apply persists it with the rest of the draft. No controllers or
backend handlers are executed by these edits.

Validation: 191 regression checks across 14 suites passed, plus focused collection
checks for the zero-net-edit reset. Both webpack builds passed (existing main
js-yaml warning unchanged). Native Electron coverage selected/reset/undid/redid a
default tab, switched the initially open accordion section atomically, confirmed
preview-only panel changes retained the saved default, and applied/compiled the
result. The default-tab screenshot was reviewed.

### Composed toast progress

Select a Toast and open **Toast progress**. **Add toast progress** inserts a
labelled, initially indeterminate progress indicator into that toast's literal
composition options. Edit **Progress label**, **Progress value** and **Progress
maximum**, then choose **Preview progress settings**. Empty value means
indeterminate; zero is determinate. Value must be finite and within `[0, max]`,
with a positive finite maximum. Value/maximum changes are applied together so
shrinking a range does not require an invalid intermediate source state.

Only changed literal label/value/max fields are rewritten. Computed fields stay
read-only but do not block edits to other literal fields. Existing nested styles,
classes, explicit ARIA references, comments, other toast options and frontend code
are retained. External ARIA labels can remain in place without inventing a label.
Shared/computed progress objects remain in the IDE. Addition requires a literal
toast ID and protects source references to its reserved `${toastId}-progress` ID.
Generated child markup is owned by the toast and receives no invented source map.

**Remove toast progress** removes only the progress option and its separator.
Computed nested options or workspace references to `setProgress`/the derived ID
block automatic removal with an explanation. Reference checking is conservative;
review existing consumers in the IDE when it blocks removal. Explicit add/remove
on an otherwise untouched toast leaves no net source edit. Every operation uses
normal draft Undo/Redo and Apply.

Toasts still start hidden; use **Component state preview → open** to inspect the
indicator. Source edits reset this design state. These are initial markup edits,
not simulated task completion or backend progress. Runtime work continues to use
the toast controller's `setProgress`; do not separately mount its owned progress
child. The host disposes the toast and its child before replacing view markup.

Validation: 224 regression checks across 17 suites passed, plus 12 final focused
progress checks. Both webpack builds passed (existing main js-yaml warning
unchanged). Native Electron scenarios passed add/update/remove, indeterminate and
zero-valued progress, Undo/Redo, unchanged source before Apply and compilation.
The deployed SDK runtime updated owned toast progress through `setProgress` and
destroyed that child during view teardown. The editor screenshot was reviewed.

### Toast Region initial composition

The region content inspector now offers **Add toast to region** for a unique, literal
SDK Toast Region body. It inserts the installed SDK Toast builder through the DOM receiver's
own SDK entry, preserves existing body content and assigns fresh workspace-wide IDs and
module-local import aliases. The new toast is selected for message, appearance, progress
and design-state editing. Repeated additions, Undo/Redo and Apply use the existing draft
transaction; shared/computed options and unsupported contracts stay protected.

This authors initial HTML content, not a running notification queue. Use the toast's Open
preview state to reveal it. Queue capacity, enqueue/dequeue, event routing and runtime
controller ownership still require frontend code in the IDE. Identity-bearing toast blocks
remain protected from generic duplication/removal.

Verification: 228 regression checks across 17 suites passed; main and renderer builds
completed (main retains the existing js-yaml safeLoad warning). The native Electron
scenario passed insertion, selection, repeated component editing, Undo/Redo, Apply and
compilation; its region inspector screenshot was reviewed. An initial run failed while
loading the first progress-bar iframe before region insertion; two subsequent runs passed.

### SDK async action authoring and catalog spacing

The SDK catalog wraps long builder names within each card. Card and button sizing uses
border-box dimensions; full-width buttons retain equal left/right content gutters and
wrap their labels instead of overflowing narrow catalog columns.

SDK Async Action Buttons now offer **Async button action → Set result text** when the
workspace has a direct TypeScript `defineRenderOnLoadActions` contract and no custom
frontend setup/controller wiring. Choose a unique supported SDK Text/Result leaf, enter
plain text, and preview the action. The draft enables the button and creates a self-contained
SDK `mountAsyncActionButton` setup callback with an AbortSignal check and returned cleanup.
Existing handlers and bindings stay intact. The SDK owns pending/success/error states and
duplicate-click protection. Static previews continue to select and simulate component
states without running the authored callback; apply/deploy to exercise the real action.

Multiple managed buttons share one verified setup. Disconnect removes its configuration
and disables the button; disconnecting the last button removes the generated setup property.
The generated-action manager also lists and removes these actions. Result elements are
retained. Undo/Redo and Apply group all changed modules atomically. Shared IDs, outside
references, modified callbacks, comments inside managed setup and custom setup/mounts
remain protected for IDE editing. Backend presets were added in the next slice below. Reuse of arbitrary existing callbacks
remains pending for SDK async buttons.

Verification: 287 checks across 25 suites passed. Main and renderer builds completed
(main retains the existing js-yaml safeLoad warning). Two native Electron scenarios passed,
including measured catalog bounds/equal button gutters, visual create/disconnect/Undo/Apply,
real deployed SDK action execution, existing plugin actions and rerender. The long-method
catalog screenshot was visually reviewed.

### SDK async backend presets

Async button action now includes **Send text to backend** and **Inspect JSON locally**.
Choose fixed text or a managed input/textarea and the result field to display. The host
creates validated unknown-input handlers, typed success/error contracts, SDK registration
and the async frontend setup in one draft transaction. Presets use plugin-local processing;
no external service is involved. Backend creation requires a synchronous zero-argument init.

The SDK owns loading, success/error states, duplicate protection and Cancel. Generated
callbacks check the AbortSignal before work and after transport replies. Cancellation
prevents a late reply from changing the result; it cannot recall an already sent backend
request. Invalid responses and JSON parse failures reach the SDK error area, leaving the
previous result intact. Applied actions still work after view replacement and cleanup.

The existing isolated mock-response inspector is also available on these components.
It updates only managed result elements and never executes the generated handlers. The
SDK state preview remains a separate visual simulation.

Disconnect/Remove deletes unchanged private imports, registrations and backend helpers as
well as the frontend connection. Modified or externally referenced backend code stays
protected for IDE cleanup. Managed input/result markers are retained with their elements.
Undo/Redo restores all changed modules together. The previous local-only setup format is
still recognized, and local and backend actions can coexist in one view.

Verification: 293 broader regression checks across 25 suites passed, followed by 46
focused checks covering the final SDK-root mock guard (including its new rejection cases).
Both builds completed; main retains the existing js-yaml safeLoad warning. Native Electron
checks passed SDK lifecycle/disposal and the complete author/apply/deploy flow: mock JSON,
real JSON inspection, malformed input errors, retry, cancellation, ignored late replies and
rerender. The initial native mock attempt exposed an ordinary-button-only guard; the final
bridge accepts only host-verified, enabled SDK async roots with the existing target/token
checks, and the complete native scenario passed after that correction.

### Explicit confirmation flows

An unconnected visual button can now target SDK **Confirmation Dialog** in **Open SDK
component**. Unlike an ordinary Dialog or Popover selection, this requires choosing a
supported text/result element and entering **Confirmed result text**, then selecting
**Preview confirmation flow**. Merely selecting a confirmation dialog never invents a
callback or applies a connection. The same form can change an existing outcome.

The generated declarative attributes specify a bounded plain-text outcome. The trusted
frontend view mounts the SDK confirmation controller with an explicit onConfirm callback;
it does not evaluate workspace code or selectors supplied outside the managed result-marker
format. Confirm writes textContent; Cancel/Escape leaves the prior result intact. The SDK
owns modal behavior and focus restoration. The view owns controller/listener cleanup, and
callbacks honor aborted signals and view disposal.

The opener and result marker are one atomic draft edit, including when they reside in
different source files. Retargeting to an ordinary Dialog/Popover removes confirmation
attributes. Disconnect disables the button and removes the connection while preserving
result elements. Unique IDs, static attributes, passive result targets and existing custom
controller/reference protections remain required. Static preview clicks select elements;
Apply and deploy to test the callback. Backend confirmation work, custom callbacks and
notification routing remain pending.

Verification: 316 regression checks across 26 suites passed. Focused checks additionally
cover cross-module atomic edits, retained opener selection, the guide response budget,
passive result validation and aborted/disposed callbacks. Main/renderer builds completed
(main retains the existing js-yaml safeLoad warning). Native Electron checks passed SDK
lifecycle disposal and visual author/apply/deploy flows: Confirm writes escaped plain text,
Cancel/Escape preserves the result, focus returns to the opener, and existing actions still
work after rerender. The inspector screenshot was reviewed; textareas now use border-box
sizing, with native bounds validation to keep their right padding visible.

### Authored toast enqueue buttons

Compose one or more Toasts inside an SDK Toast Region, add an unconnected visual button,
and open **Enqueue SDK toast**. Choose the region/toast pair, visible and waiting limits,
and an optional auto-dismiss delay. Visible limits are 1–20, queued limits 0–100 and duration
0–600,000 ms; zero disables waiting or auto-dismiss respectively. Queue settings are shared
by buttons in one region: later buttons inherit and lock them until other connections are
disconnected. Each authored toast supports one enqueue button.

The connection is a source-backed declarative attribute edit; it leaves frontend setup and
backend files unchanged. Update, Disconnect, Undo/Redo and Apply use the usual draft flow.
Shared/computed identities, conflicting bindings and custom toast controllers stay protected.
Markdown SDK guidance is not mistaken for executable controller code.

In the deployed view, FDO mounts one SDK region controller per region. Clicks enqueue the
authored toast. Status feedback beside each button distinguishes visible, queued and full
states. Buttons with an existing entry are disabled, then re-enable after dismissal. The SDK
owns child controllers, queue draining, durations and dismissal. FDO removes listeners and
status nodes and destroys the region on view disposal. No plugin handler, arbitrary code or
backend operation executes in the static design preview. Event-driven routing, dynamic
notification content and broader queue authoring remain pending.

Verification: 326 checks across 28 regression suites passed, with additional focused
checks for final scope guards, foreign/nested targets and UI controls. Both builds passed
(main retains the existing js-yaml safeLoad warning), and the shared guide stayed within
its response budget. Native Electron scenarios passed overlay regression and queue authoring,
Undo/disconnect/Apply/build, shared limits, full capacity feedback, FIFO draining, repeat
enqueueing, rerender and timed dismissal. The authoring screenshot was reviewed.

SDK auto-dismiss counts unpaused visibility: hidden documents, pointer hover and focus
inside a toast pause its timer. The native test verifies actual document visibility and a
pointer transition to another element inside the plugin frame before asserting expiry;
it does not override timers or force SDK resume.

### Recovering unapplied visual drafts

Each successful visual operation saves a version-1 recovery record under FDO's local
user-data directory, in `live-ui-drafts/`. There is one atomically replaced file per
workspace, named with a hash of its identity. These files are separate from plugin
sources and workspace snapshots. Individual edits do not create snapshot history.
Files use private permissions where supported and never leave the machine through
this feature. They contain source code; they are not an encrypted backup.

Reopen the same workspace's Live UI after window closure, renderer reload or app
restart to see **Saved visual draft found**. Choose **Restore visual draft** to
rebuild the static preview, restore the last edited element and continue Undo/Redo.
Nothing is applied automatically. **Apply to workspace** still uses the existing
IDE ownership, current-revision checks, guide rules, validation and grouped snapshot
transaction. Successful Apply or explicit Discard removes the saved record.

Recovery requires the same eligible source-file contents and SDK metadata/authoring
fingerprint. Snapshot identity alone may change if source is identical. Changed
source, a different SDK or an unknown record version shows **Saved draft needs
attention**, disables Restore and leaves workspace files unchanged. The developer
can keep the record while resolving the mismatch or explicitly discard it. Automatic
rebase and schema migration are not implemented. Existing legacy `ui-flow` data is
not imported, assigned to a workspace or removed by this feature.

The host validates history ranges and both Undo/Redo branches before rebuilding
source mappings, patches and the preview. Serialized previews and patch summaries
are never reused. The existing 100-step/4 MB operation-content bound remains; truncated
history retains its checkpoint. Recovery records have a 10 MB disk bound, retain
the 2 MB eligible-source limit and cannot add files outside the base inventory.
Saved records are not executable backend sessions. Pending requests, simulation
results, controller state, viewport settings and selected tab/accordion item context
are not restored.

Storage failure leaves a usable in-memory draft and an explicit warning to apply
or keep Live UI open. A newer saved record from another window cannot be silently
overwritten or discarded by a stale window. Records are local to the workspace;
coordination/rebase of simultaneous AI and visual changes remains roadmap work.

Each rendered preview owns a fresh isolated iframe and token. Mock/local simulation
waits for that frame's verified bridge-ready handshake, including a readiness probe
after load. A late initial frame load cannot replace recovered markup. Highlighting
and collection reveals scroll the nearest preview container rather than the outer
editor page. Host-verified source-location mappings also preserve a newer explicit
element selection when an in-flight draft operation finishes; an ambiguous/removed
selection is cleared instead of guessing another target.

Implementation: `draftRecovery.js` owns serialization, validation and storage;
`liveUi.js` owns authorized recovery/discard IPC; `WorkspacePreview.jsx` presents
the recovery choice and persistence feedback. The new native regression is
`tests/e2e/live-ui-draft-recovery.spec.js`.

Verification: 627 unit/component checks across 41 suites passed on the final
sources. Production main/preload/renderer builds passed (renderer retains the
existing bundle-size warnings). Seven native macOS scenarios passed, covering
window close/reload/app restart, recovery/Undo/Redo/Apply, source conflicts,
workspace isolation and existing async/overlay/toast behavior. The async-action
and overlay scenarios then each passed three consecutive runs. The recovery
prompt screenshot was reviewed. Other operating systems remain CI validation.

### AI selection handoff verification (2026-10-16)

The first milestone 5 handoff is covered by source/range, revision, owner,
workspace, restore and active-request guards, plus composer focus and listener
cleanup checks. All 318 unit/component suites (3,723 tests) passed. Production
builds passed with the existing renderer size advisories. The native macOS
`live-ui-ai-selection.spec.js` passed using an isolated profile and a local
assistant fixture: the mapped range becomes selection context, the composer
retains its prompt and action, no inference request is sent, and a pending visual
draft blocks the handoff. The remaining milestone 5 acceptance work includes an
AI follow-up through validation/apply and its interaction with recovered drafts.

The final parser/style cleanup passed 55 targeted checks. Fresh WebStorm
inspections of the files responsible for the remaining reported findings returned
zero errors and warnings. Generated module/declaration strings are treated as
data; test draft transitions are explicit; unused editor helpers were removed.
Blueprint overrides match the library's exact runtime class tokens with attribute
selectors, preserving class-selector specificity without unused-class findings.
