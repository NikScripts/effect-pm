/** Brand / demo host gate decisions (shared by middleware + production serve). */
export const PUBLIC_HOSTS: ReadonlySet<string>;
export const DEMO_HOST: string;
export const PUBLIC_ALLOW: ReadonlySet<string>;
export const publicRobots: string;
export const isLocalOrOriginPreview: (host: string) => boolean;
export const hostnameOf: (raw: string) => string;

export type PublicHostDecision =
  | { kind: "pass" }
  | { kind: "redirect"; location: string; status: number }
  | { kind: "robots"; body: string };

export const resolvePublicHostGate: (host: string, path: string) => PublicHostDecision;
