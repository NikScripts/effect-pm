import type { NwslSdpMockFixtures } from "./nwslsdp-mock-http";

const pickBody = (pathname: string, f: NwslSdpMockFixtures): unknown | undefined => {
  if (pathname.includes("/matchfacts")) return f.matchFacts;
  if (pathname.includes("/matchPreview")) return f.matchPreview;
  if (pathname.endsWith("/matches")) return f.matches;
  if (pathname.includes("/stats/teams/")) return f.teamStats;
  if (pathname.endsWith("/roster")) return f.roster;
  if (pathname.includes("/seasons/") && pathname.endsWith("/teams")) return f.teams;
  if (pathname.includes("/players/") && pathname.endsWith("/profile")) return f.playerProfile;
  return undefined;
};

const requestUrl = (input: RequestInfo | URL): string =>
  typeof input === "string"
    ? input
    : input instanceof Request
      ? input.url
      : String(input);

/** `globalThis.fetch` implementation for Vitest (`vi.stubGlobal`). */
export const createNwslSdpFetchMock = (fixtures: NwslSdpMockFixtures) => {
  const fn = async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    const url = new URL(requestUrl(input));
    const body = pickBody(url.pathname, fixtures);
    if (body === undefined) {
      return new Response(`unmocked NWSL SDP path: ${url.pathname}`, { status: 404 });
    }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return fn as typeof fetch;
};
