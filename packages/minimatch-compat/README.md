# Legacy minimatch consumers

The patched matcher is minimatch 11.0.3. `dir-compare` and `filelist` still use the
callable CommonJS API from minimatch 3/5.
A global major-version override alone breaks archive creation or file filtering.

This private adapter forwards the callable API, supported helpers and default options
to the patched upstream engine. It contains no pattern-matching implementation and
does not bypass audit findings. The aliased dependency prevents the root
override from recursively replacing the adapter's own engine. Explicit CommonJS
named exports keep ESM imports working in Node, bundlers and Jest as well.

The root override deduplicates modern and legacy consumers onto this adapter.
Declare the direct dependency as `@fdo/minimatch-compat`, matching this package's
actual identity, and reference it through `overrides.minimatch`. Declaring it as
`minimatch: file:...` makes some dependency scanners mistake the adapter's `1.0.0`
version for the obsolete upstream minimatch 1.0.0. The separate `minimatch-patched`
dependency records the upstream package name, version and integrity in the lockfile
so security tools can audit the actual engine. Do not suppress advisories or change
the adapter's version to impersonate an upstream release.

Remove the adapter once all consumers use a patched matcher with the modern API.
The packaging compatibility tests cover archive creation/unpacking, directory
filtering, file lists and builder patterns.

All packaging consumers also use the project's declared `@electron/asar` release.
The older ASAR 3 walker promisifies glob's obsolete callback API and cannot complete
with modern glob. ASAR 4 uses the supported Promise API. Its Node requirement is
covered by the project's Node 24 minimum.

Advisory: https://github.com/advisories/GHSA-g3hv-75wg-m249
