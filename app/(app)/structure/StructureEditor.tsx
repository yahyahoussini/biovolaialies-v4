"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormAlert } from "@/components/account/FormAlert";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import type { StructureLevel, StructureTree } from "@/services/identity/structure";
import { createStructureAction, updateStructureAction } from "./actions";
import { CHILD_OF, LEVEL_FIELDS, LEVEL_LABEL, type FieldSpec } from "./fields";

export type Rights = Record<StructureLevel, { create: boolean; edit: boolean }>;
type Values = Record<string, string>;

const ZONE_LABEL: Record<string, string> = { ELEVAGE: "Élevage", COUVOIR: "Couvoir", STOCKAGE: "Stockage", AUTRE: "Autre" };
const ORG_LABEL: Record<string, string> = { INTERNAL: "Interne", COOPERATIVE: "Coopérative", PRODUCER_GROUP: "Groupement de producteurs" };

function toPayload(fields: FieldSpec[], values: Values): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const raw = (values[f.key] ?? "").trim();
    if (f.kind === "number") out[f.key] = raw === "" ? undefined : Number(raw.replace(/\s/g, ""));
    else if (f.kind === "decimal") out[f.key] = raw === "" ? null : Number(raw.replace(",", "."));
    else out[f.key] = raw;
  }
  return out;
}

function LevelForm({ level, mode, targetId, initial, onDone }: { level: StructureLevel; mode: "create" | "edit"; targetId: string | null; initial: Values; onDone: () => void }) {
  const router = useRouter();
  const fields = LEVEL_FIELDS[level];
  const [values, setValues] = useState<Values>(() => Object.fromEntries(fields.map((f) => [f.key, initial[f.key] ?? (f.kind === "select" ? f.options![0].value : "")])));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const payload = toPayload(fields, values);
    const result = mode === "create" ? await createStructureAction(level, targetId, payload) : await updateStructureAction(level, targetId!, payload);
    setPending(false);
    if (!result.ok) return setError(result.error?.message ?? "Enregistrement impossible.");
    onDone();
    router.refresh();
  }

  return (
    <form className="mt-3 flex flex-col gap-3 rounded-md border border-border bg-background p-3" onSubmit={submit} noValidate>
      <p className="text-caption font-semibold text-text">{mode === "create" ? `Nouveau / nouvelle ${LEVEL_LABEL[level]}` : `Modifier : ${LEVEL_LABEL[level]}`}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((f) => {
          const id = `${mode}-${level}-${targetId ?? "root"}-${f.key}`;
          return (
            <div key={f.key} className="flex flex-col gap-1">
              <Label htmlFor={id}>
                {f.label}
                {f.required ? " *" : ""}
              </Label>
              {f.kind === "select" ? (
                <select
                  id={id}
                  className="h-10 rounded-md border border-border bg-surface px-3 text-sm text-text"
                  value={values[f.key]}
                  onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                >
                  {f.options!.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : (
                <Input id={id} inputMode={f.kind === "text" ? undefined : "decimal"} value={values[f.key]} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />
              )}
              {f.hint ? <span className="text-micro text-secondary">{f.hint}</span> : null}
            </div>
          );
        })}
      </div>
      <FormAlert message={error} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={pending}>
          Enregistrer
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Annuler
        </Button>
      </div>
    </form>
  );
}

function Node({ level, id, title, subtitle, initial, rights, children }: { level: StructureLevel; id: string; title: string; subtitle: string; initial: Values; rights: Rights; children?: React.ReactNode }) {
  const [open, setOpen] = useState<"edit" | "add" | null>(null);
  const child = CHILD_OF[level];
  return (
    <li className="rounded-md border border-border bg-surface p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text">{title}</p>
          {subtitle ? <p className="text-micro text-secondary">{subtitle}</p> : null}
        </div>
        <div className="flex flex-wrap gap-1">
          {rights[level].edit ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(open === "edit" ? null : "edit")}>
              Modifier
            </Button>
          ) : null}
          {child && rights[child].create ? (
            <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(open === "add" ? null : "add")}>
              Ajouter : {LEVEL_LABEL[child]}
            </Button>
          ) : null}
        </div>
      </div>
      {open === "edit" ? <LevelForm level={level} mode="edit" targetId={id} initial={initial} onDone={() => setOpen(null)} /> : null}
      {open === "add" && child ? <LevelForm level={child} mode="create" targetId={id} initial={{}} onDone={() => setOpen(null)} /> : null}
      {children ? <ul className="mt-3 flex flex-col gap-2 border-l border-border pl-3">{children}</ul> : null}
    </li>
  );
}

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v).replace(".", ","));

export function StructureEditor({ tree, rights }: { tree: StructureTree; rights: Rights }) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      {rights.organization.create ? (
        <div>
          <Button type="button" onClick={() => setAdding(!adding)}>
            Nouvelle organisation
          </Button>
          {adding ? <LevelForm level="organization" mode="create" targetId={null} initial={{}} onDone={() => setAdding(false)} /> : null}
        </div>
      ) : null}
      {tree.organizations.length === 0 ? <p className="text-sm text-secondary">Aucune structure : commencez par une organisation, ou importez le fichier de structure.</p> : null}
      <ul className="flex flex-col gap-3">
        {tree.organizations.map((o) => (
          <Node key={o.id} level="organization" id={o.id} title={o.name} subtitle={ORG_LABEL[o.type] ?? o.type} initial={{ name: o.name, type: o.type }} rights={rights}>
            {o.cooperatives.length
              ? o.cooperatives.map((c) => (
                  <Node key={c.id} level="cooperative" id={c.id} title={c.name} subtitle={c.region} initial={{ name: c.name, region: c.region }} rights={rights}>
                    {c.producers.length
                      ? c.producers.map((p) => (
                          <Node
                            key={p.id}
                            level="producer"
                            id={p.id}
                            title={p.name}
                            subtitle={[p.contactPhone, p.contactEmail].filter(Boolean).join(" · ")}
                            initial={{ name: p.name, contactPhone: p.contactPhone ?? "", contactEmail: p.contactEmail ?? "" }}
                            rights={rights}
                          >
                            {p.farms.length
                              ? p.farms.map((f) => (
                                  <Node
                                    key={f.id}
                                    level="farm"
                                    id={f.id}
                                    title={f.name}
                                    subtitle={`${f.city} — ${f.region} · ${f.buildings.length} bâtiment(s)`}
                                    initial={{ name: f.name, city: f.city, region: f.region, geoLat: str(f.geoLat), geoLng: str(f.geoLng) }}
                                    rights={rights}
                                  >
                                    {f.buildings.length
                                      ? f.buildings.map((b) => (
                                          <Node
                                            key={b.id}
                                            level="building"
                                            id={b.id}
                                            title={`${b.code} — ${b.name}`}
                                            subtitle={`${ZONE_LABEL[b.zoneType] ?? b.zoneType} · ${b.capacity.toLocaleString("fr-FR")} sujets`}
                                            initial={{ code: b.code, name: b.name, capacity: String(b.capacity), zoneType: b.zoneType }}
                                            rights={rights}
                                          />
                                        ))
                                      : null}
                                  </Node>
                                ))
                              : null}
                          </Node>
                        ))
                      : null}
                  </Node>
                ))
              : null}
          </Node>
        ))}
      </ul>
    </div>
  );
}
