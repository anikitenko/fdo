const {parse} = require("@babel/parser");

function sourceText(files) {
  return Object.entries(files).filter(([path]) => /\.[cm]?[jt]sx?$/.test(path)).map(([, content]) => String(content || "")).join("\n");
}

function parseFiles(files) {
  const errors = [];
  for (const [path, content] of Object.entries(files)) {
    if (!/\.[cm]?[jt]sx?$/.test(path)) continue;
    try { parse(String(content || ""), {sourceType: "module", plugins: ["typescript", "jsx"]}); }
    catch (error) { errors.push(`${path}: ${error.message}`); }
  }
  return errors;
}

function hasNestedCssRule(stylesheetSource) {
  return /&\s*(?::[\w-]+|\[[^\]]+\]|[.#][\w-]+|\s+[.#]?[a-z][\w-]*)[^{}]*\{/im.test(stylesheetSource)
    || /(?:^|\n)\s{2,}(?:[.#]?[a-z][\w-]*(?:\[[^\]]+\])?(?::[\w-]+)?)\s*\{/im.test(stylesheetSource)
    // CSS source may use standard descendant selectors instead of the CSS
    // nesting syntax. They express the same scoped component styling and are
    // supported by the iframe stylesheet pipeline.
    || /(?:^|\n)\s*[.#][\w-]+(?:\[[^\]]+\])?(?::[\w-]+)?\s+[.#]?[a-z][\w-]*(?:\[[^\]]+\])?(?::[\w-]+)?\s*\{/im.test(stylesheetSource);
}

function hasNamedInspectJsonHandlerResult(source) {
  const registeredByName = /registerHandler\s*\(\s*["']inspectJson["']\s*,\s*inspectJson\b/.test(source);
  const functionReturnsObject = /\b(?:export\s+)?(?:async\s+)?function\s+inspectJson\s*\([^)]*\)\s*(?::\s*[^\{]+)?\{[\s\S]{0,2500}?\breturn\s+\{/.test(source);
  const callbackReturnsObject = /\b(?:const|let)\s+inspectJson\s*=\s*(?:async\s*)?\([^)]*\)\s*(?::\s*[^=]+)?=>\s*\{[\s\S]{0,2500}?\breturn\s+\{/.test(source);
  const namedHandlerReturnsPayload = functionReturnsObject || callbackReturnsObject;
  if (!namedHandlerReturnsPayload) return false;

  // A lifecycle callback may adapt the direct content object and forward
  // data.json to the named helper. It still returns the helper's payload.
  const forwardsToNamedHandler = /registerHandler\s*\(\s*["']inspectJson["']\s*,\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{[\s\S]{0,700}?\breturn\s+inspectJson\s*\(/.test(source);
  return registeredByName || forwardsToNamedHandler;
}

function evaluateJsonInspectorScenario(files) {
  const source = sourceText(files);
  const tests = String(files["/render.test.ts"] || "");
  const stylesheets = Object.entries(files).filter(([path]) => /\.css$/i.test(path));
  const stylesheetSource = stylesheets.map(([, content]) => String(content || "")).join("\n");
  const violations = parseFiles(files);
  if (/(?:from\s+["'](?:electron|@anikitenko\/fdo-sdk\/)|require\(["'](?:electron|fs|node:fs|child_process))/i.test(source)) {
    violations.push("Uses a forbidden host or package-internal import.");
  }
  const checks = {
    pluginEntry: /extends\s+FDO_SDK/.test(source) && /new\s+\w+\s*\(\s*\)\s*;?/.test(source),
    // TypeScript plugin implementations commonly declare init(): void. Accept
    // both that form and an untyped init() while still requiring registration
    // within the lifecycle method.
    handlerInInit: /init\s*\([^)]*\)\s*(?::\s*[^\{]+)?\{[\s\S]*?registerHandler\s*\(\s*["']inspectJson["']/.test(source),
    // A handler may be registered inline or as a named function. Both are
    // supported by the SDK and the latter must not be treated as a failure.
    handlerReturnsResult: /registerHandler\s*\(\s*["']inspectJson["'][\s\S]{0,1500}?(?:return\s+\{|=>\s*\(\s*\{)/.test(source)
      || hasNamedInspectJsonHandlerResult(source),
    uiRequestsHandler: /createBackendReq\s*\([\s\S]{0,500}handler\s*:\s*["']inspectJson["']/.test(source),
    // The UI bridge unwraps {handler, content} before invoking the plugin
    // callback. Reject the common but non-functional data.content.json shape.
    backendReceivesContentDirectly: !/registerHandler\s*\(\s*["']inspectJson["'][\s\S]{0,2200}?\b(?:data|request|payload)\s*\??\.\s*content\s*\??\./.test(source)
      && !/(?:function\s+inspectJson|(?:const|let)\s+inspectJson\s*=)[\s\S]{0,1800}?\b(?:data|request|payload)\s*\??\.\s*content\s*\??\./.test(source)
      && !/(?:function\s+inspectJson|(?:const|let)\s+inspectJson\s*=|registerHandler\s*\(\s*["']inspectJson["'])[\s\S]{0,700}?\(\s*\{\s*content\b/.test(source),
    jsonValidation: /JSON\.parse\s*\(/.test(source),
    validationKeepsBridgeSuccessful: !/\b(?:ok|success)\s*:\s*false\b/.test(source)
      && /\b(?:valid\s*:\s*false|status\s*:\s*["']validation-error["'])/.test(source),
    inputAndAction: /(?:textarea|DOMInput|createElement\s*\(\s*["']textarea)/i.test(source) && /inspect-json|inspect json/i.test(source),
    visibleResult: /result|status|summary/i.test(source),
    pureCssFoundation: /\bpure-form\b/.test(source)
      && /\bpure-form-stacked\b/.test(source)
      && /\bpure-button\b/.test(source)
      && /\bpure-button-primary\b/.test(source),
    stylesheet: stylesheets.length > 0 && /import\s+\w+\s+from\s+["'][^"']+\.css["']/.test(source),
    styleMapRendered: !/\bDOM\.createClassFromStyle\s*\(/.test(source)
      && /(?:new\s+DOM\s*\(\s*\)\s*\.createClassFromStyle|\b\w+\.createClassFromStyle\s*\()/.test(source)
      && /renderHTML\s*\(/.test(source),
    styleMapEntriesRendered: ["panel", "input", "action", "result"].every((key) => (
      new RegExp(`createClassFromStyle\\s*\\(\\s*\\w+\\s*(?:\\.\\s*${key}\\b|\\[\\s*["']${key}["']\\s*\\])\\s*\\)`).test(source)
    )),
    styleMapUsesClassKeys: !/\[\s*["']\.[\w-]+["']\s*\]/.test(source)
      && ["panel", "input", "action", "result"].every((key) => (
        new RegExp(`(?:\\.\\s*${key}\\b|\\[\\s*["']${key}["']\\s*\\])`).test(source)
      )),
    polishedLayout: /\.panel\s*\{[\s\S]*?(?:max-width|width)\s*:/.test(stylesheetSource)
      && /\.panel\s*\{[\s\S]*?padding\s*:/.test(stylesheetSource)
      && /\.panel\s*\{[\s\S]*?border-radius\s*:/.test(stylesheetSource)
      && /\.panel\s*\{[\s\S]*?(?:box-shadow|border)\s*:/.test(stylesheetSource)
      && /\.input\s*\{[\s\S]*?width\s*:\s*100%/.test(stylesheetSource)
      && /\.input\s*\{[\s\S]*?min-height\s*:/.test(stylesheetSource),
    // The stylesheet transform supports nested pseudo rules and nested
    // descendant/class rules. A visual brief may legitimately use either.
    nestedStyles: hasNestedCssRule(stylesheetSource),
    keyframes: /@keyframes\s+[\w-]+/.test(stylesheetSource),
    reducedMotion: /prefers-reduced-motion/i.test(stylesheetSource),
    // defineRenderOnLoadActions generates its on-load source from declarative
    // handlers/bindings (and optional setup). An `onLoad` option is ignored by
    // that SDK helper, so it must not be used as a substitute for CSS behavior.
    supportedRenderOnLoadOptions: !/defineRenderOnLoadActions\s*\(\s*\{[\s\S]{0,500}\bonLoad\s*:/m.test(source),
    noUnsupportedJsx: !/\brenderHTML\s*\(\s*<\s*[A-Za-z][\w.-]*(?=[\s>])[\s\S]{0,500}\b(?:className|htmlFor)\s*=/m.test(source),
    noStaticDomCreateElement: !/\bDOM\.createElement\s*\(/.test(source),
    noMisusedDomHelperConstructors: !/\bnew\s+DOMNested\s*\(\s*\[|\bnew\s+DOMText\s*\(\s*["'`]/.test(source),
    declarativeClickBinding: /defineRenderOnLoadActions\s*\(/.test(source)
      && /selector\s*:[\s\S]{0,120}inspect-json/.test(source)
      && /event\s*:\s*["']click["']/.test(source),
    declarativeActionButton: /\btype\s*[:=]\s*["']button["']/.test(source),
    // `data-bound` is used by the plugin host for its own declarative
    // bindings. A generated manual listener must use a plugin-specific marker.
    reservedHostBindingMarker: !/(?:\bdataset\s*\.\s*bound\b|["'`]data-bound["'`])/.test(source),
    nodeTests: /from\s+["']node:test["']/.test(tests) && /from\s+["']node:assert\/strict["']/.test(tests) && (tests.match(/\btest\s*\(/g) || []).length >= 2,
    noJestGlobals: !/\bexpect\s*\(/.test(tests),
  };
  return {checks, violations, passed: Object.values(checks).every(Boolean) && violations.length === 0};
}

function evaluateRoseCalculatorScenario(files) {
  const source = sourceText(files);
  const tests = String(files["/render.test.ts"] || "");
  const stylesheets = Object.entries(files).filter(([path]) => /\.css$/i.test(path));
  const stylesheetSource = stylesheets.map(([, content]) => String(content || "")).join("\n");
  const catRule = stylesheetSource.match(/\.cat\s*\{([\s\S]{0,900}?)\}/i)?.[1] || "";
  const violations = parseFiles(files);
  if (/(?:from\s+["'](?:electron|@anikitenko\/fdo-sdk\/)|require\(["'](?:electron|fs|node:fs|child_process))/i.test(source)) {
    violations.push("Uses a forbidden host or package-internal import.");
  }
  const actionRoles = [
    "calculator-equals",
    "calculator-clear",
    "calculator-quick-double",
    "calculator-quick-half",
    "calculator-quick-add-ten",
    "calculator-sidebar-history",
    "calculator-sidebar-theme",
  ];
  const catPartRoles = [
    "calculator-cat-head",
    "calculator-cat-ear-left",
    "calculator-cat-ear-right",
    "calculator-cat-eye-left",
    "calculator-cat-eye-right",
    "calculator-cat-tail",
  ];
  const catStyleMapKeys = ["cat", "catHead", "catEar", "catEye", "catTail"];
  const hasRole = (role) => new RegExp(`data-role\\s*["']?\\s*[:=]\\s*["']${role}["']|data-role=["']${role}["']`).test(source);
  // A renderer may keep button markup DRY with a local helper such as
  // button("calculator-clear", "Clear"). That is still concrete markup:
  // the action role is present at render time and the browser checks below
  // exercise every resulting control after deployment.
  const hasActionMarkup = (role) => hasRole(role)
    || new RegExp(`\\b(?:button|actionButton|createActionButton)\\s*\\(\\s*["']${role}["']`).test(source);
  const hasDeclarativeBinding = (role) => new RegExp(`selector\\s*:[\\s\\S]{0,140}${role}[\\s\\S]{0,180}event\\s*:\\s*["']click["']`, "i").test(source);
  const usesRoleMappedBindings = /bindings\s*:\s*\[[\s\S]{0,2400}\]\s*\.map\s*\(\s*\(\s*\[\s*handler\s*,\s*role\s*\]\s*\)\s*=>\s*\(\s*\{[\s\S]{0,480}selector\s*:\s*`[^`]*\$\{\s*role\s*\}[^`]*`[\s\S]{0,180}event\s*:\s*["']click["']/.test(source);
  const usesTypeButtonHelper = /(?:const|let)\s+\w*button\w*\s*=\s*\([^)]*\)\s*=>[\s\S]{0,500}createElement\s*\(\s*["']button["']\s*,\s*\{[\s\S]{0,300}\btype\s*:\s*["']button["']/.test(source);
  const checks = {
    pluginEntry: /extends\s+FDO_SDK/.test(source) && /new\s+\w+\s*\(\s*\)\s*;?/.test(source),
    title: /Rose Calculator/i.test(source),
    verifiedMetadataIcon: /\bicon\s*:\s*["']calculator["']/.test(source),
    calculatorMarkup: ["calculator-shell", "calculator-display", "calculator-result", "calculator-quick-actions", "calculator-sidebar"]
      .every(hasRole),
    decorativeCat: hasRole("calculator-cat")
      && catPartRoles.every(hasRole)
      && catStyleMapKeys.every((key) => new RegExp(`createClassFromStyle\\s*\\(\\s*\\w+\\s*\\.\\s*${key}\\b`).test(source)),
    actionMarkup: actionRoles.every(hasActionMarkup),
    editableDisplay: /(?:input|textarea|createElement\s*\(\s*["'](?:input|textarea)["'])/i.test(source)
      && hasRole("calculator-display")
      && !/data-role=["']calculator-display["'][^>]{0,250}\breadonly\b/i.test(source),
    declarativeActions: /defineRenderOnLoadActions\s*\(/.test(source)
      && (actionRoles.every(hasDeclarativeBinding)
        || (usesRoleMappedBindings && actionRoles.every((role) => source.includes(`"${role}"`) || source.includes(`'${role}'`)))),
    typeButtonActions: actionRoles.every((role) => new RegExp(`(?:type\\s*[:=]\\s*["']button["'][\\s\\S]{0,300}${role}|${role}[\\s\\S]{0,300}type\\s*[:=]\\s*["']button["'])`, "i").test(source))
      || (usesTypeButtonHelper && actionRoles.every(hasActionMarkup)),
    noUnsafeEvaluation: !/\beval\s*\(|\bnew\s+Function\s*\(/.test(source),
    noReservedHostBindingMarker: !/(?:\bdataset\s*\.\s*bound\b|["'`]data-bound["'`])/.test(source),
    pureCssFoundation: /\bpure-form\b/.test(source)
      && /\bpure-form-stacked\b/.test(source)
      && /\bpure-button\b/.test(source)
      && /\bpure-button-primary\b/.test(source),
    stylesheet: stylesheets.length > 0 && /import\s+\w+\s+from\s+["'][^"']+\.css["']/.test(source),
    styleMapRendered: !/\bDOM\.createClassFromStyle\s*\(/.test(source)
      && /\b\w+\.createClassFromStyle\s*\(/.test(source)
      && /renderHTML\s*\(/.test(source),
    catStyles: /position\s*:\s*fixed/i.test(catRule)
      && /inset\s*:\s*0(?:\s|;|$)/i.test(catRule)
      && /pointer-events\s*:\s*none/i.test(catRule)
      && /opacity\s*:\s*0?\.(?:[3-7]\d?)/i.test(catRule),
    roseGridLayout: /grid-template-columns\s*:/.test(stylesheetSource)
      && /@media[\s\S]{0,600}(?:grid-template-columns\s*:\s*1fr|grid-template-columns\s*:\s*none)/.test(stylesheetSource)
      && /(?:rose|berry|plum|#(?:[89a-f][0-9a-f]{2}|[cd][0-9a-f]{2})[0-9a-f]{3,5})/i.test(stylesheetSource),
    polishedShell: /(?:\.shell|\.calculator-shell)\s*\{[\s\S]{0,1000}?(?:padding\s*:|padding-top\s*:)/.test(stylesheetSource)
      && /(?:\.shell|\.calculator-shell)\s*\{[\s\S]{0,1000}?border-radius\s*:/.test(stylesheetSource)
      && /(?:\.shell|\.calculator-shell)\s*\{[\s\S]{0,1000}?(?:box-shadow|border)\s*:/.test(stylesheetSource),
    nestedStyles: hasNestedCssRule(stylesheetSource),
    keyframes: /@keyframes\s+[\w-]+/.test(stylesheetSource),
    reducedMotion: /prefers-reduced-motion/i.test(stylesheetSource) && /animation\s*:\s*none/i.test(stylesheetSource),
    nodeTests: /from\s+["']node:test["']/.test(tests)
      && /from\s+["']node:assert\/strict["']/.test(tests)
      && (tests.match(/\btest\s*\(/g) || []).length >= 2,
    noJestGlobals: !/\bexpect\s*\(/.test(tests),
  };
  return {checks, violations, passed: Object.values(checks).every(Boolean) && violations.length === 0};
}

function evaluateWebToolsWorkbenchScenario(files) {
  // Test assertions are not evidence that a control exists in the implementation.
  const source = sourceText(Object.fromEntries(Object.entries(files).filter(([path]) =>
    !/(?:^|\/)__tests__\/|\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path),
  )));
  const tests = sourceText(Object.fromEntries(Object.entries(files).filter(([path]) =>
    /(?:^|\/)__tests__\/|\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path),
  )));
  const stylesheets = Object.entries(files).filter(([path]) => /\.css$/i.test(path));
  const stylesheetSource = stylesheets.map(([, content]) => String(content || "")).join("\n");
  const violations = parseFiles(files);
  if (/(?:from\s+["'](?:electron|@anikitenko\/fdo-sdk\/)|require\(["'](?:electron|fs|node:fs|child_process))/i.test(source)) {
    violations.push("Uses a forbidden host or package-internal import.");
  }
  const roles = [
    "tool-workbench", "tool-brand", "tool-dashboard", "tool-library-button", "tool-space-button",
    "tool-card-json", "tool-library", "tool-search", "tool-open-json",
    "tool-library-close", "tool-workspace", "tool-back-dashboard", "tool-json-input",
    "tool-format-json", "tool-json-result", "tool-space-dialog", "tool-space-close",
    "tool-card-text", "tool-card-data", "tool-card-seo", "tool-card-images", "tool-card-social",
    "tool-category-workspace", "tool-category-input", "tool-category-action",
    "tool-category-result", "tool-category-back",
  ];
  const actionRoles = [
    "tool-library-button", "tool-space-button", "tool-card-json", "tool-open-json", "tool-library-close",
    "tool-back-dashboard", "tool-format-json", "tool-space-close",
    "tool-card-text", "tool-card-data", "tool-card-seo", "tool-card-images", "tool-card-social",
    "tool-category-action", "tool-category-back",
  ];
  // Card roles may be passed to a renderer helper instead of appearing in
  // literal attribute markup.
  const hasDynamicRoleMarkup = /["']data-role["']\s*:\s*[A-Za-z_$][\w$]*/.test(source);
  const dynamicCategoryCardKeys = new Set(
    Array.from(source.matchAll(/\bcategoryCard\s*\(\s*["']([a-z]+)["']/g), (match) => match[1]),
  );
  const hasDynamicCategoryCardMarkup = /["']data-role["']\s*:\s*`tool-card-\$\{\s*\w+\s*\}`/.test(source);
  const hasRole = (role) => new RegExp(
    `data-role\\s*["']?\\s*[:=]\\s*["']${role}["']|data-role=["']${role}["']`
      + `|\\b(?:tile|button|actionButton|createActionButton)\\s*\\([\\s\\S]{0,180}["']${role}["']`,
  ).test(source)
    // A category renderer may use a role field from a local tuple/object,
    // then pass that field to the DOM helper. The role remains concrete in
    // the generated markup even though its attribute is not a string literal.
    || (hasDynamicRoleMarkup && (source.includes(`"${role}"`) || source.includes(`'${role}'`)))
    // categoryCard("text", ...) with data-role: `tool-card-${key}` produces
    // deterministic, separately rendered card roles. Deployment interactions
    // below still click every resulting element.
    || (hasDynamicCategoryCardMarkup
      && role.startsWith("tool-card-")
      && dynamicCategoryCardKeys.has(role.slice("tool-card-".length)));
  const hasBinding = (role) => new RegExp(`selector\\s*:[\\s\\S]{0,160}${role}[\\s\\S]{0,200}event\\s*:\\s*["']click["']`, "i").test(source);
  const hasMappedBinding = (role) => source.includes(`"${role}"`)
    || source.includes(`'${role}'`);
  const hasActionMarkup = (role) => hasRole(role)
    || new RegExp(`\\b(?:button|actionButton|createActionButton)\\s*\\(\\s*["']${role}["']`).test(source);
  // A modular workspace may keep the binding table in its own module and pass
  // it to defineRenderOnLoadActions by identifier, and repeated category
  // bindings may be generated from a literal key list. Neither form places the
  // click entries next to the `bindings:` option, so match them independently.
  const hasDeclarativeClickBindings = /\bbindings\s*:/.test(source)
    && /selector\s*:[\s\S]{0,200}event\s*:\s*["']click["']/.test(source);
  const missingRoles = roles.filter((role) => !hasRole(role));
  const missingActionRoles = actionRoles.filter((role) => !hasActionMarkup(role));
  const styleKeys = ["shell", "dashboard", "card", "library", "workspace", "result", "dock"];
  const usesStyleMapHelper = /createClassFromStyle\s*\([\s\S]{0,160}?\[\s*\w+\s*\]/.test(source);
  // A generated renderer may keep style-map application DRY with a wrapper
  // such as `const style = value => dom.createClassFromStyle(value)`. Verify
  // that exact wrapper is then used with every required css entry.
  const styleHelperName = source.match(/(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*\([^)]*\)\s*=>\s*(?:\{\s*return\s+)?\w+\.createClassFromStyle\s*\(/)?.[1] || "";
  const usesDirectStyleValueHelper = styleHelperName && styleKeys.every((key) => new RegExp(
    `\\b${styleHelperName}\\s*\\(\\s*\\w+\\s*\\.\\s*${key}\\b`,
  ).test(source));
  const styleMapKeysRendered = styleKeys.every((key) => (
    new RegExp(`createClassFromStyle\\s*\\(\\s*\\w+\\s*(?:\\.\\s*${key}\\b|\\[\\s*["']${key}["']\\s*\\])`).test(source)
    || (usesStyleMapHelper && new RegExp(`\\b${key}\\b`).test(source))
    || usesDirectStyleValueHelper
  ));
  const hasDesktopDashboardLayout = /(?:\.dashboard|\.categories|\.tools)\s*\{[\s\S]{0,900}grid-template-columns\s*:/.test(stylesheetSource)
    || (/\.dashboard\s*\{[\s\S]{0,900}(?:display\s*:\s*flex|flex-wrap\s*:\s*wrap)/.test(stylesheetSource)
      && /\.card\s*\{[\s\S]{0,900}width\s*:\s*calc\(\s*50%/.test(stylesheetSource))
    || /(?:\.dashboard|\.categories|\.tools|\.pure-g)\b[\s\S]{0,900}(?:gap\s*:|display\s*:\s*(?:grid|flex))/.test(stylesheetSource);
  const hasResponsiveDashboardLayout = /@media[\s\S]{0,900}grid-template-columns\s*:\s*1fr/.test(stylesheetSource)
    || /@media[\s\S]{0,1200}\.card\s*\{[\s\S]{0,500}width\s*:\s*100%/.test(stylesheetSource);
  const checks = {
    // Current SDK examples use FDOPlugin; older supported examples use
    // FDO_SDK. Some valid SDK workspaces expose the same lifecycle directly
    // from a plugin class and export its instantiated object.
    pluginEntry: (
      /extends\s+(?:FDO_SDK|FDOPlugin)\b/.test(source)
      || (/class\s+\w*Plugin\w*\b/.test(source)
        && /\binit\s*\(\s*\)\s*(?::\s*\w+)?\s*\{/.test(source)
        && /\brender\s*\(\s*\)\s*:\s*string\s*\{/.test(source)
        && /\brenderOnLoad\s*\(\s*\)\s*\{/.test(source))
    ) && /new\s+\w+\s*\(\s*\)/.test(source),
    title: /Web Tools Workbench/i.test(source),
    verifiedMetadataIcon: /\bicon\s*:\s*["']applications["']/.test(source),
    workbenchMarkup: missingRoles.length === 0,
    actionMarkup: missingActionRoles.length === 0,
    declarativeActions: /defineRenderOnLoadActions\s*\(/.test(source)
      && (actionRoles.every(hasBinding)
        || (hasDeclarativeClickBindings && actionRoles.every(hasMappedBinding))),
    localJsonFormatting: /JSON\.parse\s*\(/.test(source) && /JSON\.stringify\s*\([^,]+,\s*null\s*,\s*2\s*\)/.test(source),
    visibleStates: /data-state\s*["']?\s*[:=]\s*["']closed["']/.test(source)
      // "idle" is a valid initial formatter state; "empty" remains supported.
      && /data-state\s*["']?\s*[:=]\s*["'](?:empty|idle)["']/.test(source)
      && /(?:success|error)/.test(source),
    noUnsafeEvaluation: !/\beval\s*\(|\bnew\s+Function\s*\(/.test(source),
    noReservedHostBindingMarker: !/(?:\bdataset\s*\.\s*bound\b|["'`]data-bound["'`])/.test(source),
    pureCssFoundation: /\bpure-form\b/.test(source) && /\bpure-form-stacked\b/.test(source)
      && /\bpure-button\b/.test(source) && /\bpure-button-primary\b/.test(source),
    stylesheet: stylesheets.length > 0 && /import\s+\w+\s+from\s+["'][^"']+\.css["']/.test(source),
    styleMapRendered: !/\bDOM\.createClassFromStyle\s*\(/.test(source)
      && styleMapKeysRendered
      && /renderHTML\s*\(/.test(source),
    polishedWorkbench: /(?:\.shell|\.workbench)\s*\{[\s\S]{0,1200}background\s*:/.test(stylesheetSource)
      && /(?:\.shell|\.workbench)\s*\{[\s\S]{0,1200}(?:min-height|height)\s*:/.test(stylesheetSource)
      && hasDesktopDashboardLayout
      && /\.dock\s*\{[\s\S]{0,800}(?:position\s*:\s*(?:sticky|fixed)|border)/.test(stylesheetSource),
    responsiveLayout: hasResponsiveDashboardLayout,
    nestedStyles: hasNestedCssRule(stylesheetSource),
    keyframes: /@keyframes\s+[\w-]+/.test(stylesheetSource),
    reducedMotion: /prefers-reduced-motion/i.test(stylesheetSource) && /animation\s*:\s*none/i.test(stylesheetSource),
    nodeTests: /from\s+["']node:test["']/.test(tests) && /from\s+["']node:assert\/strict["']/.test(tests)
      && (tests.match(/\btest\s*\(/g) || []).length >= 2,
    noJestGlobals: !/\bexpect\s*\(/.test(tests),
  };
  return {checks, violations, missingRoles, missingActionRoles, passed: Object.values(checks).every(Boolean) && violations.length === 0};
}

module.exports = {evaluateJsonInspectorScenario, evaluateRoseCalculatorScenario, evaluateWebToolsWorkbenchScenario};
