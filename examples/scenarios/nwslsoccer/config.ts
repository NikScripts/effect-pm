/**
 * {@link Config} entries for {@link NwslsoccerClient}. Compose with `ConfigProvider` in tests or scripts.
 */
import { Config } from "effect";

/** Base URL without trailing slash (paths include `/v1/nwsl/football/...`). */
export const NwslSoccerApiBaseUrl = Config.string("NWSL_SOCCER_API_BASE_URL").pipe(
  Config.withDefault("https://api-sdp.nwslsoccer.com"),
);
