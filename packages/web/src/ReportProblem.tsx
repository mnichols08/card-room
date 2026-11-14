// "Report a problem", on every screen: a small button, and the sheet it opens. The player writes a
// line (or nothing), says yes or no to a picture of the screen and to their browser's details, and
// sends. The card room files it on GitHub for them; they never leave the page.
import ToggleSwitch from "@spades/ui/zubra-ui/toggle-switch.zb";
import { useEffect, useRef, useState } from "react";
import { browserInfo, browserLines, bugs, openReport, REPORT_EVENT, takeScreenshot, type BrowserInfo, type SentReport } from "./bugReport";

const DESCRIPTION_LIMIT = 2000;

/** Whether this card room takes reports (false until the server has said so). */
function useReports() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => void bugs.enabled().then(setEnabled), []);
  return enabled;
}

/**
 * "Report a problem" as a line in another sheet (a table's ⚙︎, where a phone has no spare corner for
 * the button). `before` closes that sheet, so the picture is of the table and not of the settings.
 */
export function ReportLink({ before }: { before: () => void }) {
  if (!useReports()) return null;
  return (
    <button
      type="button"
      className="link report-link"
      onClick={() => {
        before();
        // Once the sheet has left the screen.
        setTimeout(openReport, 60);
      }}
    >
      🐞 Something not working? Report a problem
    </button>
  );
}

type Stage = { kind: "closed" } | { kind: "looking" } | { kind: "writing" } | { kind: "sending" } | { kind: "sent"; report: SentReport };

export function ReportProblem() {
  const enabled = useReports();
  const [stage, setStage] = useState<Stage>({ kind: "closed" });
  const [description, setDescription] = useState("");
  const [shot, setShot] = useState<string | null>(null);
  const [withShot, setWithShot] = useState(true);
  const [browser, setBrowser] = useState<BrowserInfo | null>(null);
  const [withBrowser, setWithBrowser] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const words = useRef<HTMLTextAreaElement>(null);
  const busy = useRef(false);

  /** Take the picture first, while the screen still shows the problem and not this sheet. */
  const start = async () => {
    if (busy.current) return;
    busy.current = true;
    setProblem(null);
    setStage({ kind: "looking" });
    setBrowser(browserInfo());
    setShot(await takeScreenshot());
    setStage({ kind: "writing" });
    busy.current = false;
  };
  const close = () => {
    setStage({ kind: "closed" });
    setShot(null);
    setProblem(null);
  };

  // Another part of the app can open the sheet (the screen shown after a crash).
  const open = useRef(start);
  open.current = start;
  useEffect(() => {
    const ask = () => void open.current();
    addEventListener(REPORT_EVENT, ask);
    return () => removeEventListener(REPORT_EVENT, ask);
  }, []);

  const showing = stage.kind !== "closed" && stage.kind !== "looking";
  useEffect(() => {
    if (!showing) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && close();
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [showing]);
  useEffect(() => {
    if (stage.kind === "writing") words.current?.focus();
  }, [stage.kind]);

  if (!enabled) return null;

  const send = async () => {
    setProblem(null);
    setStage({ kind: "sending" });
    try {
      const report = await bugs.send({ description: description.trim(), screenshot: withShot ? shot : null, browser: withBrowser ? browser : null });
      setDescription("");
      setShot(null);
      setStage({ kind: "sent", report });
    } catch (e) {
      setProblem((e as Error).message);
      setStage({ kind: "writing" });
    }
  };

  return (
    // Never in its own picture.
    <div data-no-screenshot>
      {!showing && (
        <button type="button" className="report-toggle" onClick={start} disabled={stage.kind === "looking"} aria-label="Report a problem" title="Report a problem">
          <span aria-hidden>{stage.kind === "looking" ? "…" : "🐞"}</span>
        </button>
      )}
      {showing && (
        <>
          <div className="sheet-backdrop report-backdrop" onClick={stage.kind === "sending" ? undefined : close} />
          <div className="sheet report-sheet" role="dialog" aria-modal="true" aria-labelledby="report-title">
            {stage.kind === "sent" ? (
              <>
                <h2 id="report-title">Thank you!</h2>
                <p>
                  Your report is in as number {stage.report.number}. There's nothing more to do.
                  {stage.report.url && (
                    <>
                      {" "}
                      If you're curious, you can{" "}
                      <a href={stage.report.url} target="_blank" rel="noreferrer">
                        follow it on GitHub
                      </a>
                      .
                    </>
                  )}
                </p>
                <button type="button" className="primary" onClick={close}>
                  Back to the game
                </button>
              </>
            ) : (
              <form
                className="report-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void send();
                }}
              >
                <h2 id="report-title">Report a problem</h2>
                <label className="report-words">
                  <span>
                    What went wrong? <small>(you can leave this empty)</small>
                  </span>
                  <textarea
                    ref={words}
                    rows={3}
                    maxLength={DESCRIPTION_LIMIT}
                    value={description}
                    placeholder="The cards didn't deal, a button did nothing, something looked off…"
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </label>

                {shot ? (
                  <div className="report-choice">
                    <ToggleSwitch
                      label="Send a picture of the screen"
                      description="The screen as it was when you tapped the bug. Look it over: names and chat on it are sent too."
                      checked={withShot}
                      onCheckedChange={(e: CustomEvent<boolean>) => setWithShot(e.detail)}
                    />
                    {withShot && <img className="report-shot" src={shot} alt="The picture of the screen that would be sent" />}
                  </div>
                ) : (
                  <p className="fine">A picture of the screen couldn't be taken on this device, so none is sent.</p>
                )}

                <div className="report-choice">
                  <ToggleSwitch
                    label="Send my browser's details"
                    description="Which browser and device this is, and the size of its screen."
                    checked={withBrowser}
                    onCheckedChange={(e: CustomEvent<boolean>) => setWithBrowser(e.detail)}
                  />
                  {withBrowser && browser && (
                    <details className="report-details">
                      <summary>See exactly what's sent</summary>
                      <dl>
                        {browserLines(browser).map(([label, value]) => (
                          <div key={label}>
                            <dt>{label}</dt>
                            <dd>{value}</dd>
                          </div>
                        ))}
                      </dl>
                    </details>
                  )}
                </div>

                <p className="fine">
                  Reports are posted where anyone can read them, so the people who work on Card Room can fix things. Yours also says which game and screen you were on and any
                  errors the page ran into. It never includes your name.
                </p>
                {problem && (
                  <p className="error" role="alert">
                    {problem}
                  </p>
                )}
                <div className="report-actions">
                  <button type="button" className="secondary" onClick={close} disabled={stage.kind === "sending"}>
                    Cancel
                  </button>
                  <button type="submit" className="primary" disabled={stage.kind === "sending"}>
                    {stage.kind === "sending" ? "Sending…" : "Send report"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </>
      )}
    </div>
  );
}
