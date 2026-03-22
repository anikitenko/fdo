## FDO Retrieval Benchmark

Run:

```bash
npm run test:fdo-benchmark
```

Purpose:

- keep FDO retrieval quality measurable
- catch regressions when prompts, scoring, scope rules, or corpus filters change

Current benchmark categories:

- settings help
- plugin architecture
- manifest/schema questions
- trust/security questions
- UI behavior
- code behavior questions

What the benchmark checks now:

- retrieval returns at least one result
- result metadata is present and scoped correctly
- expected source families appear in the top result set
- retrieval confidence is non-zero

What to look for:

- all benchmark cases pass
- Jest output includes `[FDOBenchmark] metrics`
- `emptyResults` stays at `0`
- `weakSourceMatches` stays at `0`

Recommended workflow:

1. Run `npm run test:router`
2. Run `npm run test:fdo-benchmark`
3. Only then manually spot-check chat behavior for any changed retrieval path
