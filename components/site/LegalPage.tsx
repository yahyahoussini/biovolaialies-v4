import type { ReactNode } from "react";

export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <article className="mx-auto w-full max-w-3xl px-4 py-14 sm:px-6">
      <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{title}</h1>
      <p className="mt-2 text-sm text-bvu-muted">Dernière mise à jour : {updated}</p>
      <div className="mt-8 flex flex-col gap-6 leading-relaxed [&_h2]:text-xl [&_h2]:font-bold [&_li]:ml-5 [&_li]:list-disc [&_p]:text-bvu-ink/90">
        {children}
      </div>
    </article>
  );
}

/** Visibly marks information only the company itself can supply — never invented here. */
export function ToComplete({ children }: { children: ReactNode }) {
  return <mark className="rounded bg-bvu-lime/60 px-1 font-semibold text-bvu-dark">[À compléter : {children}]</mark>;
}
