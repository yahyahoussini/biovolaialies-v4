"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Label } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import type { MachineComparison } from "@/domain/telemetry/machine-compare";
import {
  decodeLogBytes,
  guessProfile,
  headerFor,
  isSampleLog,
  LOG_TIME_ZONE_LABEL,
  LOG_TIME_ZONES,
  parseLog,
  TIME_FORMATS,
  type Delimiter,
  type LogProfile,
  type LogTimeZone,
  type TimeFormat,
} from "@/domain/telemetry/machine-log";
import type { MachineImport } from "@/domain/telemetry/types";

export interface ImportTargetOption {
  zoneId: string;
  label: string;
  channels: { sensorType: string; label: string }[];
  lastProfile: LogProfile | null;
}

interface Loaded {
  file: File;
  text: string;
  encoding: string;
  header: string[];
  numericColumns: string[];
  assumedDayFirst: boolean;
  reusedProfile: boolean;
}

interface ImportOutcome {
  record: MachineImport;
  flagged: Record<string, number>;
  comparison: MachineComparison | null;
}

const DELIMITERS: { value: Delimiter; label: string }[] = [
  { value: ";", label: "Point-virgule ( ; )" },
  { value: ",", label: "Virgule ( , )" },
  { value: "\t", label: "Tabulation" },
];
const when = (v: string | null) => (v ? new Date(v).toLocaleString("fr-FR", { timeZone: "Africa/Casablanca", dateStyle: "short", timeStyle: "short" }) : "—");
const sameColumns = (p: LogProfile, header: string[]) => [...p.timeColumns, ...Object.values(p.channels)].every((c) => header.includes(c));

/**
 * The file is read in the browser with the same reader the server uses, so the preview is what
 * will be stored; only the confirmed profile and the file itself are sent. The server reads the
 * bytes again — the preview decides nothing.
 */
