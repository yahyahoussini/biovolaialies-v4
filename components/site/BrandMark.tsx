export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`grid size-10 place-items-center rounded-xl bg-bvu-lime text-lg font-black text-bvu-dark ${className}`}
    >
      B
    </span>
  );
}
