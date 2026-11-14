import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { unlockAudioOnFirstTap } from "./feedback/sounds";
import { registerServiceWorker } from "./notifications";
import { applyDisplay } from "./display";
import { DECK_KEY, applyDeck, savedDeck } from "@cardroom/decks";
import "./styles.css";

applyDisplay();
// The deck this browser plays with, if its owner chose one in the card designer (/designer/). Every
// <playing-card> reads it from the page's CSS variables; choosing another in the designer's tab
// changes the cards here at once.
applyDeck(document.documentElement, savedDeck());
window.addEventListener("storage", (event) => {
  if (event.key === DECK_KEY || event.key === null) applyDeck(document.documentElement, savedDeck());
});
unlockAudioOnFirstTap();
registerServiceWorker();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
