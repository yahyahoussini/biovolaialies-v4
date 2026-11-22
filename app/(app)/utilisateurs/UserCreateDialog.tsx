"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/Dialog";
import { Input, Label } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { ROLE, SCOPE_TYPE, type ScopeType } from "@/domain/shared/enums";
import { ROLE_LABEL, SCOPE_TYPE_LABEL } from "@/lib/labels";
import { createUserAction } from "./actions";

type ScopeTarget = { id: string; label: string };
type ScopeTargets = Record<"ORGANIZATION" | "COOPERATIVE" | "PRODUCER" | "FARM", ScopeTarget[]>;

const formSchema = z.object({
  email: z.string().trim().email("Email invalide."),
  fullName: z.string().trim().min(1, "Requis."),
  role: z.enum(ROLE),
  password: z.string().refine((v) => v === "" || v.length >= 8, "8 caractères minimum, ou laisser vide."),
});
type FormValues = z.infer<typeof formSchema>;

export function UserCreateDialog({ scopeTargets }: { scopeTargets: ScopeTargets }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<{ userId: string; temporaryPassword: string } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [scopeType, setScopeType] = useState<ScopeType>("GLOBAL");
  const [scopeId, setScopeId] = useState("");
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { role: "TECHNICIAN" },
  });

  const targets = scopeType === "GLOBAL" ? [] : scopeTargets[scopeType];

  async function onSubmit(values: FormValues) {
    setFormError(null);
    const result = await createUserAction({
      ...values,
      scopeType,
      scopeId: scopeType === "GLOBAL" ? null : scopeId || null,
    });
    if (!result.ok) {
      setFormError(result.error?.message ?? "Impossible de créer l'utilisateur.");
      return;
    }
    reset();
    setScopeType("GLOBAL");
    setScopeId("");
    if (result.data!.temporaryPassword) {
      setCreated({ userId: result.data!.userId, temporaryPassword: result.data!.temporaryPassword });
      return;
    }
    setOpen(false);
    router.push(`/utilisateurs/${result.data!.userId}`);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" aria-hidden="true" />
          Nouvel utilisateur
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Créer un utilisateur</DialogTitle>
          <DialogDescription>Compte, rôle et périmètre d&apos;accès.</DialogDescription>
        </DialogHeader>
        {created ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-text">
              Compte créé. Mot de passe provisoire, affiché une seule fois — à remettre à la personne, qui le remplacera par le sien à sa première connexion :
            </p>
            <p className="rounded-md border border-border bg-background p-3 text-center font-mono text-lg text-text">{created.temporaryPassword}</p>
            <Button
              type="button"
              onClick={() => {
                const target = created.userId;
                setCreated(null);
                setOpen(false);
                router.push(`/utilisateurs/${target}`);
              }}
            >
              J&apos;ai noté le mot de passe
            </Button>
          </div>
        ) : (
        <form className="flex flex-col gap-4" onSubmit={handleSubmit(onSubmit)} noValidate>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="fullName">
                Nom complet
              </Label>
              <Input id="fullName" {...register("fullName")} />
              {errors.fullName ? <p className="text-xs text-critical-strong">{errors.fullName.message}</p> : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">
                Email
              </Label>
              <Input id="email" type="email" {...register("email")} />
              {errors.email ? <p className="text-xs text-critical-strong">{errors.email.message}</p> : null}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">
              Mot de passe provisoire (laisser vide pour le générer)
            </Label>
            <Input id="password" type="password" {...register("password")} />
            {errors.password ? <p className="text-xs text-critical-strong">{errors.password.message}</p> : null}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="role">
                Rôle
              </Label>
              <Select id="role" {...register("role")}>
                {ROLE.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="scopeType">
                Type de périmètre
              </Label>
              <Select
                id="scopeType"
                value={scopeType}
                onChange={(e) => {
                  setScopeType(e.target.value as ScopeType);
                  setScopeId("");
                }}
              >
                {SCOPE_TYPE.map((s) => (
                  <option key={s} value={s}>
                    {SCOPE_TYPE_LABEL[s]}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {scopeType !== "GLOBAL" ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="scopeId">
                Périmètre
              </Label>
              <Select id="scopeId" value={scopeId} onChange={(e) => setScopeId(e.target.value)}>
                <option value="" disabled>
                  Sélectionner…
                </option>
                {targets.map((target) => (
                  <option key={target.id} value={target.id}>
                    {target.label}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}

          {formError ? (
            <p role="alert" className="rounded-md bg-critical/10 px-3 py-2 text-xs text-critical-strong">
              {formError}
            </p>
          ) : null}

          <Button type="submit" disabled={isSubmitting} className="mt-1">
            Créer l&apos;utilisateur
          </Button>
        </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
