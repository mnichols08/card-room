import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { unlockAudioOnFirstTap } from "./feedback/sounds";
import { registerServiceWorker } from "./notifications";
import "./styles.css";

unlockAudioOnFirstTap();
registerServiceWorker();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
