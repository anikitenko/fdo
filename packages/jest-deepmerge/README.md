# Jest merge adapter

Jest 30's `jest-config` imports `deepmerge(target, source)` and
`deepmerge.all(array)` without custom options. This adapter provides those two
calls using `@fastify/deepmerge`, including array concatenation and enumerable
symbol keys. It is not a general implementation of deepmerge's custom options.

The root `@fdo/jest-deepmerge` development dependency and npm override replace
`deepmerge@4.3.1`, which has no published fix for
[GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4).
The adapter is declared under its own package name so dependency inspectors and
the lockfile identify the replacement implementation. Only Jest's transitive
import retains the `deepmerge` name. The dependency audit continues to include
development packages and fail on low-severity advisories.

Remove the adapter when Jest uses a fixed upstream dependency.
