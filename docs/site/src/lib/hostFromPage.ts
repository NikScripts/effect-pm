/**
 * Host-only Page → Waku createPage adapt (not a last-ts product export).
 * Re-exports the package-internal host bridge for this monorepo site.
 */
export {
  fromPage,
  type HostPage,
} from "../../../../packages/last-ts/src/internal/hostPage.ts";
