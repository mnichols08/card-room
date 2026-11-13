// Push notifications: a phone that said yes gets a buzz when someone challenges its player, or a
// table opens in their house. Standard Web Push with VAPID keys; nothing to sign up for.
//
// Keys come from the environment (make a pair with `npx web-push generate-vapid-keys`):
//   SPADES_VAPID_PUBLIC_KEY, SPADES_VAPID_PRIVATE_KEY, SPADES_VAPID_SUBJECT (mailto: or https: URL)
// Without them, notifications are off and the app says so.
//
// Subscriptions are kept per player in `pushsubs/<player>` in the sync log, which only the server
// can read: a subscription is a capability to message someone's phone.
import { createHash } from "node:crypto";
import webpush from "web-push";

export interface Notice {
  title: string;
  body: string;
  /** Where tapping it goes, within the app. */
  url: string;
  /** Notices with the same tag replace each other instead of piling up. */
  tag?: string;
}

export interface Subscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Sends one notice to one subscription. Rejects with `statusCode` 404/410 when it's gone for good. */
export type Sender = (subscription: Subscription, payload: string) => Promise<unknown>;

export interface PushOptions {
  publicKey?: string;
  privateKey?: string;
  subject?: string;
  /** For tests: deliver here instead of to the push service. */
  send?: Sender;
}

interface Store {
  write(collection: string, key: string, fields: Record<string, unknown>): Promise<unknown>;
  documents(): Promise<{ get(collection: string, key: string): Record<string, unknown> | undefined }>;
}

const idOf = (endpoint: string) => `s${createHash("sha256").update(endpoint).digest("hex").slice(0, 20)}`;

function valid(value: unknown): value is Subscription {
  const s = value as Subscription;
  return (
    !!s &&
    typeof s.endpoint === "string" &&
    /^https:\/\//.test(s.endpoint) &&
    s.endpoint.length < 1000 &&
    typeof s.keys?.p256dh === "string" &&
    typeof s.keys?.auth === "string"
  );
}

export function createPush(store: Store, options: PushOptions = {}) {
  const enabled = !!(options.send || (options.publicKey && options.privateKey));
  let send: Sender | null = options.send ?? null;
  if (!send && enabled) {
    webpush.setVapidDetails(options.subject ?? "mailto:cardroom@example.com", options.publicKey!, options.privateKey!);
    send = (subscription, payload) => webpush.sendNotification(subscription, payload, { TTL: 60 * 60 * 6, urgency: "high" });
  }
  const docs = store.documents();

  async function subscriptions(player: string): Promise<[string, Subscription][]> {
    const doc = (await docs).get("pushsubs", player) ?? {};
    return Object.entries(doc).filter((entry): entry is [string, Subscription] => entry[0].startsWith("s") && valid(entry[1]));
  }

  return {
    enabled,
    publicKey: options.publicKey ?? null,

    async subscribe(player: string, subscription: unknown): Promise<string | null> {
      if (!enabled) return "Notifications aren't set up on this server yet.";
      if (!valid(subscription)) return "That isn't a push subscription.";
      const clean: Subscription = { endpoint: subscription.endpoint, keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth } };
      await store.write("pushsubs", player, { [idOf(clean.endpoint)]: clean });
      return null;
    },

    async unsubscribe(player: string, endpoint: string) {
      await store.write("pushsubs", player, { [idOf(endpoint)]: null });
    },

    async has(player: string) {
      return (await subscriptions(player)).length > 0;
    },

    /** Notify every phone a player said yes on. Phones that have gone away are forgotten. */
    async notify(player: string, notice: Notice): Promise<number> {
      if (!send) return 0;
      let delivered = 0;
      for (const [id, subscription] of await subscriptions(player)) {
        try {
          await send(subscription, JSON.stringify(notice));
          delivered++;
        } catch (e) {
          const status = (e as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) await store.write("pushsubs", player, { [id]: null });
          else console.error("push: couldn't deliver", status ?? e);
        }
      }
      return delivered;
    },
  };
}

export type Push = ReturnType<typeof createPush>;
