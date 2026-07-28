/**
 * Mock fleet for the View-compose vision prototype.
 * Shapes mirror what Dashboard already has — Group card, leaf cards, lineage, readiness.
 */

export type Kind = "group" | "queue" | "daemon" | "gate";

export type Member = {
  readonly id: string;
  readonly name: string;
  readonly kind: Kind;
  readonly ready: boolean;
  readonly detail?: string;
  /** Hyperlink lineage — steals LogContext shape, not the URL path. */
  readonly lineage: ReadonlyArray<string>;
  /** Ready-count sparkline (0–1), oldest → newest. */
  readonly spark: ReadonlyArray<number>;
  readonly children?: ReadonlyArray<Member>;
};

export type LogLine = {
  readonly t: string;
  readonly level: "INFO" | "WARN" | "ERROR";
  readonly msg: string;
  readonly lineage: ReadonlyArray<string>;
};

export const hub: Member = {
  id: "hub/ServicesHub",
  name: "ServicesHub",
  kind: "group",
  ready: true,
  lineage: ["hub/ServicesHub"],
  spark: [1, 1, 1, 1, 1, 1, 1, 1],
  children: [
    {
      id: "hub/Wnba",
      name: "Wnba",
      kind: "group",
      ready: false,
      detail: "2 degraded",
      lineage: ["hub/ServicesHub", "hub/Wnba"],
      spark: [1, 1, 0.7, 0.7, 0.5, 0.8, 0.8, 0.6],
      children: [
        {
          id: "wnba/BoxScoreQueue",
          name: "BoxScoreQueue",
          kind: "queue",
          ready: false,
          detail: "scores DB blip",
          lineage: ["hub/ServicesHub", "hub/Wnba", "wnba/BoxScoreQueue"],
          spark: [1, 1, 1, 0.4, 0.2, 0.6, 0.9, 0.3],
        },
        {
          id: "wnba/LiveScorePoller",
          name: "LiveScorePoller",
          kind: "daemon",
          ready: true,
          lineage: ["hub/ServicesHub", "hub/Wnba", "wnba/LiveScorePoller"],
          spark: [1, 1, 1, 1, 1, 1, 1, 1],
        },
        {
          id: "wnba/FetchGate",
          name: "FetchGate",
          kind: "gate",
          ready: true,
          lineage: ["hub/ServicesHub", "hub/Wnba", "wnba/FetchGate"],
          spark: [0.8, 0.9, 1, 1, 0.7, 1, 1, 1],
        },
        {
          id: "wnba/ImportJobs",
          name: "ImportJobs",
          kind: "queue",
          ready: true,
          lineage: ["hub/ServicesHub", "hub/Wnba", "wnba/ImportJobs"],
          spark: [1, 0.9, 1, 1, 1, 1, 1, 1],
        },
      ],
    },
    {
      id: "hub/Ops",
      name: "Ops",
      kind: "group",
      ready: true,
      lineage: ["hub/ServicesHub", "hub/Ops"],
      spark: [1, 1, 1, 1, 1, 1, 1, 1],
      children: [
        {
          id: "ops/DrainQueue",
          name: "DrainQueue",
          kind: "queue",
          ready: true,
          lineage: ["hub/ServicesHub", "hub/Ops", "ops/DrainQueue"],
          spark: [1, 1, 1, 1, 1, 1, 1, 1],
        },
      ],
    },
  ],
};

export const seedLogs: ReadonlyArray<LogLine> = [
  {
    t: "12:41:02",
    level: "INFO",
    msg: "importing box-21088",
    lineage: ["wnba/BoxScoreQueue"],
  },
  {
    t: "12:41:03",
    level: "WARN",
    msg: "scores DB blip — cascade degraded",
    lineage: ["wnba/ScoresDb", "wnba/BoxScoreQueue"],
  },
  {
    t: "12:41:04",
    level: "INFO",
    msg: "polling live scores",
    lineage: ["wnba/LiveScorePoller"],
  },
  {
    t: "12:41:05",
    level: "INFO",
    msg: "gate permit acquired",
    lineage: ["wnba/FetchGate"],
  },
  {
    t: "12:41:06",
    level: "ERROR",
    msg: "worker timeout after DB blip",
    lineage: ["wnba/BoxScoreQueue"],
  },
  {
    t: "12:41:07",
    level: "INFO",
    msg: "importing imp-54395",
    lineage: ["wnba/ImportJobs"],
  },
];

export const flatten = (m: Member): ReadonlyArray<Member> => [
  m,
  ...(m.children ?? []).flatMap(flatten),
];

export const findById = (root: Member, id: string): Member | undefined =>
  flatten(root).find((x) => x.id === id);
