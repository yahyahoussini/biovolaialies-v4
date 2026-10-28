# BIOVOLAILLES — Runbook de démonstration

Document interne à l'équipe de présentation. **Ne pas diffuser au jury** (contient les identifiants).

Toutes les valeurs de ce document ont été vérifiées contre le serveur de production local,
sur trois réamorçages successifs de la base, avec des résultats identiques au caractère près.

---

## 0. Avant la salle — préparation (10 min)

```bash
npm install                       # une seule fois
echo 'DEMO_MODE="true"' >> .env.local   # ⚠ OBLIGATOIRE — voir l'encadré ci-dessous
npm run build                     # une seule fois par version
npm run db:reset                  # ⚠ SERVEUR ARRÊTÉ (voir §7)
npm run start                     # http://localhost:3000
```

> ⚠ **Sans `DEMO_MODE="true"` dans `.env.local`, toutes les commandes de démonstration sont
> désactivées.** `npm run start` tourne en `NODE_ENV=production`, et par sécurité le produit
> coupe la réinitialisation et le rejeu d'anomalie en production. La page
> `/administration/demo` affiche alors un bandeau orange qui le rappelle. Le reste de la
> démonstration (consultation) fonctionne quand même — mais vous ne pourrez rien réinitialiser.

Puis ouvrir `/administration/demo` en tant qu'administrateur et vérifier :
**13 contrôles sur 13 « Conforme », 0 « À surveiller », 0 « En échec »**.
Tout autre résultat = ne pas présenter avant d'avoir réamorcé.

| Vérification | Attendu |
|---|---|
| Application démarre | `http://localhost:3000/login` répond |
| Base de données | 1 organisation · 3 coopératives · 7 producteurs · 8 fermes · 12 bâtiments · 12 lots · 6 utilisateurs |
| Lot héros | `BU-2026-001` — Ferme Al Baraka / BAT-01 · statut `CLOTURE` · 11 920 sujets |
| IoT | 1 appareil, 5 capteurs, 525 mesures sur BAT-01 |
| KPI | 5/6 calculables |
| Anomalies / alertes | 2 anomalies, 2 alertes `OPEN` sur le lot héros |
| Traçabilité | 6 nœuds, 5 relations |
| QR | 2 jetons actifs |
| Intégrité | 473/477 contrôles · **0 critique** · 4 avertissements volontaires |

---

## 1. Comptes de démonstration

Mot de passe **identique pour les sept comptes** : `Demo1234!`

| Rôle | Email | Périmètre |
|---|---|---|
| Administrateur | `admin@biovolailles.demo` | Global |
| Responsable coopérative | `coop.manager@biovolailles.demo` | Coopérative Al Baraka |
| Producteur | `producteur@biovolailles.demo` | Producteur |
| Responsable ferme | `ferme.manager@biovolailles.demo` | Ferme Al Baraka |
| Technicien | `technicien@biovolailles.demo` | Ferme Al Baraka |
| Auditeur | `auditeur@biovolailles.demo` | Global (lecture seule) |
| Responsable qualité | `qualite@biovolailles.demo` | Global — seul rôle (avec l'administrateur) habilité à lever un blocage qualité |

Les comptes ont été testés : mot de passe correct accepté, mot de passe erroné refusé.

**Éleveurs partenaires** (même mot de passe), utiles pour l'application terrain et les réceptions :
`partenaire.ouazzani@`, `aide.ouazzani@` (son aide, Hamid), `partenaire.cherkaoui@`, `partenaire.fassi@`,
`partenaire.elamrani@` — tous en `biovolailles.demo`, chacun limité à sa ferme.

**Application terrain** : `/terrain`, sur un téléphone (ou la vue mobile du navigateur). Se connecter une
fois avec du réseau ; ensuite elle s'ouvre et enregistre hors ligne, et envoie les saisies dans l'ordre au
retour du réseau. Le menu « Saisies terrain » montre côté bureau ce qui est arrivé, les refus avec leur
raison et le jour en écart sur OUA-2026-CF1 (Salma a compté 4 morts, Hamid 6) à arbitrer.

**Marquage des œufs** : `/marquage`, avec `partenaire.fassi@` (sa ligne seulement) ou l'administrateur.
La campagne **MQ-FA-20261018-1** est arrêtée par le contrôle de lecture (tête encrassée) : ouvrir la
campagne, « Lever l'arrêt » en disant ce qui a été fait, puis « Simuler 600 œufs » et « Simuler une tête
encrassée » pour voir la ligne s'arrêter d'elle-même. Un lien de plateau (BVU-PKG-…) ouvre la page publique
de l'œuf ; `/tracabilite/oeuf` accepte aussi le code imprimé sur une coquille (ex. le premier code d'un
relevé). Voie A : cycle **INC-2026-38** au couvoir, 497 rebuts du mirage identifiés par leur code.

