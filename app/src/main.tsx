import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { configFromEnv } from "./lib/config";
import "./styles.css";
import "./standalone.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App config={configFromEnv()} />
  </StrictMode>,
);
