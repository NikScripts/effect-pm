---
"@nikscripts/effect-pm": minor
---

Adds signed command authentication for `ControlService` and `ProcessManager`.

Introduces the public `CommandAuth` module, Ed25519 key records, canonical
command payload signing, replay protection, strict authenticated `POST /control`
handling, signed `GetHealth`, admin key generation, and ProcessManager public-key
enrollment helpers.
