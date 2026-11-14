// The house's AI connection: an owner or admin pastes the house's own Claude or OpenAI key and a
// few notes about the family, and the computer players at the house's tables talk through it. When
// whoever runs the card room has set a key for everyone, a house can use that one and paste nothing.
import TextField from "@spades/ui/zubra-ui/text-field.zb";
import { useEffect, useState } from "react";
import { Choice, Toggle } from "./RulesEditor";
import { AI_PROVIDERS, houses, type AiProvider, type House } from "./housesApi";

export function HouseAiBlock({ house, onChange }: { house: House; onChange: (house: House) => void }) {
  const canManage = house.me.role !== "member";
  const saved = canManage && house.ai && "provider" in house.ai ? house.ai : null;
  const [provider, setProvider] = useState<AiProvider | "server">(saved?.provider ?? (house.aiServer ? "server" : "anthropic"));
  const [key, setKey] = useState("");
  const [model, setModel] = useState(saved?.model ?? "");
  const [context, setContext] = useState(saved?.context ?? "");
  // The account's own list of models, once asked for: then the model is picked, not typed.
  const [models, setModels] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ bad: boolean; text: string } | null>(null);
  // Follow the house when someone else changes it.
  useEffect(() => {
    if (!saved) return;
    setProvider(saved.provider);
    setModel(saved.model);
    setContext(saved.context);
  }, [saved?.provider, saved?.model, saved?.context]);

  if (!canManage) {
    if (!house.ai?.on) return null;
    return (
      <section className="house-block" aria-label="Bot talk">
        <h2>Bot talk</h2>
        <p className="fine">The computer players at this house's tables chat through an AI model. They still play their own cards.</p>
      </section>
    );
  }

  const SERVER = { id: "server" as const, name: "This card room's account", model: "" };
  const accounts = [...(house.aiServer || saved?.provider === "server" ? [SERVER] : []), ...AI_PROVIDERS];
  const service = accounts.find((p) => p.id === provider) ?? AI_PROVIDERS[0]!;
  const own = provider !== "server";
  const run = async (work: () => Promise<House | string>, done: string) => {
    setBusy(true);
    setNote(null);
    try {
      const result = await work();
      if (typeof result === "string") setNote({ bad: false, text: result });
      else {
        onChange(result);
        setKey("");
        setNote({ bad: false, text: done });
      }
    } catch (e) {
      setNote({ bad: true, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };
  const changedService = saved !== null && provider !== saved.provider;
  const needsKey = own && (saved === null || changedService || saved.provider === "server");

  return (
    <section className="house-block house-ai" aria-label="Bot talk">
      <h2>Bot talk</h2>
      <p className="fine">
        {house.aiServer ? "This card room has an AI account, so the computer players chat and answer in its words." : "Connect the house's own AI account and the computer players will chat and answer in its words."} They still play their own cards, and the model only
        sees what the whole table sees.
      </p>
      {saved && (
        <Toggle
          label="Bots talk through the model"
          description={saved.provider === "server" ? `This card room's account${saved.model ? ` · ${saved.model}` : ""}` : `${AI_PROVIDERS.find((p) => p.id === saved.provider)!.name} · ${saved.model} · key ending ${saved.keyEnding || "…"}`}
          checked={saved.on}
          onChange={(on) => void run(() => houses.saveAi(house.slug, { on }), on ? "Switched on." : "Switched off. The bots say their own lines.")}
        />
      )}
      <Choice
        label="Account"
        value={provider}
        options={accounts.map((p) => [p.id, p.name])}
        onChange={(v) => {
          setProvider(v as AiProvider | "server");
          setModels(null);
          setModel("");
        }}
      />
      {!own && <p className="fine">Whoever runs this card room pays for the bots' lines. Nothing to paste: add your family's notes below.</p>}
      {own && (
        <>
          <TextField
            label="API key"
            type="password"
            required={needsKey}
            autocomplete="off"
            value={key}
            maxlength={300}
            placeholder={needsKey ? "" : "Leave empty to keep the saved key"}
            description={`From your ${service.name} account's API keys page. Your account pays for the bots' lines (a few words each). The key stays on the card room's server and is never shown again.`}
            onValueChange={(e: CustomEvent<string>) => setKey(e.detail)}
          />
          {models ? (
            <Choice label="Model" value={model || service.model} options={[...new Set([...(model ? [model] : []), ...models])].map((m) => [m, m])} onChange={setModel} />
          ) : (
            <TextField label="Model" value={model} maxlength={80} placeholder={service.model} description="A small, fast model is plenty. Leave it empty and the card room picks one your account has." onValueChange={(e: CustomEvent<string>) => setModel(e.detail)} />
          )}
          {!models && (
            <button
              type="button"
              className="link"
              disabled={busy || (needsKey && !key.trim())}
              onClick={async () => {
                setBusy(true);
                setNote(null);
                try {
                  const found = await houses.aiModels(house.slug, provider, key.trim() || undefined);
                  setModels(found.models);
                  if (!model || !found.models.includes(model)) setModel(found.suggested);
                } catch (e) {
                  setNote({ bad: true, text: e instanceof Error ? e.message : String(e) });
                } finally {
                  setBusy(false);
                }
              }}
            >
              Choose from this account's models
            </button>
          )}
        </>
      )}
      <TextField
        label="About the family"
        rows={5}
        value={context}
        maxlength={1500}
        description="Who's who, nicknames, in-jokes, how the bots should talk. Everyone at the table may hear it come back, so nothing private."
        onValueChange={(e: CustomEvent<string>) => setContext(e.detail)}
      />
      <button
        type="button"
        className="primary"
        disabled={busy || (needsKey && !key.trim())}
        onClick={() => void run(() => houses.saveAi(house.slug, own ? { provider, key: key.trim() || undefined, model: model.trim() || undefined, context } : { provider, context }), "Saved.")}
      >
        {busy ? "Checking…" : saved ? "Save" : "Connect"}
      </button>
      {saved && (
        <span className="row-actions">
          <button type="button" className="link" disabled={busy} onClick={() => void run(async () => `A bot says: “${(await houses.testAi(house.slug)).line}”`, "")}>
            Try it
          </button>
{house.ai && "provider" in house.ai && (house.ai.provider !== "server" || house.ai.context !== "" || !house.ai.on) && (
            <button type="button" className="link danger" disabled={busy} onClick={() => confirm(house.aiServer ? "Forget this house's AI settings? Its key and notes are forgotten and the bots use the card room's account." : "Disconnect the AI account? The key is forgotten and the bots go back to their own lines.") && void run(() => houses.saveAi(house.slug, { disconnect: true }), "Disconnected.")}>
              Disconnect
            </button>
          )}
        </span>
      )}
      {note && <p className={note.bad ? "error" : "fine"}>{note.text}</p>}
    </section>
  );
}