---

## 2. ⚠ Le point à connaître avant de commencer

**Le tableau de bord du Responsable ferme affiche « Lots actifs : 0 » et « Population : 0 ».**

Ce n'est pas un bug. `BU-2026-001` est au statut `CLOTURE` — c'est *précisément pour cela*
qu'il possède un produit fini et un passeport public. L'autre lot de la ferme,
`BU-2026-002`, démarre le 01/09/2026. Les compteurs « actifs » ne comptent donc rien.

Deux façons de gérer ce moment — **choisir avant la présentation, pas pendant** :

**Option A — suivre le brief à la lettre (ouvrir en Responsable ferme).**
Assumer la phrase, elle devient un atout :
> « Ce lot vient de terminer son cycle — c'est exactement pour ça qu'on va pouvoir le
> suivre jusqu'au produit fini et au QR consommateur. Sept alertes restent ouvertes
> sur son historique : c'est par là qu'on commence. »

**Option B — ouvrir en Responsable coopérative (recommandé).**
Son périmètre **contient** la Ferme Al Baraka, donc la descente vers le lot héros est
identique, mais le tableau de bord ouvre sur une exploitation vivante :

| | Resp. ferme | Resp. coopérative |
|---|---|---|
| Lots actifs | **0** / 2 | **2** / 5 |
| Population | **0** | **13 895 sujets** |
| Alertes actives | 7 | 9 |
| IoT | 1/1 en ligne | 2/2 en ligne |

Passer ensuite en Responsable ferme à l'**étape 9** — c'est le rôle qui *doit* prendre
l'alerte en compte, ce qui rend le changement de rôle naturel au lieu d'être plaqué à la fin.

---

## 3. Parcours de démonstration — version 5 minutes (principale)

Chemin de clics vérifié de bout en bout. Ne jamais taper d'URL : les identifiants
techniques changent à chaque réamorçage, **les chemins de clics non**.

| # | Action | Ce qui doit s'afficher | Ce qu'on dit |
|---|---|---|---|
| 1 | Se connecter · **Tableau de bord** | Bandeau `DÉMO`, périmètre en haut, cartes d'état | « Un poste de pilotage, pas un tableau de bord décoratif. Tout ce qui suit vient de la base. » |
| 2 | **Fermes → Ferme Al Baraka** | 2 bâtiments, Kénitra | « L'exploitation physique : la ferme, ses bâtiments. » |
| 3 | **BAT-01** | État environnemental, `BU-2026-001` listé | « Le bâtiment, ses capteurs, le lot qu'il héberge. » |
| 4 | **IoT → DEV-B01-001** | Température, humidité, CO₂, lumière, poids · badge `Simulation` · « En direct » | « Cinq capteurs. Le badge dit *simulation* — nous ne prétendons pas avoir du matériel déployé. » |
| 5 | **Lot BU-2026-001** | 12 000 → **11 920 sujets**, statut, statut de données | « Voici l'objet central. Tout va s'accrocher à lui. » |
| 6 | Onglet **Performance** | 5 KPI calculés + tendance | « La donnée devient indicateur. » |
| 7 | Onglet **Alertes** → ouvrir l'alerte | Observée **14 844 kg** · Référence **11 844,7 kg** · Écart **+25,3 %** | « L'indicateur devient anomalie — avec la valeur observée, la référence, et l'écart. » |
| 8 | Même page, bloc **Explication** | Situation / Mesure / Fondement + action recommandée | « Le système explique *pourquoi*. Ce n'est pas une boîte noire. Ce lot mange 25 % de trop et sa croissance chute de 33 % — les deux conditions réunies, donc critique. » |
| 9 | **Prendre en compte** (+ commentaire) | Statut → `Prise en compte` | « L'alerte devient une action humaine tracée. » |
| 10 | Onglet **Événements** | Nouvel événement `ALERT_ACTION` | « Et cette action est entrée dans l'histoire du lot. » |
| 11 | Onglet **Traçabilité → Voir la traçabilité complète** | Chaîne : Lot → Collecte → Abattage → Transformation → Produit → Destination | « Amont, lot, aval — reconstitués depuis les relations réelles en base. » |
| 12 | Cliquer le nœud **Produit** | `BVU-PROD-2026-001` | « Le lot est devenu un produit. » |
| 13 | Onglet **QR / Passeport** → ouvrir le lien public | Page consommateur, mobile | « Voici ce que voit le consommateur en scannant. » |
| 14 | Rester sur la page publique | Aucun identifiant interne, aucun code de lot interne, mention « données de démonstration » | « Et voici ce qu'il **ne voit pas** : aucun identifiant, aucun coût, aucune alerte interne. Une seule fonction décide de ce qui est public. » |

