import { Egg } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { EggLookupForm } from "./EggLookupForm";

export const metadata: Metadata = {
  title: "Vérifier un œuf — BIOVOLAILLES",
  description: "Saisissez le code imprimé sur la coquille pour connaître l'origine de l'œuf.",
};

export default async function EggLookupPage({ searchParams }: PageProps<"/tracabilite/oeuf">) {
  const { code } = await searchParams;
  const value = typeof code === "string" ? code.trim() : "";
  if (value) redirect(`/tracabilite/oeuf/${encodeURIComponent(value)}`);
  return (
    <>
      <header className="bg-deep-forest px-5 pb-9 pt-8 text-center text-white">
        <div className="mx-auto flex size-10 items-center justify-center rounded-full bg-white/10">
          <Egg className="size-5" aria-hidden="true" />
        </div>
        <p className="mt-3 text-caption font-semibold uppercase tracking-widest text-white/70">BIOVOLAILLES</p>
        <h1 className="mt-1.5 text-2xl font-semibold tracking-tight">Vérifier un œuf</h1>
      </header>
      <main className="mx-auto flex max-w-md flex-col gap-6 px-5 py-8">
        <EggLookupForm />
        <p className="text-sm leading-relaxed text-secondary">Le code est imprimé sur la coquille à la ferme, puis relu par une caméra. Le QR du plateau mène directement à cette page.</p>
      </main>
    </>
  );
}
