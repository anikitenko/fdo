# Technical Debt Report: Deprecated NPM Packages

**Generated**: 2025-10-28  
**Status**: 9 deprecated packages detected (all transitive dependencies)

---

## Summary

During `npm install`, 9 unique deprecated packages are reported. **None of these are direct dependencies** - they are all transitive dependencies (dependencies of our dependencies). We have updated all direct dependencies to their latest compatible minor versions.

---

## Deprecated Packages Without Direct Control

### 1. inflight@1.0.6
**Deprecation Reason**: "This module is not supported, and leaks memory. Do not use it. Check out lru-cache if you want a good and tested way to coalesce async requests by a key value."

**Used By**: Multiple packages in dependency tree (primarily older fs-related utilities)

**Replacement Available**: Yes - `lru-cache` (but requires parent packages to update)

**Monitoring Plan**:
- Monitor npm advisories monthly for security issues
- Watch for updates to parent packages that remove this dependency
- Can be overridden via npm `overrides` field if critical

---

### 2. glob@7.2.3 and glob@8.1.0
**Deprecation Reason**: "Glob versions prior to v9 are no longer supported"

**Used By**: 
- `@vercel/webpack-asset-relocator-loader@1.10.0`
- `source-map-explorer@2.5.3`
- Various build tools

**Replacement Available**: Yes - glob@9+ (but parent packages haven't updated)

**Monitoring Plan**:
- Wait for @vercel/webpack-asset-relocator-loader to update
- Consider removing source-map-explorer if not actively used
- Can override to glob@11 using npm `overrides`

---

### 3. rimraf@2.6.3 and rimraf@3.0.2
**Deprecation Reason**: "Rimraf versions prior to v4 are no longer supported"

**Used By**: Multiple packages in build chain

**Replacement Available**: Yes - rimraf@4+ (but parent packages haven't updated)

**Monitoring Plan**:
- Monitor for security vulnerabilities
- Can override to rimraf@6 using npm `overrides`

---

### 4. npmlog@6.0.2
**Deprecation Reason**: "This package is no longer supported."

**Used By**: Build tools and package managers

**Replacement Available**: Unclear - functionality may be absorbed into other packages

**Monitoring Plan**:
- Monitor for security issues
- Wait for parent packages to migrate away

---

### 5. are-we-there-yet@3.0.1
**Deprecation Reason**: "This package is no longer supported."

**Used By**: npmlog and related progress indicators

**Replacement Available**: Functionality absorbed into other packages

**Monitoring Plan**:
- Will be resolved when npmlog is replaced by parent packages

---

### 6. gauge@4.0.4
**Deprecation Reason**: "This package is no longer supported."

**Used By**: npmlog and related progress indicators

**Replacement Available**: Functionality absorbed into other packages

**Monitoring Plan**:
- Will be resolved when npmlog is replaced by parent packages

---

### 7. @npmcli/move-file@2.0.1
**Deprecation Reason**: "This functionality has been moved to @npmcli/fs"

**Used By**: npm-related build tools

**Replacement Available**: Yes - @npmcli/fs

**Monitoring Plan**:
- Wait for parent packages to update
- Low risk as npm team maintains both

---

### 8. sourcemap-codec@1.4.8
**Deprecation Reason**: "Please use @jridgewell/sourcemap-codec instead"

**Used By**: Build tools and bundlers

**Replacement Available**: Yes - @jridgewell/sourcemap-codec

**Monitoring Plan**:
- Can override using npm `overrides`
- Wait for webpack/rollup ecosystem to update

---

### 9. boolean@3.2.0
**Deprecation Reason**: "Package no longer supported. Contact Support at https://www.npmjs.com/support for more info."

**Used By**: Unknown package in dependency tree

**Replacement Available**: Unclear

**Monitoring Plan**:
- Trace exact usage with `npm ls boolean`
- Consider override if causing issues

---

## Recommended Actions

### Immediate (Low Effort, High Impact)
1. ✅ **Updated all direct dependencies** to latest compatible minor versions (completed)
2. ⏳ **Add npm overrides** to force newer versions of critical deprecated packages
3. ⏳ **Remove unused dependencies** (e.g., source-map-explorer if not used)

### Short-term (1-3 months)
1. Monitor for updates to:
   - @vercel/webpack-asset-relocator-loader
   - electron-builder
   - Other build tools
2. Re-run package updates monthly to catch parent package updates

### Long-term (3-6 months)
1. If critical security issues arise, consider:
   - Forking and updating problematic packages
   - Finding alternative build tools
   - Contributing PRs to parent packages to update their dependencies

---

## Risk Assessment

**Current Risk Level**: ✅ **LOW**

- All deprecated packages are transitive dependencies
- No known security vulnerabilities in these specific versions
- Parent packages (electron, webpack, etc.) are actively maintained
- npm ecosystem is slowly migrating away from these packages

**Security Monitoring**:
- Run `npm audit` regularly (currently: 2 moderate vulnerabilities)
- Subscribe to npm security advisories
- Monitor GitHub Dependabot alerts

---

## Update History

| Date | Action | Result |
|------|--------|--------|
| 2025-10-28 | Updated 30 direct dependencies to latest minor versions | Reduced dependency count by 2 packages |
| 2025-10-28 | Documented 9 deprecated transitive dependencies | Created this technical debt report |

---

## Next Review Date

**2025-11-28** (1 month from creation)

---

**Note**: This is expected technical debt in the JavaScript ecosystem. Most deprecated warnings will resolve naturally as the npm ecosystem updates. We will continue monitoring and updating dependencies monthly.