**Points de pause** : après l'étape 8 (l'explication) et après l'étape 14 (la séparation
public/privé). Ce sont les deux moments où le jury comprend la valeur.

---

## 3 bis. Commandes présentateur — `/administration/demo`

Réservé au compte **Administrateur** (les cinq autres rôles reçoivent une redirection).
Trois blocs :

| Bloc | Ce qu'il fait |
|---|---|
| **État du système** | 13 contrôles réels de bout en bout. **Doit afficher 13/13 « Conforme » avant de présenter.** |
| **Parcours de démonstration** | Liens directs vers ferme → lot → alerte héros → traçabilité → passeport public → intégrité. Les liens pointent sur les enregistrements exacts, pas sur des listes. |
| **Rejouer le scénario d'anomalie** | `1 · Revenir à l'état normal` puis `2 · Déclencher l'écart`. |
| **Réinitialiser la démonstration** | Rejoue tout le scénario depuis zéro. |

**Rejeu d'anomalie — à quoi ça sert.** Par défaut le lot héros arrive avec son anomalie déjà
ouverte : parfait pour un parcours court. Si vous voulez montrer la séquence *se produire* :

1. Cliquez **Revenir à l'état normal** → BU-2026-001 n'a plus aucune anomalie. Sa chaîne de
   traçabilité, son QR et son historique IoT restent intacts. Montrez le lot : tout va bien.
2. Cliquez **Déclencher l'écart** → deux mesures réelles sont écrites (un excès d'aliment, une
   pesée en retrait), puis **le vrai moteur de règles s'exécute** et crée l'anomalie et l'alerte.
3. Ouvrez l'alerte : elle est critique, avec ses valeurs et son explication.

> Rien n'est pré-écrit : l'alerte est calculée par `services/intelligence/detection.ts` à partir
> des mesures persistées. C'est le même code qu'au moment du semis. Un double clic sur
> « Déclencher » ne fait rien de plus (garde d'idempotence).

> ⚠ « Revenir à l'état normal » **réamorce la base** et vous déconnecte des autres onglets.
> À faire avant de commencer, pas au milieu du parcours.

---

## 4. Version 3 minutes

Tableau de bord → Lot → IoT → Anomalie → Traçabilité → QR
(étapes **1, 5, 4, 7, 11, 13**).
Sauter : la ferme, le bâtiment, la prise en compte, les rôles, l'audit.

## 5. Version 10 minutes

Le parcours de 5 minutes, plus :

- **Provenance** — onglet Données, ouvrir la provenance d'une mesure (valeur, statut, source, appareil, bâtiment, lot, horodatage, méthode).
- **Rôles** — sélecteur en haut à droite : **Technicien** (4 modules seulement : Lots, IoT, Anomalies, Alertes) puis **Auditeur** (voit tout, ne peut rien modifier — le bouton de prise en compte disparaît).
- **Audit** — `/audit`, filtrer par lot : chaque mutation avec acteur, avant/après, motif.
- **Intégrité** — `/integrite` : 473/477 contrôles passés, **0 critique** (voir §8).
- **Marquage** — `/marquage` : lever l'arrêt de MQ-FA-20261018-1, simuler une tête encrassée, puis ouvrir un plateau sur le téléphone (page publique).

---

## 6. Ce qu'il ne faut PAS expliquer

- L'architecture des dépôts, Drizzle, la structure du schéma — sauf question directe.
- Le détail du moteur de règles (seuils, fenêtres). Dire « règles explicites et versionnées », pas la formule.
- Le code des contrôles d'intégrité (T01…T27) — parler de « 477 contrôles automatiques ».
- Ne **jamais** dire « IA » ni « machine learning ». Le système applique des règles explicites,
  et c'est un argument de confiance, pas une faiblesse : chaque alerte est explicable ligne à ligne.

---

## 7. Réinitialisation de la démonstration

**Deux mécanismes — ne pas les confondre.**

| | En cours de démonstration | Avant / après |
|---|---|---|
| Où | `/administration/demo` → « Réinitialiser » | Terminal : `npm run db:reset` |
| Serveur | **Doit tourner** | **Doit être arrêté** |
| Effet | Vide les tables et réamorce | Supprime le fichier et réamorce |

> ⚠ **`npm run db:reset` échoue (`EBUSY`) si le serveur tourne** — sous Windows le fichier
> SQLite est verrouillé. Pendant la démonstration, utiliser **uniquement** la réinitialisation
> dans l'application.

**Après toute réinitialisation, toutes les sessions ouvertes sont invalidées** (la table des
utilisateurs est recréée). Il faut se reconnecter — y compris dans les autres onglets.
La réinitialisation depuis l'écran d'administration reconnecte automatiquement l'administrateur.

Vérifié : après une prise en compte d'alerte puis réinitialisation, l'état revient
exactement au point de départ (2 alertes `OPEN`, 6 événements, 0 action).

**Les URL de passeport public sont stables** et survivent aux réinitialisations — un QR
imprimé à l'avance reste valide :

- Lot : `/tracabilite/qj3nAI3lfRg_k6BlmfLU8OKcVejnTjMd`
- Produit : `/tracabilite/8y7Vt4vG0tZKO6aRW_vJiBSMFr_qCdyF`
- Produit **vérifié** (`BU-2025-010`) : `/tracabilite/mkefCofewwrhsq_DRUh-iMOaK1trWEwO`

Le troisième est le seul passeport qui affiche **« Traçabilité vérifiée »** — voir §8 c).

