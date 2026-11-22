import type { Metadata } from "next";
import { connection } from "next/server";
import { LegalPage, LegalValue } from "@/components/site/LegalPage";

export const metadata: Metadata = { title: "Mentions légales" };

export default async function LegalNoticePage() {
  // The LEGAL_* values are read when the page is served, not frozen into the build.
  await connection();
  return (
    <LegalPage title="Mentions légales" updated="octobre 2026">
      <section>
        <h2>Éditeur du site</h2>
        <p>
          BVU Tech est une activité de BIOVOLAILLES UNION SARL, société à responsabilité limitée de droit marocain.
        </p>
        <ul>
          <li>
            Siège social : <LegalValue field="ADDRESS">adresse du siège</LegalValue>
          </li>
          <li>
            Registre du commerce : <LegalValue field="RC">ville et numéro RC</LegalValue>
          </li>
          <li>
            Identifiant commun de l&apos;entreprise (ICE) : <LegalValue field="ICE">numéro ICE</LegalValue>
          </li>
          <li>
            Capital social : <LegalValue field="CAPITAL">montant</LegalValue>
          </li>
          <li>
            Directeur de la publication : <LegalValue field="DIRECTOR">nom et fonction</LegalValue>
          </li>
          <li>
            Contact : <LegalValue field="CONTACT">adresse e-mail et téléphone</LegalValue>
          </li>
        </ul>
      </section>
      <section>
        <h2>Hébergement</h2>
        <p>
          <LegalValue field="HOST">nom, adresse et contact de l&apos;hébergeur retenu</LegalValue>
        </p>
      </section>
      <section>
        <h2>Contenu et démonstrations</h2>
        <p>
          Les visuels et le démonstrateur présentés sur ce site reposent sur des données simulées. Ils illustrent des
          fonctionnalités logicielles et ne constituent ni une validation industrielle sur site, ni un engagement de
          compatibilité avec un équipement donné. Le périmètre opérationnel d&apos;un projet est arrêté après cadrage et
          validations techniques.
        </p>
      </section>
      <section>
        <h2>Propriété intellectuelle</h2>
        <p>
          Les textes, éléments graphiques et logiciels présentés sur ce site sont la propriété de BIOVOLAILLES UNION SARL
          ou font l&apos;objet d&apos;une autorisation d&apos;utilisation. Toute reproduction sans autorisation préalable
          est interdite.
        </p>
      </section>
      <section>
        <h2>Données personnelles</h2>
        <p>
          Le traitement des informations transmises par le formulaire de contact est décrit dans la{" "}
          <a href="/confidentialite" className="font-semibold text-bvu-green underline">
            politique de confidentialité
          </a>
          .
        </p>
      </section>
    </LegalPage>
  );
}
