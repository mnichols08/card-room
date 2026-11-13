import { useNotifications } from "./notifications";

/** "Buzz my phone" — for challenges and new tables. Hidden when the server has push turned off. */
export function NotifyButton({ what }: { what: string }) {
  const { state, problem, turnOn, turnOff } = useNotifications();
  if (state === "checking" || state === "unsupported" || state === "server-off") return null;
  return (
    <div className="notify">
      {state === "install-first" && (
        <p className="fine">
          To get a buzz on this iPhone when {what}: tap the Share button <span aria-hidden>⎋</span>, choose <strong>Add to Home Screen</strong>, then open Spades from
          your Home Screen and turn notifications on there.
        </p>
      )}
      {state === "off" && (
        <button type="button" className="secondary" onClick={turnOn}>
          🔔 Buzz my phone when {what}
        </button>
      )}
      {state === "on" && (
        <p className="fine">
          🔔 This phone gets a buzz when {what}.{" "}
          <button type="button" className="link" onClick={turnOff}>
            Turn off
          </button>
        </p>
      )}
      {state === "denied" && <p className="fine">Notifications are blocked for Spades. You can allow them in this phone's settings for the site.</p>}
      {problem && <p className="error">{problem}</p>}
    </div>
  );
}
