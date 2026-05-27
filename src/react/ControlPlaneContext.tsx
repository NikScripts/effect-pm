/**
 * React context for an injected {@link ControlPlanePort}.
 *
 * @module react/ControlPlaneContext
 */

import { createContext, useContext, type ReactNode } from "react";
import type { ControlPlanePort } from "./ControlPlanePort.js";

const ControlPlaneContext = createContext<ControlPlanePort | null>(null);

export type ControlPlaneProviderProps = {
  readonly port: ControlPlanePort;
  readonly children: ReactNode;
};

/**
 * Supplies a {@link ControlPlanePort} to descendant widgets.
 *
 * @public
 */
export const ControlPlaneProvider = ({
  port,
  children,
}: ControlPlaneProviderProps) => (
  <ControlPlaneContext.Provider value={port}>{children}</ControlPlaneContext.Provider>
);

/**
 * Returns the port from the nearest {@link ControlPlaneProvider}.
 *
 * @public
 */
export const useControlPlane = (): ControlPlanePort => {
  const port = useContext(ControlPlaneContext);
  if (port === null) {
    throw new Error("useControlPlane requires ControlPlaneProvider");
  }
  return port;
};
