import type { Metadata } from "next";
import { LegalPage, ToComplete } from "@/components/site/LegalPage";

export const metadata: Metadata = { title: "Politique de confidentialité" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Politique de confidentialité" updated="octobre 2026">
      <section>
        <h2>Responsable du traitement</h2>
        <p>
          BIOVOLAILLES UNION SARL (BVU Tech), <ToComplete>adresse du siège</ToComplete>. Contact pour toute question
          relative à vos données : <ToComplete>adresse e-mail dédiée</ToComplete>.
        </p>
      </section>
      <section>
        <h2>Cadre légal</h2>
        <p>
          Les traitements sont réalisés conformément à la loi n° 09-08 relative à la protection des personnes physiques à
          l&apos;égard du traitement des données à caractère personnel et à ses textes d&apos;application. Les formalités
          auprès de la Commission nationale de contrôle de la protection des données à caractère personnel (CNDP) :{" "}
          <ToComplete>référence de déclaration ou d&apos;autorisation</ToComplete>.
        </p>
      </section>
      <section>
        <h2>Données collectées par le formulaire de contact</h2>
        <ul>
          <li>Entreprise, nom du contact, adresse e-mail professionnelle (obligatoires)</li>
          <li>Téléphone et capacité ou volume d&apos;activité (facultatifs)</li>
          <li>Activité et description de votre besoin (obligatoires)</li>
          <li>Date de la demande et version du texte de consentement accepté</li>
        </ul>
        <p>Aucune donnée n&apos;est collectée à votre insu : le site ne dépose pas de cookie publicitaire ni de traceur tiers.</p>
      </section>
      <section>
        <h2>Finalité et base du traitement</h2>
        <p>
          Ces données servent uniquement à traiter votre demande, à qualifier un éventuel projet et à assurer le suivi de
          la relation commerciale qui en découle. Le traitement repose sur votre consentement, recueilli par la case à
          cocher du formulaire.
        </p>
      </section>
      <section>
        <h2>Destinataires</h2>
        <p>
          Les données sont accessibles aux seules personnes de BVU Tech habilitées au suivi commercial. Elles ne sont ni
          vendues ni cédées. Les prestataires techniques (hébergement, et le cas échéant envoi d&apos;e-mails de
          notification interne) n&apos;y accèdent que pour l&apos;exécution de leur service :{" "}
          <ToComplete>liste des prestataires et pays d&apos;hébergement</ToComplete>.
        </p>
      </section>
      <section>
        <h2>Durée de conservation</h2>
        <p>
          <ToComplete>durée retenue, par exemple trois ans après le dernier contact</ToComplete>. Au-delà, les données
          sont supprimées ou anonymisées.
        </p>
      </section>
      <section>
        <h2>Vos droits</h2>
        <p>
          Conformément à la loi n° 09-08, vous disposez d&apos;un droit d&apos;accès, de rectification et
          d&apos;opposition au traitement de vos données. Vous pouvez l&apos;exercer en écrivant à{" "}
          <ToComplete>adresse e-mail dédiée</ToComplete>, en précisant l&apos;adresse utilisée lors de votre demande.
        </p>
      </section>
    </LegalPage>
  );
}
