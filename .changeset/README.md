# Changesets

See [changesets docs](https://github.com/changesets/changesets) for the tool itself.

## Hyperlink maintainers

- **Agents:** add a changeset when public API, behavior, or release notes change. Creating
  `.changeset/*.md` does **not** need owner approval; **`pnpm run version` and publish do.**
  After creating, paste the full file in owner chat (see [`AGENTS.md`](../AGENTS.md) and
  [`docs/handoffs/supervisor-protocol.md`](../docs/handoffs/supervisor-protocol.md)).
- Run **`pnpm run version`** (`changeset version`) so `package.json` and `CHANGELOG.md` update
  together — **owner approval before version/publish**. In **pre** (`beta`) mode that typically
  bumps `0.9.0-beta.n` on the current prerelease line.
- Publish: `pnpm run release` or `npm publish --tag beta` after `pnpm run build`, with npm auth.
- Release packaging notes: [`PUBLISHING.md`](../PUBLISHING.md).
