"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FIELD_KIND_LABEL, type FieldKind } from "@/domain/field/field";
import { lookupCode, type CodeLookup } from "@/lib/field/codes";
import { askForDurableStorage, fieldStore, isPending, type LocalStatus, type QueuedOp } from "@/lib/field/store";
import { syncNow } from "@/lib/field/sync-client";
import type { FieldLot, FieldSnapshot } from "@/services/field/snapshot";
import { EntrySheet } from "./EntrySheet";
import { ago, clock, fmt, isStale } from "./field-format";
import { Scanner } from "./Scanner";

/**
 * The field app (document 3, ch. 05, lot 10). Works from what the phone holds: the snapshot of the
 * person's lots and the queue of their entries, both in IndexedDB. The network is used when it is
 * there — to send the queue in order and refresh the snapshot — and never needed to enter data.
 */

type Tab = "lots" | "scan" | "receptions" | "outbox";
type Entry = { kind: FieldKind; lotId: string | null; transferId: string | null; title: string; laying: boolean };

const STATUS: Record<LocalStatus, { label: string; tone: string }> = {
  EN_ATTENTE: { label: "En attente d'envoi", tone: "border-info/30 bg-info/10 text-info-strong" },
  A_REESSAYER: { label: "Nouvel essai à venir", tone: "border-info/30 bg-info/10 text-info-strong" },
  AUTRE_COMPTE: { label: "Autre compte", tone: "border-border bg-background text-secondary" },
  APPLIQUEE: { label: "Enregistrée", tone: "border-success/30 bg-success/10 text-success-strong" },
  CONFIRMEE: { label: "Confirme le chiffre du jour", tone: "border-success/30 bg-success/10 text-success-strong" },
  EN_ECART: { label: "Écart signalé", tone: "border-warning/40 bg-warning/10 text-warning-strong" },
  REFUSEE: { label: "Refusée", tone: "border-critical/30 bg-critical/10 text-critical-strong" },
};

const ENTRY_BUTTONS: { kind: FieldKind; care?: boolean }[] = [
  { kind: "MORTALITE" },
  { kind: "PESEE" },
  { kind: "ALIMENT" },
  { kind: "EAU" },
  { kind: "VACCINATION", care: true },
  { kind: "TRAITEMENT", care: true },
  { kind: "OBSERVATION", care: true },
];

/**
 * Registers the worker that keeps this page on the phone, then hands it what the page loaded —
 * the first visit runs before the worker is in control. Never awaited by the app: without a worker
 * (private browsing, old browser) everything still works while the page stays open.
 */
async function installOfflineWorker(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/terrain" });
    const worker = registration.active ?? registration.waiting ?? registration.installing;
    if (!worker) return;
    if (worker.state !== "activated") {
      await new Promise<void>((resolve) => {
        const done = () => worker.state === "activated" && resolve();
        worker.addEventListener("statechange", done);
        setTimeout(resolve, 15_000);
      });
    }
    const urls = [
      ...performance.getEntriesByType("resource").map((e) => e.name),
      ...Array.from(document.querySelectorAll<HTMLScriptElement>("script[src]")).map((s) => s.src),
      ...Array.from(document.querySelectorAll<HTMLLinkElement>("link[rel=stylesheet], link[rel=preload]")).map((l) => l.href),
    ].filter((u) => u.includes("/_next/static/"));
    (registration.active ?? worker).postMessage({ type: "WARM", urls: Array.from(new Set(urls)) });
  } catch {
    /* registration refused: online use is unaffected */
  }
}

/** Units as the gateways send them, as a person reads them. */
function unitLabel(unit: string): string {
  return ({ C: "°C", PPM: "ppm", LUX: "lx", PA: "Pa", M3: "m³" } as Record<string, string>)[unit.toUpperCase()] ?? unit;
}