En revanche, les identifiants internes (URL de lot, de ferme…) **changent** à chaque
réamorçage : naviguer par clics, ne pas préparer de favoris.

---

## 8. Résultats attendus — et les deux points à assumer

**Deux constats vont apparaître à l'écran. Les connaître à l'avance.**

**a) `/integrite` affiche 0 problème critique et 4 avertissements.**
C'est l'état attendu de la version candidate : **aucun problème critique nulle part**. Les
4 avertissements sont volontaires — des imperfections de qualité semées sur `BU-2026-003`
(pesée à confirmer) et `BU-2026-005` (source d'eau manquante), pour que le moteur ait
quelque chose de vrai à trouver. Réponse si la question vient :
> « Zéro problème critique. Les quatre avertissements sont volontaires : nous avons laissé
> des imperfections de qualité dans le jeu de données pour montrer que le moteur les trouve.
> Un tableau à 100 % signifierait que le contrôle ne cherche rien. »

**b) Le KPI « Indice de consommation » (FCR) affiche « Donnée insuffisante ».**
C'est un choix assumé : le système refuse de calculer un indicateur qu'il ne peut pas
justifier. Réponse :
> « Le système préfère dire *je n'ai pas assez de données* plutôt que d'afficher un chiffre
> non fondé. C'est le même principe que les badges de statut sur chaque valeur. »

**c) Le passeport « vérifié » — la réponse à « et quand c'est vérifié, ça donne quoi ? »**

Le lot héros est en `SIMULATION`, donc son passeport dit **« Traçabilité non vérifiée »**.
C'est volontaire, mais seul, cela ne montre qu'une moitié du produit. `BU-2025-010` — un
cycle clôturé en janvier 2026 dont la chaîne aval a été confirmée (`VALIDE` de bout en bout)
— montre l'autre moitié :

| | Passeport héros (`BVU-PROD-2026-001`) | Passeport vérifié (`BVU-PROD-2025-010`) |
|---|---|---|
| Verdict | Traçabilité **non** vérifiée · *En attente de validation* | **Traçabilité vérifiée** · *Vérifié* |
| Bandeau « données de démonstration » | affiché | **absent** |
| Étapes (Origine → Conditionnement) | grises, « non vérifiée » | **toutes vertes** |

À dire :
> « Le statut public n'est pas décoratif : il reflète l'état réel de la donnée. Ce lot-ci est
> simulé, donc le système refuse de le certifier. Celui-là a été confirmé, donc il l'affiche. »

> ⚠ Une nuance à connaître : sur le passeport **produit**, la dernière ligne « Statut actuel »
> reprend le statut du **lot** (`Cycle clôturé`), pas celui du produit — elle reste donc grise
> même quand l'en-tête dit « vérifiée ». Un lot ne lit « vérifié » qu'au statut `LIBERE`, que
> le cycle de vie n'atteint que depuis `BLOQUE` (levée de blocage), jamais depuis `CLOTURE`.

Autres valeurs de référence (identiques à chaque réamorçage) :

