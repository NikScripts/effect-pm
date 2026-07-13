---
"@nikscripts/effect-pm": minor
---

Add a single-`Layer` overload to `Resource.httpServer`. Serve one resource without wrapping it in an array:

```ts
Resource.httpServer(QueueResource.serve(Emails, { effect: sendEmail }))   // was: httpServer([ … ])
```

The array form is unchanged; a single `Layer` is treated as a one-element list.
