/**
 * Serves project files over HTTP from the dev server.
 *
 * This is what makes a rendered page's *linked* files work. The native client
 * renders HTML in a WebView on the phone while the files live on this
 * machine, so `file://` cannot reach them and relative `href`/`src` have
 * nothing to resolve against. Served over HTTP they resolve normally — the
 * browser fetches `./style.css` relative to the document's own URL, exactly
 * as it would on any site.
 *
 * Scope is a single root directory, and every request is resolved to a real
 * path before it is honoured:
 *
 * - `..` segments are neutralized by resolving and then re-checking that the
 *   result is still inside the root.
 * - Symlinks are resolved with `realpath` and re-checked, so a link inside
 *   the root pointing at `~/.ssh` is refused rather than followed.
 * - Only GET/HEAD. This endpoint never writes.
 *
 * The root defaults to the current working directory and is overridden with
 * `AGENT_CONSOLE_FILES_ROOT` — point it at the folder holding the repos the
 * app browses.
 *
 * @internal
 */
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import type { Connect, Plugin } from "vite";

const MIME_BY_EXT: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

const PREFIX = "/files/";

/** Resolves a request path inside `root`, or undefined if it escapes.
 * Returns the realpath, so symlinks cannot be used to step outside. */
const resolveWithin = async (root: string, requestPath: string): Promise<string | undefined> => {
  const decoded = decodeURIComponent(requestPath);
  // A leading slash would make `resolve` ignore the root entirely.
  const candidate = resolve(root, decoded.replace(/^\/+/, ""));
  const withinBefore = relative(root, candidate);
  if (withinBefore.startsWith("..") || isAbsolute(withinBefore)) return undefined;

  const real = await realpath(candidate).catch(() => undefined);
  if (real === undefined) return undefined;

  const realRoot = await realpath(root).catch(() => root);
  const withinAfter = relative(realRoot, real);
  if (withinAfter.startsWith("..") || isAbsolute(withinAfter)) return undefined;

  return real;
};

export const filesPlugin = (): Plugin => {
  const root = resolve(process.env.AGENT_CONSOLE_FILES_ROOT ?? process.cwd());

  const handler: Connect.NextHandleFunction = (req, res, next) => {
    const url = req.url ?? "";
    if (!url.startsWith(PREFIX)) {
      next();
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.statusCode = 405;
      res.end("Method not allowed");
      return;
    }

    void (async () => {
      const requested = url.slice(PREFIX.length).split("?")[0].split("#")[0];
      const target = await resolveWithin(root, requested);
      if (target === undefined) {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }

      const info = await stat(target).catch(() => undefined);
      if (info === undefined) {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }

      // A directory serves its index.html if there is one, so a link to a
      // folder behaves the way it does on a static host.
      const file = info.isDirectory() ? await resolveWithin(root, join(requested, "index.html")) : target;
      if (file === undefined) {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }
      const fileInfo = info.isDirectory() ? await stat(file).catch(() => undefined) : info;
      if (fileInfo === undefined || !fileInfo.isFile()) {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }

      res.setHeader("Content-Type", MIME_BY_EXT[extname(file).toLowerCase()] ?? "application/octet-stream");
      res.setHeader("Content-Length", String(fileInfo.size));
      // Served from a dev server over a private network; caching a file the
      // agent may rewrite between renders causes stale pages.
      res.setHeader("Cache-Control", "no-store");

      if (req.method === "HEAD") {
        res.end();
        return;
      }
      createReadStream(file).pipe(res);
    })();
  };

  return {
    name: "agent-console-files",
    configureServer(server) {
      server.middlewares.use(handler);
      server.config.logger.info(`  ➜  files:   /files/* → ${root}`);
    },
  };
};
