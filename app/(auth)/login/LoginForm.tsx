"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Leaf } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import { FieldMessage, Input, Label } from "@/components/ui/Input";
import { signInStepPath } from "@/lib/sign-in-steps";
import { loginAction } from "./actions";

const loginSchema = z.object({
  email: z.string().trim().min(1, "Email requis.").email("Adresse email invalide."),
  password: z.string().min(1, "Mot de passe requis."),
});
type LoginFormValues = z.infer<typeof loginSchema>;

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({ resolver: zodResolver(loginSchema) });

  async function onSubmit(values: LoginFormValues) {
    setFormError(null);
    const result = await loginAction(values.email, values.password);
    if (!result.ok) {
      setFormError(result.error?.message ?? "Connexion impossible.");
      return;
    }
    router.push(signInStepPath(result.next ?? "DONE", next));
    router.refresh();
  }

  return (
    <Card className="w-full max-w-sm shadow-sm">
      <CardContent className="flex flex-col gap-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex size-11 items-center justify-center rounded-full bg-bio-green/10 text-bio-green">
            <Leaf className="size-5" aria-hidden="true" />
          </div>
          <h1 className="text-section-title">BIOVOLAILLES</h1>
          <p className="text-caption text-secondary">Connectez-vous à votre espace opérationnel.</p>
        </div>

        <form className="flex flex-col gap-4" onSubmit={handleSubmit(onSubmit)} noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="nom@biovolailles.demo"
              // aria-invalid drives both the red border and the screen-reader announcement,
              // and describedby points at the message so it is read with the field.
              aria-invalid={errors.email ? true : undefined}
              aria-describedby={errors.email ? "email-error" : undefined}
              {...register("email")}
            />
            {errors.email ? (
              <FieldMessage id="email-error" tone="error">
                {errors.email.message}
              </FieldMessage>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">Mot de passe</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              aria-invalid={errors.password ? true : undefined}
              aria-describedby={errors.password ? "password-error" : undefined}
              {...register("password")}
            />
            {errors.password ? (
              <FieldMessage id="password-error" tone="error">
                {errors.password.message}
              </FieldMessage>
            ) : null}
          </div>

          {formError ? (
            <p
              role="alert"
              className="rounded-md border border-critical/25 bg-critical/10 px-3 py-2 text-caption font-medium text-critical-strong"
            >
              {formError}
            </p>
          ) : null}

          <Button type="submit" loading={isSubmitting} className="mt-1">
            {isSubmitting ? "Connexion…" : "Se connecter"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
