/**
 * Private `_logs` shape is omitted from public store handles (Effect-style `_` fields).
 */
import * as Daemon from "../src/Daemon";
import * as Store from "../src/Store";
import type { StoreHandleFromContract } from "../src/internal/store/spec";
import { makeDaemonStoreAnalyticsContract } from "../src/internal/store/daemonStoreSpec";

class HideLogsProc extends Daemon.Tag<HideLogsProc>()("test/store-logs-hide/Proc") {}

type DaemonStoreHandle = StoreHandleFromContract<
  ReturnType<typeof makeDaemonStoreAnalyticsContract<typeof HideLogsProc>>
>;

declare const handle: DaemonStoreHandle;

// Apps own the noun `log` — platform journal is `_logs` and not on the public type.
void handle.event;
void handle.events;
// @ts-expect-error platform journal is private (underscore)
void handle._logs;
// @ts-expect-error former shape key removed
void handle.log;

// Domain shape named `log` is allowed on a custom contract.
const domainLogContract = Store.contract({
  log: Store.shape(Daemon.daemonExecutionEvent),
});
type DomainHandle = Store.HandleOf<typeof domainLogContract>;
declare const domain: DomainHandle;
void domain.log.read;
// @ts-expect-error no platform `_logs` on a contract that only declares `log`
void domain._logs;
