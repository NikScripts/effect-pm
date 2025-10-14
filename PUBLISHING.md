# Publishing Guide

## Publishing a New Version

### Prerequisites
- Ensure you're logged in to npm: `npm whoami`
- If not logged in: `npm login`
- Ensure all changes are committed

### Steps to Publish

#### 1. Create a Changeset (if not already created)

```bash
npm run changeset
# Follow prompts to describe changes
# Select: patch, minor, or major
```

#### 2. Version Bump

```bash
npm run version
```

This will:
- Consume all changesets in `.changeset/`
- Update version in `package.json`
- Generate/update `CHANGELOG.md`
- Create a version commit

#### 3. Build

```bash
npm run build
```

Verify the build completes successfully.

#### 4. Publish to npm

```bash
npm publish
```

Or use the all-in-one release script:

```bash
npm run release
```

#### 5. Push to GitHub

```bash
git push --follow-tags
```

This pushes both commits and version tags.

### Version History

- **v0.1.0** - Initial release
- **v0.1.1** - Bug fixes and type exports
- **v0.2.0** - API improvements
- **v0.3.0** - Breaking changes: API modernization (current)

### Changeset Types

- **patch** (0.0.x) - Bug fixes, docs, non-breaking changes
- **minor** (0.x.0) - New features, non-breaking additions
- **major** (x.0.0) - Breaking changes (before 1.0.0, this means significant API changes)

### Quick Reference

```bash
# Check current version
npm run version:check

# Dry run (test publish without actually publishing)
npm publish --dry-run

# View what will be published
npm pack --dry-run

# Check published package info
npm info @nikscripts/effect-pm
```

### Troubleshooting

**"Version already exists":**
- You forgot to run `npm run version` before publishing
- Run it now and try again

**"Not logged in":**
```bash
npm login
```

**Build fails:**
```bash
npm run clean
npm install
npm run build
```

**Want to unpublish (within 72 hours):**
```bash
npm unpublish @nikscripts/effect-pm@0.x.x
```
⚠️ Only use for serious issues, not recommended

