import type { Metadata } from "next";
import { LegalPage, ToComplete } from "@/components/site/LegalPage";

export const metadata: Metadata = { title: "Mentions légales" };

export default function LegalNoticePage() {
  return (
    <LegalPage title="Mentions légales" updated="octobre 2026">
      <section>
        <h2>Éditeur du site</h2>
        <p>
          BVU Tech est une activité de BIOVOLAILLES UNION SARL, société à responsabilité limitée de droit marocain.
        </p>
        <ul>
          <li>
            Siège social : <ToComplete>adresse du siège</ToComplete>
          </li>
          <li>
            Registre du commerce : <ToComplete>ville et numéro RC</ToComplete>
          </li>
          <li>
            Identifiant commun de l&apos;entreprise (ICE) : <ToComplete>numéro ICE</ToComplete>
          </li>
          <li>
            Capital social : <ToComplete>montant</ToComplete>
          </li>
          <li>
            Directeur de la publication : <ToComplete>nom et fonction</ToComplete>
          </li>
          <li>
            Contact : <ToComplete>adresse e-mail et téléphone</ToComplete>
          </li>
        </ul>
      </section>
      <section>
        <h2>Hébergement</h2>
        <p>
          <ToComplete>nom, adresse et contact de l&apos;hébergeur retenu</ToComplete>
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
