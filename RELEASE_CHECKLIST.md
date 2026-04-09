# Release Checklist for v0.3.0

## Pre-Release

- [x] All code changes complete
- [x] All tests passing (if applicable)
- [x] Build successful (`npm run build`)
- [x] Examples updated and verified
- [x] Documentation updated (README, JSDoc)
- [x] Breaking changes documented in changeset
- [x] Old setup guides removed

## Release Steps

### 1. Review Changes
```bash
git status
git diff
```

### 2. Commit All Changes
```bash
git add -A
git commit -m "chore: prepare for v0.3.0 release - complete API modernization"
```

### 3. Run Version
```bash
npm run version
```

This consumes the changeset and:
- Bumps version to 0.3.0 in package.json
- Updates CHANGELOG.md
- Commits the version changes

### 4. Build & Verify
```bash
npm run build
npm run type-check  # If available
```

### 5. Test Package
```bash
npm pack --dry-run
# Review what will be published
```

### 6. Publish to npm
```bash
npm publish
```

### 7. Push to GitHub
```bash
git push --follow-tags
```

### 8. Create GitHub Release (Optional)
1. Go to: https://github.com/nikscripts/effect-pm/releases
2. Click "Draft a new release"
3. Choose tag: v0.3.0
4. Title: "v0.3.0 - API Modernization"
5. Copy relevant sections from CHANGELOG.md
6. Publish release

## Post-Release Verification

- [ ] Check npm: https://www.npmjs.com/package/@nikscripts/effect-pm
- [ ] Verify version shows 0.3.0
- [ ] Test installation: `npm install @nikscripts/effect-pm@latest`
- [ ] GitHub release created (if applicable)

## What's in This Release

### Breaking Changes
- Complete API renaming to follow Effect conventions
- `QueueResource.make()` replaces `makeQueueService()`
- `Process.make()` replaces `createCronProcess()`
- `ProcessManager.make()` replaces `makeProcessManager()`
- `.layer` on factory-built tags replaces tuple returns
- Property renames across all configs

### Why v0.3.0?
This is a MAJOR version bump (in semver terms) because of breaking API changes. Since we're pre-1.0, we use the minor version for breaking changes (0.x.0).

### Why Now?
The package is brand new with no active users, so this is the perfect time to establish the right API patterns before the community adopts it.

