---
"hyperlink-ts": minor
---

`Hyperlink.defaults` remaps Tag `Service` to include the piped bag (`remapTagService`), so `yield* Tag` types bag keys without a `WithDefaults` cast. Toolkit Tags keep named handles (`WorkPool` / `Gate`) under further `.pipe(defaults)`.
