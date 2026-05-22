/**
 * Protocol descriptors for ProcessManager endpoint configuration.
 *
 * @module processManagerTransport
 */

/**
 * HTTP transport descriptor used by group-bundled endpoint config.
 *
 * @public
 */
export interface ProcessManagerHttpTransport {
  readonly _tag: "ProcessManagerHttpTransport";
  readonly baseUrl: string;
}

/**
 * Supported control transports for bundled endpoint config (extensible).
 *
 * @public
 */
export type ProcessManagerTransport = ProcessManagerHttpTransport;

const localBaseUrl = (port: number): string => `http://127.0.0.1:${String(port)}`;

const hostPortBaseUrl = (host: string, port: number): string => {
  if (host.includes("://")) {
    const url = new URL(host);
    url.port = String(port);
    return url.toString();
  }
  return `http://${host}:${String(port)}`;
};

function httpTransport(port: number): ProcessManagerHttpTransport;
function httpTransport(host: string, port: number): ProcessManagerHttpTransport;
function httpTransport(baseUrl: string): ProcessManagerHttpTransport;
function httpTransport(
  hostOrPort: string | number,
  port?: number,
): ProcessManagerHttpTransport {
  if (typeof hostOrPort === "number") {
    return {
      _tag: "ProcessManagerHttpTransport",
      baseUrl: localBaseUrl(hostOrPort),
    };
  }
  if (port !== undefined) {
    return {
      _tag: "ProcessManagerHttpTransport",
      baseUrl: hostPortBaseUrl(hostOrPort, port),
    };
  }
  return {
    _tag: "ProcessManagerHttpTransport",
    baseUrl: hostOrPort,
  };
}

/**
 * Transport descriptor namespace for protocol-agnostic endpoint config.
 *
 * @public
 */
export const Transport = {
  http: httpTransport,
};

/**
 * @public
 */
export const transportBaseUrl = (transport: ProcessManagerTransport): string =>
  transport.baseUrl;

/**
 * @public
 */
export const parsePortFromTransport = (transport: ProcessManagerTransport): number => {
  const url = new URL(transport.baseUrl);
  if (url.port !== "") {
    return Number(url.port);
  }
  return url.protocol === "https:" ? 443 : 80;
};
