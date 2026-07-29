# UI Route — HttpApi-shaped + GroupRoute dynamic tools

## Split

| Module | Role |
|--------|------|
| `hyperlink-ts/ui/Route` | Toolkit — `make` / `group` / `get` / `match` / `urlBuilder` (like HttpApi / HttpApiGroup / HttpApiEndpoint) |
| `hyperlink-ts/ui/GroupRoute` | **Dynamic tools** — `from` + `gets` turn a Hyperlink Group into Route declarations |

Most dashboard routes come from **`GroupRoute.from`**, not hand-written `Route.get`s.

## HttpApi mapping

| Effect | Ours |
|--------|------|
| `HttpApi.make("id")` | `Route.make("id")` |
| `HttpApiGroup.make("id")` | `Route.group("id", { path? })` |
| `HttpApiEndpoint.get("id", "/path")` | `Route.get("id", "/path")` |
| `HttpApiClient.urlBuilder` | `Route.urlBuilder` |

Optional `path` on `Route.group` = navigable nest (UI-only; HttpApi groups have no path).

## Dynamic generation

```ts
GroupRoute.from(ServicesHub, {
  leaf: (g, ctx) => g.add(...GroupRoute.gets(ctx, "logs", "schedule")),
})
```

- `from` walks the Group and emits `Route.group({ path })` per member.
- `gets` emits ordinary `Route.get`s for leaf pages — **not** a `leafViews` string bag.
- `leaf` callback is where apps compose those gets (or any other Route builders).

## Example

```ts
const Dashboard = Route.make("dashboard").add(
  GroupRoute.from(ServicesHub, {
    leaf: (g, ctx) => g.add(...GroupRoute.gets(ctx, "logs", "schedule")),
  }),
  Route.group("shell", { topLevel: true }).add(
    Route.get("health", "/health"),
    Route.get("node", "/health/:nodeId").pipe(
      Route.params(Schema.Struct({ nodeId: Schema.String })),
    ),
  ),
)
```