| Élément | Valeur |
|---|---|
| Population | 12 000 → 11 920 |
| Poids moyen (j26) | 1,15 kg — volontairement sous le standard Ross 308 (~1,40 kg) : c'est l'anomalie |
| Aliment consommé (7 j) | 9 804 kg |
| Eau consommée (7 j) | 10 627,2 L |
| Taux de mortalité | 0 % |
| Anomalie 1 | `Consommation d'aliment anormalement élevée` — Avertissement · 14 844 vs 11 844,7 kg · +25,3 % |
| Anomalie 2 | `Dégradation de performance` — **Critique** · croissance à −32,8 % (seuil d'escalade : −20 %) |
| Chaîne de traçabilité | 13 708 kg collectés → 9 596 kg carcasses (rendement 70 %) → 8 636 kg produit (90 %) |
| Contrôles d'intégrité | 473 / 477 (99 %) · **0 critique** · 4 avertissements volontaires |
| Passeport public | « Traçabilité non vérifiée » + « données de démonstration » |

> La page publique affiche **« Traçabilité non vérifiée »**. C'est volontaire et honnête :
> les données sont simulées, donc le système refuse de certifier la chaîne. À dire tel quel —
> c'est la preuve que le statut public reflète l'état réel et n'est pas décoratif.

---

## 9. Sécurité de la démonstration

- **Aucune dépendance réseau.** Aucun appel HTTP sortant dans le code applicatif ; la police
  Inter est auto-hébergée à la compilation. **La démonstration fonctionne hors ligne.**
- Base de données SQLite locale, aucun service cloud, aucune API tierce, aucune IA externe.
- Le simulateur IoT est **déterministe** (bruit dérivé d'un hachage, jamais `Math.random`) et
  la lecture « en direct » est un **calcul pur qui n'écrit jamais en base** : il ne peut donc
  pas altérer la fenêtre d'anomalie ni le scénario.

---

## 10. Si quelque chose casse

| Symptôme | Cause probable | Action (dans l'ordre) |
|---|---|---|
| **Boutons de démo grisés** | `DEMO_MODE` absent | `echo 'DEMO_MODE="true"' >> .env.local` puis relancer `npm run start` |
| **La connexion échoue** | Base non amorcée, ou mauvais mot de passe | Vérifier §1 ; sinon serveur arrêté → `npm run db:reset` → `npm run start` |
| **Page de connexion en boucle** | Session invalidée par une réinitialisation | Se reconnecter (la réinit. recrée les comptes) |
| **La base ne répond pas** | Fichier verrouillé ou absent | Arrêter le serveur, `npm run db:reset`, relancer |
| **`EBUSY` sur `db:reset`** | Serveur en cours d'exécution | Arrêter le serveur, ou utiliser la réinitialisation dans l'app |
| **Le semis échoue** | Base partiellement écrite | `npm run db:reset` (supprime le fichier et rejoue tout) |
| **L'anomalie n'apparaît pas** | Lot héros en état « normal » | `/administration/demo` → **Déclencher l'écart** ; sinon **Réinitialiser** |
| **L'alerte n'est pas ouverte** | Déjà prise en compte lors d'une répétition | `/administration/demo` → **Réinitialiser** |
| **Le QR ne charge pas** | Jeton révoqué ou base réamorcée | Reprendre l'URL depuis l'onglet **QR / Passeport** du lot, ou depuis §7 (elles sont stables) |
| **L'IoT semble figé** | Lecture « en direct » en pause (onglet masqué) | Revenir sur l'onglet : le relevé reprend au cycle suivant (15 s) |
| **Un écran affiche une erreur** | — | Noter la **référence** affichée, revenir au tableau de bord, continuer |
| **Le lot héros a disparu** | Base non amorcée | `/administration/demo` → **Réinitialiser** |
| **Navigateur incohérent** (état bizarre, boutons morts) | Hydratation ou session périmée | Recharger la page ; sinon fenêtre de navigation privée + reconnexion |
| **Doute général avant de commencer** | — | `/administration/demo` : **13/13 « Conforme »** |

**Reprise complète (~90 s), quand tout est douteux :**

```bash
# arrêter le serveur (Ctrl+C), puis :
npm run db:reset && npm run start
```
Se reconnecter en Administrateur, ouvrir `/administration/demo`, vérifier 13/13, repartir.

**Règle d'or** : en cas d'incident, ne pas déboguer devant le jury. Revenir au tableau de
bord, reprendre le récit, réinitialiser à la pause.
