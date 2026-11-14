import { Component, StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { noteError, openReport, watchForErrors } from "./bugReport";
import { unlockAudioOnFirstTap } from "./feedback/sounds";
import { registerServiceWorker } from "./notifications";
import { ReportProblem } from "./ReportProblem";
import { applyDisplay } from "./display";
import "./styles.css";

watchForErrors();
applyDisplay();
unlockAudioOnFirstTap();
registerServiceWorker();

/**
 * If a screen crashes, say so instead of leaving a blank page, and offer to report it. "Report a
 * problem" sits outside this, so it still works when the app inside doesn't.
 */
class Crashed extends Component<{ children: ReactNode }, { crashed: boolean }> {
  override state = { crashed: false };
  static getDerivedStateFromError = () => ({ crashed: true });
  override componentDidCatch(error: Error) {
    noteError("the screen crashed", error);
  }
  override render() {
    if (!this.state.crashed) return this.props.children;
    return (
      <main className="setup crashed">
        <header className="setup-head">
          <div className="suits" aria-hidden>
            ♠ ♥ ♣ ♦
          </div>
          <h1>Something went wrong</h1>
          <p>That's our fault, not yours. A game at a family table is safe on the server: reload to pick it up where it was.</p>
        </header>
        <button type="button" className="primary" onClick={() => location.reload()}>
          Reload
        </button>
        <button type="button" className="secondary" onClick={openReport}>
          Report this problem
        </button>
      </main>
    );
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Crashed>
      <App />
    </Crashed>
    <ReportProblem />
  </StrictMode>,
);
