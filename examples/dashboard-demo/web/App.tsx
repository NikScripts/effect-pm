import {
  ControlPlaneProvider,
  OperatorControlPanel,
} from "../../../src/react";
import { createFetchControlPlaneAdapter } from "../../../src/react/adapters/fetch";

const port = createFetchControlPlaneAdapter({
  baseUrl: "/api/control",
  defaultInit: { credentials: "same-origin" },
});

export const App = () => (
  <main style={{ fontFamily: "system-ui, sans-serif", margin: "2rem auto", maxWidth: 720 }}>
    <h1 style={{ marginTop: 0 }}>effect-pm control demo</h1>
    <p style={{ opacity: 0.85 }}>
      Browser calls <code>/api/control</code> (Vite proxy → private ControlService).
    </p>
    <ControlPlaneProvider port={port}>
      <OperatorControlPanel pollIntervalMs={2000} />
    </ControlPlaneProvider>
  </main>
);
