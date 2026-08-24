import { createRoot } from "react-dom/client";
import { App } from "./app";
import "./styles.css";

const el = document.getElementById("root");
if (el !== null) {
  createRoot(el).render(<App />);
}
