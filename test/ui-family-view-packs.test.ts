/**
 * Family *View.pack ids — parity packs via Observe.packOf.
 */
import { describe, expect, it } from "vitest";
import * as ApiMetricsView from "../src/ui/ApiMetricsView";
import * as DaemonView from "../src/ui/DaemonView";
import * as FleetHealthView from "../src/ui/FleetHealthView";
import * as GateView from "../src/ui/GateView";
import * as PriorityView from "../src/ui/PriorityView";
import * as ShardMapView from "../src/ui/ShardMapView";
import * as TelemetryView from "../src/ui/TelemetryView";

describe("*View.pack ids", () => {
  it("exports stable named packs for every family", () => {
    expect(PriorityView.pack.id).toBe("workpool/priority");
    expect(DaemonView.pack.id).toBe("daemon");
    expect(ApiMetricsView.pack.id).toBe("api");
    expect(GateView.pack.id).toBe("gate");
    expect(FleetHealthView.pack.id).toBe("fleetHealth");
    expect(TelemetryView.pack.id).toBe("telemetry");
    expect(ShardMapView.pack.id).toBe("shardMap");
  });
});
