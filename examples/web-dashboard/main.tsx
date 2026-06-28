import "./styles.css";
import { createRoot } from "react-dom/client";
import { Dashboard } from "../../src/web";
import { Fleet } from "./fleet";
import { runtime } from "./queue-data";

const root = document.getElementById("root");
if (root === null) {
  throw new Error("Missing #root element");
}

// Dogfood the shipped dashboard: this is exactly what a consumer (wow) writes — point
// `<Dashboard>` at a reactive runtime (Atom.runtime over Resource.client tags) + a root Group.
// No <StrictMode>: its dev-only double-mount tears down the cold stream atoms and drops their
// first emit; single-pass mount is deterministic (production has no StrictMode anyway).
createRoot(root).render(<Dashboard runtime={runtime} group={Fleet} />);
