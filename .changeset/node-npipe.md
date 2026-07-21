---
"@nikscripts/effect-pm": minor
---

**Phase E — `Node.nPipe`:** Windows named-pipe sibling of `Node.unix` (same overload shapes, same `IpcSocket` kind). Mints `\\.\pipe\effect-pm-…` paths, defaults `unlink: false`, boots Lookup like unix. Non-Windows hosts fail with `NPipeRequiresWindows` (use `unix` on POSIX). Non-Ipc nodes fail with `NPipeListenRequiresIpc`. `ipcServer` remains the low-level escape hatch.
