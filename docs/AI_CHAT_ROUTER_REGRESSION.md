## Router Regression Harness

Use this harness to catch routing regressions in multi-turn AI chat before shipping routing/tool-policy changes.

Run:

```bash
npm run test:router
```

What it covers now:

- direct weather question -> follow-up without repeated keywords
- domain switch after several follow-ups
- ambiguous follow-up continuity
- mixed-domain prompt with scoped multi-tool exposure
- FDO UI scope routing
- FDO code/dev scope routing
- broad unrelated question after an FDO conversation

What to look for:

- all cases pass
- Jest output includes `[RouterEval] metrics`
- `staleRouteErrors` stays at `0`
- `wrongToolActivations` stays at `0`

When to run it:

- after changing:
  - routing terms
  - semantic-router thresholds
  - scope detection
  - tool allowlists
  - follow-up inheritance logic

Manual spot checks after the automated harness:

1. In chat, ask `what is weather in Lutsk?`
2. Follow with `and now?`
3. Then ask `another question: what is Kubernetes?`
4. Confirm weather is preserved for the follow-up, then dropped for the topic switch.

1. In chat, ask `how do FDO plugins work?`
2. Follow with `what about this?`
3. Confirm it stays in FDO/plugins context.

1. In chat, ask `what is the weather in Kyiv and can you search the latest OpenAI news?`
2. Confirm the route is treated as mixed-domain rather than collapsing to one tool.
