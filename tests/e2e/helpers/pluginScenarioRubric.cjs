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
    nestedStyles: /&:(?:hover|focus|active|disabled)|(?:^|\n)\s{2,}(?:[.#]?[a-z][\w-]*(?:\[[^\]]+\])?(?::[\w-]+)?)\s*\{/im.test(stylesheetSource),
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

module.exports = {evaluateJsonInspectorScenario};
