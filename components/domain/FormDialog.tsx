"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/Dialog";
import { Input, Label } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import type { PublicError } from "@/domain/shared/errors";

export interface FormField {
  name: string;
  label: string;
  type: "text" | "number" | "date" | "datetime-local" | "select" | "textarea";
  required?: boolean;
  placeholder?: string;
  defaultValue?: string;
  options?: { value: string; label: string }[];
  /** Fields sharing a row are laid out side by side. */
  half?: boolean;
  hint?: string;
}

export interface FormActionResult {
  ok: boolean;
  error?: PublicError;
  redirectTo?: string;
}

/**
 * One data-entry dialog for the many small creation forms of the hatchery, shipment and
 * equipment screens. The server action receives plain strings; parsing and validation stay on
 * the server, in the service's own zod schema — the dialog never decides what is valid.
 */
export function FormDialog({
  title,
  description,
  triggerLabel,
  triggerVariant = "primary",
  fields,
  action,
  submitLabel = "Enregistrer",
}: {
  title: string;
  description?: string;
  triggerLabel: string;
  triggerVariant?: "primary" | "secondary" | "ghost" | "destructive";
  fields: FormField[];
  action: (values: Record<string, string>) => Promise<FormActionResult>;
  submitLabel?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(form: FormData) {
    setError(null);
    const values: Record<string, string> = {};
    for (const field of fields) values[field.name] = String(form.get(field.name) ?? "");
    startTransition(async () => {
      const result = await action(values);
      if (!result.ok) {
        setError(result.error?.message ?? "Enregistrement impossible.");
        return;
      }
      setOpen(false);
      if (result.redirectTo) router.push(result.redirectTo);
      else router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant={triggerVariant}>
          <Plus className="size-4" aria-hidden="true" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <form action={submit} className="grid grid-cols-2 gap-3">
          {fields.map((field) => {
            const id = `fd-${field.name}`;
            return (
              <div key={field.name} className={`flex flex-col gap-1.5 ${field.half ? "col-span-2 sm:col-span-1" : "col-span-2"}`}>
                <Label htmlFor={id}>
                  {field.label}
                  {field.required ? " *" : ""}
                </Label>
                {field.type === "select" ? (
                  <Select id={id} name={field.name} required={field.required} defaultValue={field.defaultValue ?? ""}>
                    {!field.defaultValue ? (
                      <option value="" disabled>
                        Sélectionner…
                      </option>
                    ) : null}
                    {field.options?.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                ) : field.type === "textarea" ? (
                  <textarea id={id} name={field.name} required={field.required} defaultValue={field.defaultValue} rows={3} placeholder={field.placeholder} className="rounded-md border border-border bg-surface px-3 py-2 text-sm" />
                ) : (
                  <Input id={id} name={field.name} type={field.type} required={field.required} defaultValue={field.defaultValue} placeholder={field.placeholder} step={field.type === "number" ? "any" : undefined} />
                )}
                {field.hint ? <p className="text-xs text-secondary">{field.hint}</p> : null}
              </div>
            );
          })}
          {error ? (
            <p role="alert" className="col-span-2 rounded-md bg-critical/10 px-3 py-2 text-xs text-critical-strong">
              {error}
            </p>
          ) : null}
          <div className="col-span-2 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Enregistrement…" : submitLabel}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