export function MachineLogImport({ targets, maxBytes, demo }: { targets: ImportTargetOption[]; maxBytes: number; demo: boolean }) {
  const router = useRouter();
  const [zoneId, setZoneId] = useState(targets[0]?.zoneId ?? "");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [profile, setProfile] = useState<LogProfile | null>(null);
  const [dataStatus, setDataStatus] = useState(demo ? "SIMULATION" : "REEL");
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const [pending, startTransition] = useTransition();
  const target = targets.find((t) => t.zoneId === zoneId);

  const preview = useMemo(() => (loaded && profile ? parseLog(loaded.text, profile) : null), [loaded, profile]);
  const sample = loaded ? isSampleLog(loaded.text) : false;

  async function read(file: File) {
    setError(null);
    setOutcome(null);
    if (file.size > maxBytes) {
      setLoaded(null);
      setError(`Fichier trop volumineux : ${Math.round(file.size / 1024)} Ko pour ${maxBytes / 1024 / 1024} Mo au plus. Exportez une période plus courte.`);
      return;
    }
    const { text, encoding } = decodeLogBytes(new Uint8Array(await file.arrayBuffer()));
    const guess = guessProfile(text);
    // A machine always writes the same way: its last confirmed profile is offered again when the columns match.
    const reuse = target?.lastProfile && guess.header.length > 0 && sameColumns(target.lastProfile, guess.header) ? target.lastProfile : null;
    setLoaded({ file, text, encoding, header: guess.header, numericColumns: guess.numericColumns, assumedDayFirst: !reuse && guess.assumedDayFirst, reusedProfile: !!reuse });
    setProfile(reuse ?? guess.profile);
    if (isSampleLog(text)) setDataStatus("SIMULATION");
  }

  function update(patch: Partial<LogProfile>) {
    if (profile) setProfile({ ...profile, ...patch });
  }

  /** Another separator splits the header differently: the columns offered are re-read, and choices that no longer exist are dropped. */
  function changeDelimiter(delimiter: Delimiter) {
    if (!loaded || !profile) return;
    const header = headerFor(loaded.text, delimiter);
    setLoaded({ ...loaded, header, numericColumns: [] });
    setProfile({
      ...profile,
      delimiter,
      timeColumns: profile.timeColumns.filter((c) => header.includes(c)),
      channels: Object.fromEntries(Object.entries(profile.channels).filter(([, c]) => header.includes(c))),
    });
  }

  function setChannel(sensorType: string, column: string) {
    if (!profile) return;
    const channels = { ...profile.channels };
    if (column) channels[sensorType] = column;
    else delete channels[sensorType];
    update({ channels });
  }

  function submit() {
    if (!loaded || !profile) return;
    setError(null);
    startTransition(async () => {
      const form = new FormData();
      form.set("zoneId", zoneId);
      form.set("dataStatus", dataStatus);
      form.set("profile", JSON.stringify(profile));
      form.set("file", loaded.file);
      try {
        const response = await fetch("/api/journaux-machine", { method: "POST", body: form });
        const body = await response.json();
        if (!response.ok) {
          setError(body.error ?? "Import refusé.");
          return;
        }
        setOutcome(body as ImportOutcome);
        setLoaded(null);
        setProfile(null);
        router.refresh();
      } catch {
        setError("Le serveur n'a pas répondu : rien n'a été importé, vous pouvez réessayer.");
      }
    });
  }

  if (targets.length === 0) return <p className="text-sm text-secondary">Aucun incubateur avec une voie machine dans votre périmètre.</p>;

  const columns = loaded?.header ?? [];
  const twoColumns = (profile?.timeColumns.length ?? 0) === 2;
  const unmapped = loaded ? loaded.numericColumns.filter((c) => !Object.values(profile?.channels ?? {}).includes(c)) : [];
  const canSubmit = !!preview && preview.rows.length > 0 && !pending && !(sample && dataStatus === "REEL");

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="mi-zone">Incubateur</Label>
          <Select
            id="mi-zone"
            value={zoneId}
            onChange={(e) => {
              setZoneId(e.target.value);
              setLoaded(null);
              setProfile(null);
              setOutcome(null);
            }}
          >
            {targets.map((t) => (
              <option key={t.zoneId} value={t.zoneId}>
                {t.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="mi-file">Journal exporté par la machine (CSV ou texte)</Label>
          <input
            id="mi-file"
            type="file"
            accept=".csv,.txt,.log,text/csv,text/plain"
            className="text-sm"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void read(file);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {error ? (
        <p role="alert" className="rounded-lg border border-critical/40 bg-critical/10 px-4 py-3 text-sm text-critical-strong">
          {error}
        </p>
      ) : null}

      {loaded && profile && preview ? (
        <div className="flex flex-col gap-4 rounded-lg border border-border p-4">
          <p className="text-sm text-secondary">
            <span className="font-semibold text-text">{loaded.file.name}</span> — {Math.round(loaded.file.size / 1024).toLocaleString("fr-FR")} Ko, encodage {loaded.encoding}
            {loaded.reusedProfile ? " · profil du dernier import de cette machine repris" : " · profil deviné à partir du fichier, à vérifier"}.
          </p>
          {preview.preamble.length ? (
            <p className="text-caption text-secondary">
              Lignes de la machine au-dessus de l&apos;en-tête, non lues comme données : {preview.preamble.map((l) => `« ${l} »`).join(" ")}
            </p>
          ) : null}

          <div className="grid gap-3 md:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mi-delimiter">Séparateur</Label>
              <Select id="mi-delimiter" value={profile.delimiter} onChange={(e) => changeDelimiter(e.target.value as Delimiter)}>
                {DELIMITERS.map((d) => (
                  <option key={d.label} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mi-decimal">Séparateur décimal</Label>
              <Select id="mi-decimal" value={profile.decimal} onChange={(e) => update({ decimal: e.target.value as LogProfile["decimal"] })}>
                <option value=",">Virgule (37,6)</option>
                <option value=".">Point (37.6)</option>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mi-format">Format de date</Label>
              <Select id="mi-format" value={profile.timeFormat} onChange={(e) => update({ timeFormat: e.target.value as TimeFormat })}>
                {TIME_FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {f === "ISO" ? "ISO 8601 (2026-09-22T10:00)" : f}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mi-time-1">{twoColumns ? "Colonne date" : "Colonne horodatage"}</Label>
              <Select id="mi-time-1" value={profile.timeColumns[0] ?? ""} onChange={(e) => update({ timeColumns: [e.target.value, ...profile.timeColumns.slice(1)].filter(Boolean) })}>
                <option value="">—</option>
                {columns.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mi-time-2">Colonne heure (si séparée)</Label>
              <Select id="mi-time-2" value={profile.timeColumns[1] ?? ""} onChange={(e) => update({ timeColumns: [profile.timeColumns[0] ?? "", e.target.value].filter(Boolean) })}>
                <option value="">— date et heure dans la même colonne</option>
                {columns.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mi-zone-time">Horloge de la machine</Label>
              <Select id="mi-zone-time" value={profile.timeZone} onChange={(e) => update({ timeZone: e.target.value as LogTimeZone })}>
                {LOG_TIME_ZONES.map((z) => (
                  <option key={z} value={z}>
                    {LOG_TIME_ZONE_LABEL[z]}
                  </option>
                ))}
              </Select>
            </div>
            {target?.channels.map((ch) => (
              <div key={ch.sensorType} className="flex flex-col gap-1.5">
                <Label htmlFor={`mi-ch-${ch.sensorType}`}>Colonne « {ch.label} »</Label>
                <Select id={`mi-ch-${ch.sensorType}`} value={profile.channels[ch.sensorType] ?? ""} onChange={(e) => setChannel(ch.sensorType, e.target.value)}>
                  <option value="">— non importée</option>
                  {columns.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </div>
            ))}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mi-status">Nature des données</Label>
              <Select id="mi-status" value={dataStatus} onChange={(e) => setDataStatus(e.target.value)}>
                <option value="REEL" disabled={sample}>
                  Réelles
                </option>
                <option value="TEST">Essai</option>
                <option value="SIMULATION">Simulation</option>
              </Select>
            </div>
          </div>

          {loaded.assumedDayFirst ? (
            <p className="text-caption text-warning-strong">Aucune date du fichier ne distingue le jour du mois : jour en premier supposé (JJ/MM), comme sur les machines françaises. Vérifiez sur une ligne connue.</p>
          ) : null}
          {sample ? <p className="text-caption text-warning-strong">Fichier d&apos;exemple de la plateforme : il ne peut être importé que comme simulation.</p> : null}
          {unmapped.length ? <p className="text-caption text-secondary">Colonnes numériques lues mais non stockées (aucune voie déclarée) : {unmapped.join(", ")}.</p> : null}

          <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
            <Fact label="Lignes de données" value={preview.lines.toLocaleString("fr-FR")} />
            <Fact label="Lignes lisibles" value={preview.rows.length.toLocaleString("fr-FR")} />
            <Fact label="Lignes non lues" value={(preview.lines - preview.rows.length).toLocaleString("fr-FR")} tone={preview.lines > preview.rows.length ? "warning" : undefined} />
            <Fact label="Période" value={preview.from ? `${when(preview.from)} → ${when(preview.to)}` : "—"} />
          </div>

          {preview.rows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-caption">
                <caption className="sr-only">Premières lignes lues</caption>
                <thead>
                  <tr className="text-secondary">
                    <th className="py-1 pr-4 font-semibold">Ligne</th>
                    <th className="py-1 pr-4 font-semibold">Horodatage (heure du Maroc)</th>
                    {Object.keys(profile.channels).map((c) => (
                      <th key={c} className="py-1 pr-4 font-semibold">
                        {target?.channels.find((ch) => ch.sensorType === c)?.label ?? c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 6).map((r) => (
                    <tr key={r.line} className="border-t border-border">
                      <td className="py-1 pr-4">{r.line}</td>
                      <td className="py-1 pr-4">{when(r.at)}</td>
                      {Object.keys(profile.channels).map((c) => (
                        <td key={c} className="py-1 pr-4">
                          {r.values[c]?.toLocaleString("fr-FR") ?? "—"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {preview.errors.length ? (
            <details className="text-caption">
              <summary className="cursor-pointer font-semibold text-warning-strong">
                {preview.errors.length >= 200 ? "200 premières lignes non lues" : `${preview.errors.length} ligne(s) non lue(s)`} — elles seront signalées, pas ignorées
              </summary>
              <ul className="mt-2 flex flex-col gap-0.5 text-secondary">
                {preview.errors.slice(0, 20).map((e) => (
                  <li key={`${e.line}-${e.message}`}>
                    Ligne {e.line} : {e.message}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={submit} loading={pending} disabled={!canSubmit}>
              Importer {preview.rows.length.toLocaleString("fr-FR")} lignes
            </Button>
            <p className="text-caption text-secondary">Le même fichier ne peut pas être importé deux fois ; une période déjà en base n&apos;est pas réécrite.</p>
          </div>
        </div>
      ) : null}

      {outcome ? <Outcome outcome={outcome} /> : null}
    </div>
  );
}

function Fact({ label, value, tone }: { label: string; value: string; tone?: "warning" }) {
  return (
    <div className="flex flex-col">
      <span className="text-caption text-secondary">{label}</span>
      <span className={tone === "warning" ? "font-semibold text-warning-strong" : "font-semibold"}>{value}</span>
    </div>
  );
}

function Outcome({ outcome }: { outcome: ImportOutcome }) {
  const { record, comparison } = outcome;
  const flagged = Object.values(outcome.flagged).reduce((a, b) => a + b, 0);
  return (
    <div role="status" className="flex flex-col gap-2 rounded-lg border border-success/40 bg-success/10 px-4 py-3 text-sm">
      <p className="font-semibold text-success-strong">
        {record.accepted.toLocaleString("fr-FR")} mesures enregistrées
        {record.duplicates ? `, ${record.duplicates.toLocaleString("fr-FR")} déjà en base` : ""}
        {record.rejected ? `, ${record.rejected.toLocaleString("fr-FR")} lignes non lues` : ""}
        {flagged ? `, ${flagged.toLocaleString("fr-FR")} signalées` : ""}.
      </p>
      {comparison ? (
        <p>
          Comparaison horaire avec les sondes indépendantes : {comparison.hours.length} heures comparées,{" "}
          {comparison.beyond ? (
            <strong className="text-critical-strong">
              {comparison.beyond} au-delà de {comparison.tolerance.toLocaleString("fr-FR")} °C, à partir de {when(comparison.firstBeyondAt)}
            </strong>
          ) : (
            `aucune au-delà de ${comparison.tolerance.toLocaleString("fr-FR")} °C`
          )}
          .
        </p>
      ) : null}
      <p className="break-all font-mono text-caption text-secondary">SHA-256 du fichier reçu : {record.sha256}</p>
      <Link className="focus-ring w-fit font-medium text-bio-green hover:underline" href={`/telemetrie/journaux-machine/${record.id}`}>
        Voir l&apos;import et la comparaison heure par heure
      </Link>
    </div>
  );
}
