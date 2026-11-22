# BIOVOLAILLES — Note de livraison

**Date :** [À COMPLÉTER : date] · **Version livrée :** démonstration et formation (données fictives)

## Ce qui est livré aujourd'hui

- La plateforme BIOVOLAILLES, en **instance de démonstration et de formation**, hébergée sur le serveur
  (VPS) de BVU Tech : **https://biovolailles.brandhubos.cloud**
- Un scénario complet sur **données entièrement fictives** : élevage, mesures, alertes, qualité,
  traçabilité jusqu'au passeport QR public, application terrain sur téléphone.
- **15 comptes de démonstration** : un par rôle (10) et 5 éleveurs partenaires. Le mot de passe commun
  vous est communiqué **séparément** (il ne figure dans aucun document).
- Le **sélecteur de rôle** (barre du haut) : il fait passer d'un rôle à l'autre par une vraie reconnexion,
  pour voir ce que chaque profil voit et peut faire.
- Les documents de ce dossier (liste en fin de note).

## Première connexion

1. Ouvrir **https://biovolailles.brandhubos.cloud/login**.
2. Se connecter avec `admin@biovolailles.demo` (Administrateur) et le mot de passe communiqué à part.
3. Suivre le parcours de démonstration : [03-guide-demarrage.md](03-guide-demarrage.md).
4. Sur un téléphone : **https://biovolailles.brandhubos.cloud/terrain**, avec un compte d'éleveur partenaire
   (par exemple `partenaire.ouazzani@biovolailles.demo`).

| Rôle | Compte |
|---|---|
| Administrateur | `admin@biovolailles.demo` |
| Responsable coopérative | `coop.manager@biovolailles.demo` |
| Producteur | `producteur@biovolailles.demo` |
| Responsable ferme | `ferme.manager@biovolailles.demo` |
| Technicien | `technicien@biovolailles.demo` |
| Auditeur | `auditeur@biovolailles.demo` |
| Responsable qualité | `qualite@biovolailles.demo` |
| Direction | `direction@biovolailles.demo` |
| Responsable couvoir | `couvoir@biovolailles.demo` |
| Vétérinaire | `veterinaire@biovolailles.demo` |
| Éleveurs partenaires | `partenaire.ouazzani@`, `aide.ouazzani@`, `partenaire.cherkaoui@`, `partenaire.fassi@`, `partenaire.elamrani@` (tous en `biovolailles.demo`) |

## Ce qui est réel, ce qui est simulé

- **Toutes les données sont fictives** : fermes, lots, mesures, anomalies, produits, passeports QR.
- **Capteurs, ligne de marquage des œufs, incubateurs : simulés.** Aucun équipement réel n'est raccordé.
- Le passeport public affiche « Traçabilité non vérifiée » : c'est voulu, les données ne sont pas réelles.
- Les dates du scénario sont figées (août à octobre 2026) : certains écrans indiquent « rien de saisi
  aujourd'hui », c'est normal.
- **Ce que vous saisissez pendant la formation peut être effacé** : l'instance de démonstration est
  réinitialisable à tout moment.

## Pas encore inclus — prochaine version : pilote sur données réelles

- Installation propre, sans aucune donnée de démonstration, avec votre premier compte administrateur.
- « Mon compte » : changement de mot de passe et connexion en deux étapes (application d'authentification),
  obligatoire pour les rôles Administrateur, Responsable qualité et Direction.
- Réinitialisation d'un mot de passe ou de la connexion en deux étapes par l'administrateur.
- « Structure des élevages » : création de vos organisations, coopératives, producteurs, fermes et
  bâtiments, et import depuis un tableur (modèle à remplir dans `modeles/`).
- Envoi des alertes par e-mail (fournisseur à configurer). SMS et appels : non intégrés ; l'alarme GSM
  autonome reste le canal d'urgence.
- Raccordement des capteurs, de la ligne de marquage et des incubateurs : seulement après les essais au banc
  (FAT) puis sur site (SAT) de chaque équipement.
- Déclaration auprès de la CNDP (loi 09-08) et mentions légales complètes du site.

## Prochaines étapes

1. **Vous :** nous renvoyer vos décisions ([01-decisions-client.md](01-decisions-client.md)) et les modèles
   remplis (`modeles/`) avant le [À COMPLÉTER : date].
2. **BVU Tech :** livrer la version pilote (installation propre, comptes sécurisés, structure de vos élevages).
3. **Ensemble :** démarrer le pilote sur une ferme, en saisie manuelle uniquement, registres papier tenus en
   parallèle ([02-checklist-pilote.md](02-checklist-pilote.md)).

## Contact support

[À COMPLÉTER : nom, téléphone, e-mail, jours et heures de support]

## Documents du dossier

| Fichier | Contenu |
|---|---|
| [01-decisions-client.md](01-decisions-client.md) | Les décisions attendues de votre part, chacune avec un choix par défaut |
| [02-checklist-pilote.md](02-checklist-pilote.md) | La liste de contrôle avant, pendant et après le pilote |
| [03-guide-demarrage.md](03-guide-demarrage.md) | Le guide de démonstration et de formation |
| [04-projet-convention-pilote.md](04-projet-convention-pilote.md) | Projet de convention de pilote — à faire relire par un juriste |
| [05-preparation-cndp.md](05-preparation-cndp.md) | Préparation de la déclaration CNDP — à faire relire par un juriste |
| [06-message-client.md](06-message-client.md) | Le message d'accompagnement |
| `modeles/` | Modèles à remplir : structure des élevages, utilisateurs, lots en cours |
