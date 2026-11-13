// Push notifications on this phone: register the service worker, ask once, hand the server the
// subscription. iPhones only allow it from the Home Screen app, so we say how to get there.
import { useEffect, useState } from "react";

export type NotifyState = "checking" | "unsupported" | "install-first" | "server-off" | "denied" | "off" | "on";

const base = import.meta.env.BASE_URL;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const standalone = () => matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

/** Called once at start-up. The service worker does nothing until a notification arrives. */
export function registerServiceWorker() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch(() => {});
}

function keyBytes(base64url: string) {
  const s = atob(base64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(base64url.length / 4) * 4, "="));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

async function serverKey(): Promise<string | null> {
  const r = await fetch("/push/key").catch(() => null);
  const data = (await r?.json().catch(() => null)) as { enabled: boolean; publicKey: string | null } | null;
  return data?.enabled ? data.publicKey : null;
}

async function current(): Promise<NotifyState> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return isIos() && !standalone() ? "install-first" : "unsupported";
  }
  if (!(await serverKey())) return "server-off";
  if (Notification.permission === "denied") return "denied";
  const reg = await navigator.serviceWorker.getRegistration(base);
  return (await reg?.pushManager.getSubscription()) ? "on" : "off";
}

async function post(path: string, body: unknown) {
  const r = await fetch(path, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "Couldn't turn on notifications.");
}

export async function turnOn(): Promise<NotifyState> {
  const key = await serverKey();
  if (!key) return "server-off";
  if ((await Notification.requestPermission()) !== "granted") return Notification.permission === "denied" ? "denied" : "off";
  const reg = await navigator.serviceWorker.register(`${base}sw.js`, { scope: base });
  await navigator.serviceWorker.ready;
  const subscription = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) }));
  await post("/push/subscribe", { subscription: subscription.toJSON() });
  await post("/push/test", {});
  return "on";
}

export async function turnOff(): Promise<NotifyState> {
  const reg = await navigator.serviceWorker.getRegistration(base);
  const subscription = await reg?.pushManager.getSubscription();
  if (subscription) {
    await post("/push/unsubscribe", { endpoint: subscription.endpoint }).catch(() => {});
    await subscription.unsubscribe();
  }
  return "off";
}

export function useNotifications() {
  const [state, setState] = useState<NotifyState>("checking");
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    void current().then(setState);
  }, []);
  const run = (fn: () => Promise<NotifyState>) => async () => {
    setProblem(null);
    try {
      setState(await fn());
    } catch (e) {
      setProblem((e as Error).message);
    }
  };
  return { state, problem, turnOn: run(turnOn), turnOff: run(turnOff) };
}
