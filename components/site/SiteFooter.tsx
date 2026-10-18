import Link from "next/link";
import { BrandMark } from "./BrandMark";

export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="bg-bvu-darker py-10 text-[#e5eee8]">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap justify-between gap-8 px-4 sm:px-6">
        <div>
          <div className="flex items-center gap-3 font-extrabold">
            <BrandMark className="size-9 text-base" />
            BVU TECH
          </div>
          <p className="mt-3 text-sm text-bvu-on-dark">AgriTech B2B · Traçabilité · Pilotage opérationnel</p>
          <p className="mt-1 text-sm text-bvu-on-dark">Une activité de BIOVOLAILLES UNION SARL — Maroc</p>
        </div>
        <div className="flex flex-col gap-2 text-sm text-bvu-on-dark">
          <Link href="/mentions-legales" className="underline hover:text-white">
            Mentions légales
          </Link>
          <Link href="/confidentialite" className="underline hover:text-white">
            Politique de confidentialité
          </Link>
          <Link href="/login" className="underline hover:text-white">
            Espace client
          </Link>
        </div>
        <div className="max-w-sm text-sm text-bvu-on-dark">
          <p>© {year} BVU Tech. Tous droits réservés.</p>
          <p className="mt-2">
            Les visuels de démonstration sont conceptuels. Le périmètre opérationnel dépend du cadrage et des validations
            techniques.
          </p>
        </div>
      </div>
    </footer>
  );
}