function Chip({ status }: { status: LocalStatus }) {
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${STATUS[status].tone}`}>{STATUS[status].label}</span>;
}

function Stamped({ label, value, at, note }: { label: string; value: string | null; at: string | null; note?: string }) {
  const stale = at ? isStale(at) : false;
  return (
    <div className="flex flex-col gap-0.5 rounded-xl border border-border bg-surface p-3">
      <span className="text-xs font-medium uppercase tracking-wide text-secondary">{label}</span>
      <span className={`font-semibold text-ink ${value && value.length > 18 ? "line-clamp-3 text-sm" : "text-lg"}`}>{value ?? "—"}</span>
      {note ? (
        <span className="text-xs text-secondary">{note}</span>
      ) : at ? (
        <span className={`text-xs ${stale ? "font-semibold text-warning-strong" : "text-secondary"}`} title={clock(at)}>
          {ago(at)} · {clock(at)}
          {stale ? " · ancienne" : ""}
        </span>
      ) : (
        <span className="text-xs text-muted">aucune donnée</span>
      )}
    </div>
  );
}

export function FieldApp({ userId, userName }: { userId: string; userName: string }) {
  const [snapshot, setSnapshot] = useState<FieldSnapshot | null>(null);
  const [ops, setOps] = useState<QueuedOp[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<{ tone: "info" | "warning" | "critical"; text: string } | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [tab, setTab] = useState<Tab>("lots");
  const [lotId, setLotId] = useState<string | null>(null);
  const [entry, setEntry] = useState<Entry | null>(null);
  const [scan, setScan] = useState<CodeLookup | null>(null);
  const [search, setSearch] = useState("");
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    const [stored, queued] = await Promise.all([fieldStore.snapshot(), fieldStore.allOps()]);
    // A snapshot left by another account on a shared phone is not shown to this one.
    setSnapshot(stored && stored.user.id === userId ? stored : null);
    setOps(queued);
    setLoaded(true);
  }, [userId]);

  const sync = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    const outcome = await syncNow(userId).catch(() => ({ ok: false as const, reason: "SERVEUR" as const, sent: 0, message: "Erreur inattendue pendant l'envoi : nouvel essai plus tard." }));
    setSyncing(false);
    if (outcome.ok) {
      setNeedsLogin(false);
      setNotice(outcome.sent > 0 ? { tone: "info", text: `${outcome.sent} saisie${outcome.sent > 1 ? "s" : ""} envoyée${outcome.sent > 1 ? "s" : ""}.` } : null);
    } else {
      setNeedsLogin(outcome.reason === "CONNEXION");
      setNotice({ tone: outcome.reason === "HORS_LIGNE" ? "warning" : "critical", text: outcome.message });
    }
    await reload();
  }, [reload, syncing, userId]);

  // Start: the phone's identity, durable storage, whatever is stored, then a first exchange.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const id = await fieldStore.deviceId();
      if (cancelled) return;
      setDeviceId(id);
      setOnline(navigator.onLine);
      void askForDurableStorage();
      await reload();
      if (navigator.onLine && !cancelled) await sync();
    })();
    void installOfflineWorker();
    return () => {
      cancelled = true;
    };
    // sync is intentionally not a dependency: this runs once, at start.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload]);

  useEffect(() => {
    const up = () => {
      setOnline(true);
      void sync();
    };
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    const every = setInterval(() => {
      if (navigator.onLine && ops.some((op) => op.authorId === userId && isPending(op))) void sync();
    }, 60_000);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
      clearInterval(every);
    };
  }, [ops, sync, userId]);

  const pendingMine = ops.filter((op) => op.authorId === userId && isPending(op)).length;
  const lots = useMemo(() => {
    const all = snapshot?.lots ?? [];
    const q = search.trim().toUpperCase();
    return q ? all.filter((l) => `${l.code} ${l.farmName} ${l.buildingCode}`.toUpperCase().includes(q)) : all;
  }, [snapshot, search]);
  const lot: FieldLot | null = snapshot?.lots.find((l) => l.id === lotId) ?? null;
  const receptions = (snapshot?.receptions ?? []).filter((r) => !ops.some((op) => op.kind === "RECEPTION" && op.transferId === r.id && op.status !== "REFUSEE"));

  async function save(payload: Record<string, unknown>, summary: string) {
    if (!entry || !deviceId) return;
    await fieldStore.enqueue({
      opId: crypto.randomUUID(),
      deviceId,
      authorId: userId,
      kind: entry.kind,
      lotId: entry.lotId,
      transferId: entry.transferId,
      capturedAt: new Date().toISOString(),
      payload,
      summary,
      status: "EN_ATTENTE",
      message: null,
      sentAt: null,
    });
    setEntry(null);
    setNotice({ tone: "info", text: navigator.onLine ? "Saisie enregistrée sur le téléphone, envoi en cours." : "Saisie enregistrée sur le téléphone. Elle partira au retour du réseau." });
    await reload();
    if (navigator.onLine) await sync();
  }

  function openCode(raw: string) {
    const result = lookupCode(snapshot ?? undefined, raw);
    setScan(result);
    if (result.status !== "FOUND") return;
    const { match } = result;
    if (match.kind === "TRANSFER") {
      const reception = receptions.find((r) => r.id === match.id);
      if (reception) {
        setTab("receptions");
        setEntry({ kind: "RECEPTION", lotId: null, transferId: reception.id, title: `Réception ${reception.code}`, laying: false });
      }
      return;
    }
    if (match.lotId) {
      setTab("lots");
      setLotId(match.lotId);
    }
  }

  // ------------------------------------------------------------------ screens

  if (entry) {
    return (
      <main className="mx-auto w-full max-w-lg flex-1 px-4 py-4">
        <EntrySheet kind={entry.kind} title={entry.title} laying={entry.laying} signerHint={`Tapez « ${userName} », comme sur votre compte.`} onCancel={() => setEntry(null)} onSave={save} />
      </main>
    );
  }

  const header = (
    <header className="sticky top-0 z-10 bg-deep-forest px-4 pb-3 pt-[max(env(safe-area-inset-top),12px)] text-white">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-widest text-gold">BIOVOLAILLES · Terrain</p>
          <p className="truncate text-sm text-white/80">{userName}</p>
        </div>
        <button
          type="button"
          onClick={() => void sync()}
          disabled={syncing || !online}
          className="flex h-11 items-center gap-2 rounded-lg bg-white/10 px-3 text-sm font-semibold disabled:opacity-60"
          aria-label="Envoyer et mettre à jour"
        >
          <span className={`size-2.5 rounded-full ${online ? "bg-fresh-green" : "bg-warning"}`} aria-hidden="true" />
          {syncing ? "Envoi…" : online ? "Synchroniser" : "Hors ligne"}
          {pendingMine > 0 ? <span className="rounded-full bg-gold px-1.5 text-xs text-deep-forest">{pendingMine}</span> : null}
        </button>
      </div>
      <p className={`mt-1 text-xs ${snapshot && isStale(snapshot.generatedAt) ? "font-semibold text-gold" : "text-white/70"}`}>
        {snapshot ? `Données du ${clock(snapshot.generatedAt)} (${ago(snapshot.generatedAt)})` : "Aucune donnée sur ce téléphone pour l'instant"}
      </p>
    </header>
  );

  const banners = (
    <>
      {needsLogin ? (
        <div role="alert" className="mx-4 mt-3 rounded-lg border border-critical/40 bg-critical/10 px-3 py-2 text-sm text-critical-strong">
          Session expirée. Vos saisies sont gardées sur le téléphone.{" "}
          <a href="/login?next=/terrain" className="font-semibold underline">
            Se reconnecter
          </a>
        </div>
      ) : null}
      {notice ? (
        <div
          role="status"
          className={`mx-4 mt-3 rounded-lg border px-3 py-2 text-sm ${notice.tone === "info" ? "border-info/30 bg-info/10 text-info-strong" : notice.tone === "warning" ? "border-warning/40 bg-warning/10 text-warning-strong" : "border-critical/40 bg-critical/10 text-critical-strong"}`}
        >
          {notice.text}
        </div>
      ) : null}
    </>
  );

  let body: React.ReactNode;
  if (!loaded) {
    body = <p className="p-6 text-center text-secondary">Ouverture…</p>;
  } else if (!snapshot && tab !== "outbox") {
    body = (
      <div className="m-4 rounded-xl border border-border bg-surface p-5 text-sm text-text">
        <p className="font-semibold">Pas encore de données sur ce téléphone.</p>
        <p className="mt-1 text-secondary">{online ? "Téléchargement en cours…" : "Ouvrez l'application une première fois avec du réseau : elle gardera ensuite vos lots pour travailler hors ligne."}</p>
      </div>
    );
  } else if (tab === "lots" && lot) {
    const lotOps = ops.filter((op) => op.lotId === lot.id).slice(-8).reverse();
    body = (
      <div className="flex flex-col gap-4 p-4">
        <button type="button" onClick={() => setLotId(null)} className="self-start text-sm font-medium text-bio-green">
          ← Tous les lots
        </button>
        <div>
          <h1 className="text-2xl font-semibold text-ink">{lot.code}</h1>
          <p className="text-sm text-secondary">
            {lot.farmName} · {lot.buildingCode}
          </p>
          <p className="text-sm text-secondary">
            {[lot.purposeLabel, lot.phaseLabel, lot.age].filter(Boolean).join(" · ")} · {fmt(lot.currentPopulation)} sujets
          </p>
          {lot.bvuId ? <p className="mt-1 font-mono text-xs text-muted">{lot.bvuId}</p> : null}
        </div>
        {lot.onHold ? <p className="rounded-lg border border-critical/40 bg-critical/10 px-3 py-2 text-sm text-critical-strong">Lot sous blocage qualité : rien ne sort de ce lot avant la levée.</p> : null}
        {lot.withdrawal ? <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning-strong">{lot.withdrawal}</p> : null}
        {lot.today.discrepancy ? <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning-strong">Mortalité du jour en écart : {lot.today.discrepancy}</p> : null}
        <section className="grid grid-cols-2 gap-2">
          <Stamped label="Morts aujourd'hui" value={lot.today.declared === null ? "Non déclaré" : fmt(lot.today.declared)} at={null} note={lot.today.declared === null ? "à déclarer" : "dernière déclaration du jour"} />
          <Stamped label="Dernière mortalité" value={lot.latest.mortality ? `${fmt(lot.latest.mortality.value)} sujets` : null} at={lot.latest.mortality?.at ?? null} />
          <Stamped label="Poids moyen" value={lot.latest.weightKg ? `${fmt(lot.latest.weightKg.value, 3)} kg` : null} at={lot.latest.weightKg?.at ?? null} />
          <Stamped label="Aliment" value={lot.latest.feedKg ? `${fmt(lot.latest.feedKg.value, 1)} kg` : null} at={lot.latest.feedKg?.at ?? null} />
          <Stamped label="Eau" value={lot.latest.waterL ? `${fmt(lot.latest.waterL.value, 1)} L` : null} at={lot.latest.waterL?.at ?? null} />
          <Stamped label="Santé" value={lot.latest.health?.value ?? null} at={lot.latest.health?.at ?? null} />
        </section>
        {lot.sensors.length > 0 ? (
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-secondary">Capteurs du bâtiment</h2>
            <div className="grid grid-cols-2 gap-2">
              {lot.sensors.map((s) => (
                <Stamped key={s.label} label={s.label} value={`${fmt(s.value, 1)} ${unitLabel(s.unit)}`} at={s.at} />
              ))}
            </div>
          </section>
        ) : null}
        {snapshot?.can.enter ? (
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-secondary">Saisir</h2>
            <div className="grid grid-cols-2 gap-2">
              {ENTRY_BUTTONS.filter((b) => !b.care || snapshot.can.care).map((b) => (
                <button
                  key={b.kind}
                  type="button"
                  onClick={() => setEntry({ kind: b.kind, lotId: lot.id, transferId: null, title: lot.code, laying: lot.laying })}
                  className={`h-14 rounded-xl px-3 text-left text-base font-semibold ${b.care ? "border border-border bg-surface text-text" : "bg-bio-green text-white"}`}
                >
                  {FIELD_KIND_LABEL[b.kind]}
                </button>
              ))}
            </div>
          </section>
        ) : null}
        {lotOps.length > 0 ? (
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-secondary">Saisies de ce lot sur ce téléphone</h2>
            {lotOps.map((op) => (
              <div key={op.opId} className="rounded-xl border border-border bg-surface p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium">{op.summary}</span>
                  <Chip status={op.status} />
                </div>
                <p className="text-xs text-secondary">{clock(op.capturedAt)}</p>
                {op.message ? <p className="mt-1 text-xs text-text">{op.message}</p> : null}
              </div>
            ))}
          </section>
        ) : null}
      </div>
    );
  } else if (tab === "lots") {
    body = (
      <div className="flex flex-col gap-3 p-4">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Chercher un lot, une ferme…" className="h-12 rounded-lg border border-border bg-surface px-3 text-base" aria-label="Chercher un lot" />
        {lots.length === 0 ? <p className="text-sm text-secondary">Aucun lot actif dans votre périmètre.</p> : null}
        {lots.map((l) => {
          const waiting = ops.filter((op) => op.lotId === l.id && isPending(op)).length;
          return (
            <button key={l.id} type="button" onClick={() => setLotId(l.id)} className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-4 text-left">
              <div className="flex items-center justify-between gap-2">
                <span className="text-lg font-semibold text-ink">{l.code}</span>
                <span className="text-sm text-secondary">{fmt(l.currentPopulation)} sujets</span>
              </div>
              <span className="text-sm text-secondary">
                {l.farmName} · {l.buildingCode}
                {l.phaseLabel ? ` · ${l.phaseLabel}` : ""}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {l.onHold ? <span className="rounded-full border border-critical/30 bg-critical/10 px-2 py-0.5 text-xs font-semibold text-critical-strong">Bloqué</span> : null}
                {l.withdrawal ? <span className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-xs font-semibold text-warning-strong">Délai d&apos;attente</span> : null}
                {l.today.discrepancy ? <span className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-xs font-semibold text-warning-strong">Écart du jour</span> : null}
                {l.today.declared !== null ? <span className="rounded-full border border-border bg-background px-2 py-0.5 text-xs text-secondary">Morts aujourd&apos;hui : {fmt(l.today.declared)}</span> : null}
                {waiting > 0 ? <span className="rounded-full border border-info/30 bg-info/10 px-2 py-0.5 text-xs font-semibold text-info-strong">{waiting} en attente</span> : null}
              </div>
            </button>
          );
        })}
      </div>
    );
  } else if (tab === "scan") {
    body = (
      <div className="flex flex-col gap-4 p-4">
        <Scanner onCode={openCode} />
        {scan?.status === "BAD_CHECK" ? (
          <p role="alert" className="rounded-lg border border-critical/40 bg-critical/10 px-3 py-2 text-sm text-critical-strong">
            Code mal lu : {scan.code} a un caractère de contrôle faux. Relisez l&apos;étiquette ou nettoyez-la.
          </p>
        ) : null}
        {scan?.status === "UNKNOWN" ? (
          <p role="alert" className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning-strong">
            {scan.code} est inconnu sur ce téléphone{snapshot ? ` (données du ${clock(snapshot.generatedAt)})` : ""}. Synchronisez avec du réseau, puis relisez.
          </p>
        ) : null}
        {scan?.status === "FOUND" && scan.match.kind === "SUBJECT" ? <p className="rounded-lg border border-border bg-surface px-3 py-2 text-sm">{scan.match.label}</p> : null}
      </div>
    );
  } else if (tab === "receptions") {
    body = (
      <div className="flex flex-col gap-3 p-4">
        <p className="text-sm text-secondary">Transferts arrivant dans votre périmètre. Comptez, puis signez : l&apos;expéditeur a compté et signé au départ.</p>
        {receptions.length === 0 ? <p className="text-sm text-secondary">Aucun transfert à réceptionner.</p> : null}
        {receptions.map((r) => (
          <div key={r.id} className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4">
            <div className="flex items-center justify-between">
              <span className="font-semibold">{r.code}</span>
              <span className="text-sm text-secondary">{fmt(r.quantitySent)} envoyés</span>
            </div>
            <p className="text-sm text-secondary">{r.objectLabel}</p>
            <p className="text-sm text-secondary">
              {r.from} → {r.to}
            </p>
            <p className="text-xs text-secondary">
              Parti le {clock(r.sentAt)}, signé par {r.senderName}
            </p>
            {snapshot?.can.receive ? (
              <button type="button" onClick={() => setEntry({ kind: "RECEPTION", lotId: null, transferId: r.id, title: `Réception ${r.code}`, laying: false })} className="h-12 rounded-lg bg-bio-green text-base font-semibold text-white">
                Compter et signer
              </button>
            ) : null}
          </div>
        ))}
      </div>
    );
  } else {
    const list = [...ops].reverse();
    body = (
      <div className="flex flex-col gap-3 p-4">
        <p className="text-sm text-secondary">Tout ce qui a été saisi sur ce téléphone. Une saisie n&apos;est jamais effacée : refusée, elle reste ici avec la raison.</p>
        {list.length === 0 ? <p className="text-sm text-secondary">Aucune saisie pour l&apos;instant.</p> : null}
        {list.map((op) => {
          const lotCode = snapshot?.lots.find((l) => l.id === op.lotId)?.code;
          return (
            <div key={op.opId} className="rounded-xl border border-border bg-surface p-3 text-sm">
              <div className="flex items-start justify-between gap-2">
                <span className="font-semibold">{FIELD_KIND_LABEL[op.kind]}</span>
                <Chip status={op.status} />
              </div>
              <p>{op.summary}</p>
              <p className="text-xs text-secondary">
                {lotCode ? `${lotCode} · ` : ""}saisie le {clock(op.capturedAt)}
                {op.sentAt ? ` · reçue le ${clock(op.sentAt)}` : ""}
              </p>
              {op.message ? <p className="mt-1 text-xs text-text">{op.message}</p> : null}
            </div>
          );
        })}
      </div>
    );
  }

  const nav: { id: Tab; label: string; badge?: number }[] = [
    { id: "lots", label: "Lots" },
    { id: "scan", label: "Lire un code" },
    { id: "receptions", label: "Réceptions", badge: receptions.length },
    { id: "outbox", label: "Envois", badge: pendingMine },
  ];

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col bg-background">
      {header}
      {banners}
      <main className="flex-1 pb-24">{body}</main>
      <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)]" aria-label="Application terrain">
        <div className="mx-auto grid max-w-lg grid-cols-4">
          {nav.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => {
                setTab(n.id);
                setLotId(null);
                setScan(null);
              }}
              aria-current={tab === n.id ? "page" : undefined}
              className={`relative flex h-16 flex-col items-center justify-center text-xs font-semibold ${tab === n.id ? "text-bio-green" : "text-secondary"}`}
            >
              {n.label}
              {n.badge ? <span className="absolute right-3 top-2 rounded-full bg-gold px-1.5 text-[11px] text-deep-forest">{n.badge}</span> : null}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
