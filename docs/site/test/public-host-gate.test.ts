import { describe, expect, it } from "@effect/vitest";
import { resolvePublicHostGate } from "../src/lib/publicHostGate.mjs";

describe("resolvePublicHostGate", () => {
  it("passes localhost and DO origin preview", () => {
    expect(resolvePublicHostGate("localhost", "/docs/index").kind).toBe("pass");
    expect(resolvePublicHostGate("127.0.0.1", "/api").kind).toBe("pass");
    expect(resolvePublicHostGate("hyperlink-docs-ekhme.ondigitalocean.app", "/docs").kind).toBe(
      "pass",
    );
  });

  it("redirects demo host / into the book", () => {
    expect(resolvePublicHostGate("dev.hyperlink.cool", "/")).toEqual({
      kind: "redirect",
      location: "/docs/index",
      status: 302,
    });
    expect(resolvePublicHostGate("dev.hyperlink.cool", "/docs/install").kind).toBe("pass");
  });

  it("keeps brand host coming-soon allowlist + assets", () => {
    for (const path of ["/", "/favicon.svg", "/og.svg", "/healthz", "/assets/_layout-x.css"]) {
      expect(resolvePublicHostGate("hyperlink.cool", path).kind).toBe("pass");
      expect(resolvePublicHostGate("www.hyperlink.cool", path).kind).toBe("pass");
    }
  });

  it("serves brand robots and redirects docs surface", () => {
    const robots = resolvePublicHostGate("hyperlink.cool", "/robots.txt");
    expect(robots.kind).toBe("robots");
    if (robots.kind === "robots") {
      expect(robots.body).toContain("Disallow: /docs");
      expect(robots.body).toContain("dev.hyperlink.cool");
    }
    expect(resolvePublicHostGate("hyperlink.cool", "/docs/index")).toEqual({
      kind: "redirect",
      location: "/",
      status: 302,
    });
    expect(resolvePublicHostGate("hyperlink.cool", "/api/hyperlink-ts").kind).toBe("redirect");
    expect(resolvePublicHostGate("hyperlink.cool", "/search").kind).toBe("redirect");
  });
});
