/** A plain GET form: works without JavaScript, on any phone. */
export function EggLookupForm({ defaultValue = "" }: { defaultValue?: string }) {
  return (
    <form action="/tracabilite/oeuf" method="get" className="flex flex-col gap-2">
      <label htmlFor="code-oeuf" className="text-sm font-semibold text-text">
        Code imprimé sur la coquille
      </label>
      <div className="flex gap-2">
        <input
          id="code-oeuf"
          name="code"
          defaultValue={defaultValue}
          required
          maxLength={40}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          placeholder="ex. FA00B4K7Q"
          className="h-12 min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 font-mono text-base uppercase tracking-wider"
        />
        <button type="submit" className="h-12 rounded-lg bg-bio-green px-4 text-base font-semibold text-white">
          Vérifier
        </button>
      </div>
      <p className="text-caption text-secondary">Neuf caractères. Les espaces et les tirets ne comptent pas ; O se lit 0, I et L se lisent 1.</p>
    </form>
  );
}
