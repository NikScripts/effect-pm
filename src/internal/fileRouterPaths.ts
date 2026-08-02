/**
 * Re-export of last-ts file-router path helpers (hyp / tests).
 * Prefer `import { … } from "last-ts/vite"`.
 */
export {
  PathsMissingError,
  PathsStaleError,
  checkPaths,
  discover,
  emitPaths,
  formatPathsModule,
  nodeLayer,
  runSync,
  toFilePath,
  toRouteId,
  toRoutePath,
  writeAtomic,
  type EmitOptions,
  type FileEntry,
  type FileRouterServices,
} from "last-ts/vite";
