import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { unlockAudioOnFirstTap } from "./feedback/sounds";
import "./styles.css";

unlockAudioOnFirstTap();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
