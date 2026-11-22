# Guide de démonstration et de formation

Instance de démonstration : **https://biovolailles.brandhubos.cloud** — données entièrement fictives.
Les comptes sont listés dans la [note de livraison](README.md) ; le mot de passe commun est communiqué à part.
Ce que vous saisissez ici peut être effacé à tout moment.

## 1. Se connecter

1. Ouvrir `/login`, saisir l'adresse d'un compte de démonstration et le mot de passe.
2. Le bandeau « DÉMO » rappelle que les données sont fictives.
3. **Changer de rôle** : menu en haut à droite. C'est une vraie reconnexion au compte du rôle choisi :
   chaque rôle ne voit que son périmètre et ne fait que ce que son rôle permet.

## 2. Le parcours principal : le lot BU-2026-001 (environ 5 minutes)

À savoir avant de commencer : la ferme Al Baraka affiche « Lots actifs : 0 ». Ce n'est pas une erreur :
`BU-2026-001` est clôturé — c'est pour cela qu'il a un produit fini et un passeport public — et l'autre lot,
`BU-2026-002`, démarre le 01/09/2026.

| # | Où cliquer | Ce que l'on voit |
|---|---|---|
| 1 | **Tableau de bord** | Périmètre en haut, cartes d'état |
| 2 | **Fermes → Ferme Al Baraka** | 2 bâtiments, Kénitra |
| 3 | **BAT-01** | État environnemental, le lot `BU-2026-001` |
| 4 | **IoT → DEV-B01-001** | Température, humidité, CO₂, lumière, poids — badge « Simulation » |
| 5 | **Lot BU-2026-001** | 12 000 → 11 920 sujets, statut du lot, statut des données |
| 6 | Onglet **Performance** | Indicateurs calculés et tendance. L'indice de consommation affiche « Donnée insuffisante » : le système refuse de publier un indicateur qu'il ne peut pas justifier |
| 7 | Onglet **Alertes** → ouvrir l'alerte | Observée 14 844 kg · Référence 11 844,7 kg · Écart +25,3 % |
| 8 | Bloc **Explication** | Situation, mesure, fondement, action recommandée |
| 9 | **Prendre en compte** (avec un commentaire) | L'alerte passe à « Prise en compte » |
| 10 | Onglet **Événements** | L'action est entrée dans l'histoire du lot |
| 11 | Onglet **Traçabilité → Voir la traçabilité complète** | Lot → Collecte → Abattage → Transformation → Produit → Destination |
| 12 | Nœud **Produit** | `BVU-PROD-2026-001` |
| 13 | Onglet **QR / Passeport** → lien public | La page que voit le consommateur en scannant |
| 14 | Sur la page publique | Aucun identifiant interne : seuls les champs publics approuvés apparaissent |

Si l'alerte a déjà été prise en compte, l'Administrateur la rejoue : `/administration/demo` →
« Revenir à l'état normal », puis « Déclencher l'écart ».

## 3. Les rôles à essayer

- **Auditeur** : lit tout, ne modifie rien.
- **Responsable qualité** : seul à pouvoir lever un blocage qualité, avec justification et preuve.
- **Vétérinaire** : registre sanitaire (vaccinations, traitements et délais d'attente, observations).
- **Responsable couvoir** : incubation, mirage, éclosion.
- **Direction** : lit tout, n'opère rien.

## 4. L'application terrain sur téléphone

1. Sur le téléphone, ouvrir `/terrain` et se connecter **une fois avec du réseau**, par exemple avec
   `partenaire.ouazzani@biovolailles.demo`.
2. Ensuite, l'application s'ouvre et enregistre **sans réseau** : mortalité, pesée, aliment, eau,
   vaccination, traitement, observation, réception de transfert. Chaque saisie porte son auteur et son heure.
3. Au retour du réseau, les saisies partent dans l'ordre du téléphone ; une saisie envoyée deux fois n'est
   comptée qu'une fois.
4. Côté bureau, le menu **Saisies terrain** montre ce qui est arrivé, les refus et leur raison, et le jour en
   écart sur le lot `OUA-2026-CF1` (Salma a compté 4 morts, Hamid 6). Arbitrez-le avec le compte
   **Administrateur** : ce jour date du 27/10/2026 et, au-delà de 30 jours, seul l'administrateur arbitre.

## 5. Le marquage des œufs (simulé)

Avec `partenaire.fassi@biovolailles.demo` ou l'Administrateur : `/marquage`. La campagne
`MQ-FA-20261018-1` a été arrêtée par le contrôle de lecture (tête encrassée). Ouvrir la campagne,
« Lever l'arrêt » en disant ce qui a été fait, puis « Simuler 600 œufs ».

## 6. Que faire d'une alerte

1. Ouvrir l'alerte et lire l'explication : ce qui a été mesuré, la référence, l'écart.
2. Agir sur place, puis cliquer **Prendre en compte** et décrire l'action : elle est datée, signée et
   ajoutée à l'histoire du lot.
3. Une alerte non prise en compte monte au niveau suivant (responsable, puis administrateur).
4. **La plateforme n'est pas le système de sécurité de l'élevage** : en cas d'urgence (chaleur, panne de
   ventilation), c'est l'alarme GSM autonome qui prévient.

## Version pilote — sur l'instance réelle, pas sur la démonstration

Changement de mot de passe et connexion en deux étapes (« Mon compte »), réinitialisation par
l'administrateur, création et import de votre structure d'élevages : ces fonctions sont développées et
s'utilisent sur l'instance réelle, installée séparément de la démonstration. Voir la
[note de livraison](README.md).
