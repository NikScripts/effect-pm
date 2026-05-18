import { describe, expect, it } from "@effect/vitest";
import {
  normalizeProcessManagerTarget,
  resolveProcessManagerTarget,
  type ProcessManagerTargetCandidate,
} from "../src/ProcessManagerTargetResolver";

const candidates: ReadonlyArray<ProcessManagerTargetCandidate> = [
  {
    id: "@repo/NorthWest/BillingGroup/SyncInvoices",
    kind: "process",
    groupId: "@repo/NorthWest/BillingGroup",
    controls: ["runImmediately", "status"],
  },
  {
    id: "@repo/SouthWest/BillingGroup/SyncInvoices",
    kind: "process",
    groupId: "@repo/SouthWest/BillingGroup",
    controls: ["runImmediately", "status"],
  },
  {
    id: "@repo/NorthWest/BillingGroup/BillingEmailQueue",
    kind: "queue",
    groupId: "@repo/NorthWest/BillingGroup",
    controls: ["enqueue", "start", "pause", "resume", "clear", "status"],
  },
];

describe("ProcessManager target resolver", () => {
  it("normalizes whole ids with case and punctuation insensitive word casing", () => {
    expect(
      normalizeProcessManagerTarget("@repo/NorthWest/BillingGroup/SyncInvoices"),
    ).toBe("repo/north-west/billing-group/sync-invoices");
    expect(
      normalizeProcessManagerTarget("north_west/billing group/syncInvoices"),
    ).toBe("north-west/billing-group/sync-invoices");
  });

  it("resolves canonical ids and normalized suffix aliases", () => {
    const canonical = resolveProcessManagerTarget(
      "@repo/NorthWest/BillingGroup/BillingEmailQueue",
      candidates,
    );
    const suffix = resolveProcessManagerTarget(
      "billing-group/billing-email-queue",
      candidates,
    );

    expect(canonical._tag).toBe("Resolved");
    if (canonical._tag === "Resolved") {
      expect(canonical.candidate.id).toBe("@repo/NorthWest/BillingGroup/BillingEmailQueue");
    }
    expect(suffix._tag).toBe("Resolved");
    if (suffix._tag === "Resolved") {
      expect(suffix.candidate.kind).toBe("queue");
    }
  });

  it("returns missing when no canonical id or suffix alias matches", () => {
    const result = resolveProcessManagerTarget("missing-process", candidates);

    expect(result).toMatchObject({
      _tag: "Missing",
      normalizedInput: "missing-process",
    });
  });

  it("reports ambiguous aliases with shortest unique suffixes", () => {
    const result = resolveProcessManagerTarget("sync-invoices", candidates);

    expect(result._tag).toBe("Ambiguous");
    if (result._tag === "Ambiguous") {
      expect(result.candidates.map((candidate) => ({
        id: candidate.candidate.id,
        minimumSuffix: candidate.minimumSuffix,
        unique: candidate.unique,
      }))).toEqual([
        {
          id: "@repo/NorthWest/BillingGroup/SyncInvoices",
          minimumSuffix: "north-west/billing-group/sync-invoices",
          unique: true,
        },
        {
          id: "@repo/SouthWest/BillingGroup/SyncInvoices",
          minimumSuffix: "south-west/billing-group/sync-invoices",
          unique: true,
        },
      ]);
    }
  });

  it("marks duplicate canonical ids when no unique suffix exists", () => {
    const duplicated: ReadonlyArray<ProcessManagerTargetCandidate> = [
      {
        id: "@repo/NorthWest/BillingGroup/SyncInvoices",
        kind: "process",
        groupId: "@repo/NorthWest/BillingGroup",
        controls: ["runImmediately", "status"],
      },
      {
        id: "@repo/NorthWest/BillingGroup/SyncInvoices",
        kind: "process",
        groupId: "@repo/Other/BillingGroup",
        controls: ["runImmediately", "status"],
      },
    ];
    const result = resolveProcessManagerTarget("sync-invoices", duplicated);

    expect(result._tag).toBe("Ambiguous");
    if (result._tag === "Ambiguous") {
      expect(result.candidates.every((candidate) => !candidate.unique)).toBe(true);
      expect(result.candidates.map((candidate) => candidate.minimumSuffix)).toEqual([
        "repo/north-west/billing-group/sync-invoices",
        "repo/north-west/billing-group/sync-invoices",
      ]);
    }
  });
});
