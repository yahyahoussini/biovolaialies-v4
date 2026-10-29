# BIOVOLAILLES — Présentation complète

## Produit · Métier · Technique — pour jury technique et non technique

Ce document explique **le même produit à deux niveaux de profondeur**. Chaque section est en
deux volets :

- 🟢 **NIVEAU 1 — Pour tous.** Sans vocabulaire technique. Ce que ça fait et pourquoi ça compte.
- 🔵 **NIVEAU 2 — Pour les jurés techniques.** Comment c'est construit, et ce qui le prouve.

Un juré non technique peut lire uniquement les blocs verts et comprendre l'intégralité du
projet. Un juré technique lit les deux.

> **Engagement de véracité.** Chaque affirmation de ce document a été vérifiée contre le code
> et contre un build de production, le 2026-08-18. Ce qui est simulé est marqué **[SIMULÉ]**.
> Ce qui n'existe pas encore est marqué **[À VENIR]**. Rien n'est présenté comme fait s'il ne
> l'est pas.

---

# 1. L'idée centrale

## 🟢 NIVEAU 1

Aujourd'hui, élever des poulets et vendre du poulet sont deux mondes séparés par du papier.

L'éleveur note ses chiffres dans un cahier. Le vétérinaire regarde le bâtiment. L'abattoir
tient son propre registre. Le consommateur, lui, ne sait rien — il achète une barquette.

**BIOVOLAILLES relie tout ça autour d'un seul objet : le lot.**

Un lot, c'est un groupe d'oiseaux qui vivent ensemble dans un bâtiment, du premier jour
jusqu'à l'abattage. Chez nous, ce lot porte tout :

> ce qu'il a mangé et bu · ce que les capteurs ont mesuré · comment il a grandi ·
> les problèmes détectés · ce que l'humain a décidé de faire · ce qu'il est devenu ·
> et le QR code que le consommateur scanne au bout.

**Une seule chaîne, un seul système :**

```
PRODUCTION → DONNÉE → IoT → PERFORMANCE → INTELLIGENCE
   → ACTION HUMAINE → TRAÇABILITÉ → PRODUIT
```

## 🔵 NIVEAU 2

Le lot (`lots`) est la clé étrangère qui relie huit familles d'entités : mesures structurées
(aliment, eau, pesée, mortalité, environnement), mesures IoT, valeurs de KPI, anomalies,
alertes, actions, événements, et le graphe de traçabilité aval.

Ce n'est pas un choix cosmétique : c'est ce qui rend possible la question à laquelle un ERP
classique ne répond pas — *« ce produit dans ma main, qu'a-t-il mangé le 12 août, et qui a
décidé quoi quand une alerte s'est déclenchée ? »*

79 tables · 10 rôles · 22 règles · 6 KPI · 19 types de contrôle d'intégrité · 104 routes ·
640 tests automatisés.

---

# 2. Le problème

## 🟢 NIVEAU 1

Quatre problèmes concrets, observés dans la filière :

| Problème | Ce que ça donne sur le terrain |
|---|---|
| **Information éparpillée** | Le cahier de l'éleveur, le tableur du technicien, le registre de l'abattoir : trois vérités |
| **Peu de visibilité en cours d'élevage** | On sait qu'un lot s'est mal passé *après* l'abattage |
| **Détection tardive** | Une surconsommation d'aliment se voit sur la facture, pas le jour où elle commence |
| **Traçabilité qui s'arrête à la ferme** | Le consommateur n'a aucun moyen de vérifier l'origine |

> ⚠ **Honnêteté** : ce constat vient de l'observation du secteur, **pas d'une étude terrain
> chiffrée**. Nous ne citerons aucun pourcentage de marché que nous ne pouvons pas sourcer.

## 🔵 NIVEAU 2

Traduit en exigences techniques, ces quatre problèmes deviennent :

1. **Un modèle de données unique** avec une hiérarchie de périmètre, plutôt que des fichiers.
2. **De la donnée horodatée avec provenance**, pas des totaux mensuels.
3. **Un moteur de règles qui tourne sur la donnée en continu**, pas un rapport de fin de cycle.
4. **Un graphe de relations amont/aval** avec une frontière publique explicite.

---

# 3. Ce que nous avons construit

## 🟢 NIVEAU 1

Une application web complète, qui fonctionne, et que nous allons vous montrer en direct.

**Ce qu'on peut y faire aujourd'hui :**

- Se connecter avec six profils métier différents, et voir des choses différentes
- Suivre une ferme, ses bâtiments, ses lots
- Voir les capteurs d'un bâtiment et leurs mesures **[SIMULÉ]**
- Consulter les indicateurs de performance d'un lot
- Recevoir une alerte quand quelque chose déraille — **avec l'explication du pourquoi**
- Prendre l'alerte en compte : la décision humaine est enregistrée
- Remonter toute la chaîne, de l'élevage jusqu'au produit fini
- Scanner un QR et voir la page publique du produit
- Consulter le journal de tout ce qui a été modifié, par qui, et pourquoi

## 🔵 NIVEAU 2

**Pile technique** — Next.js 16 (App Router), React 19, TypeScript strict, Drizzle ORM,
SQLite/libSQL, iron-session, Zod, Tailwind v4. Aucune dépendance réseau à l'exécution.

**Découpage en couches, vérifié :**

```
app/          30 pages, 30 composants client — Server Components par défaut
  │           écritures : toujours via un service (vérifié : 0 écriture directe depuis app/)
  │           lectures d'écran : via la couche dépôt, jamais de SQL dans une page
services/     13 modules de cas d'usage — le seul endroit qui orchestre
  │
domain/       règles pures — vérifié : 0 import de data/ ou services/
  │           permissions · règles métier · qualité · cycle de vie · relations
data/         dépôts Drizzle + schéma + jeu de démonstration déterministe
```

**Surface réelle** : 339 fonctions de service exportées. 87 fichiers de test, 640 tests.

---

# 4. Qui utilise le produit

## 🟢 NIVEAU 1

Six métiers, plus le consommateur. Chacun voit ce qui le concerne — **et rien d'autre**.

| Profil | Ce qu'il voit | Ce qu'il peut faire |
|---|---|---|
| Administrateur | Toute la plateforme | Tout, y compris gérer les comptes |
| Responsable coopérative | Ses producteurs et leurs fermes | Piloter, valider |
| Producteur | Ses fermes | Suivre son exploitation |
| Responsable ferme | Sa ferme, ses bâtiments, ses lots | Saisir, traiter les alertes |
| Technicien | Lots, capteurs, anomalies, alertes | Vue technique, pas de gestion |
| Auditeur | **Tout, mais en lecture seule** | Contrôler, jamais modifier |
| **Consommateur** | **Le passeport public uniquement** | Scanner et vérifier |

**Ce n'est pas juste un menu qui change.** Sur le même écran « Lots » :
l'administrateur voit **12 lots**, le responsable de coopérative **5**, le responsable de
ferme **2**, le technicien **2**.

## 🔵 NIVEAU 2

Deux dimensions orthogonales, combinées à chaque appel :

- **Rôle** → ce qu'on a le droit de faire : 7 actions × 15 modules
- **Périmètre** → sur quelles données : `GLOBAL | ORGANIZATION | COOPERATIVE | PRODUCER | FARM`

**Un seul point de décision** : `domain/shared/permissions.ts`. Il n'y a pas de test de rôle
dispersé dans les écrans — c'est ce qui rend la politique auditable d'un seul regard.

**Application côté serveur, pas cosmétique.** Vérifié par test automatisé *et* par accès
direct par URL : un lot hors périmètre est refusé pour les quatre rôles limités
(`assertInScope` lève, `redirectIfOutOfScope` redirige). Un bouton caché ne serait pas une
sécurité ; ici l'autorisation est dans le service, pas dans le composant.

| Rôle | Lots retournés | Modules visibles |
|---|---|---|
| Administrateur | 12 | 13 |
| Auditeur | 12 (lecture seule) | 11 |
| Resp. coopérative | 5 | 8 |
| Producteur / Resp. ferme | 2 | 5 |
| Technicien | 2 | 4 |

---

# 5. Le lot, objet central

## 🟢 NIVEAU 1

Tout part de la réalité physique :

```
Coopérative → Producteur → Ferme → Bâtiment → LOT
```

Notre lot de démonstration, `BU-2026-001` : **12 000 poussins** mis en place, **11 920**
aujourd'hui, dans le bâtiment BAT-01 de la Ferme Al Baraka à Kénitra.

Autour de ce lot s'accrochent : ses données quotidiennes, ses capteurs, ses indicateurs, son
historique d'événements, et toute sa traçabilité.

## 🔵 NIVEAU 2

**Le lot a un cycle de vie contrôlé** — pas un champ texte libre. 11 statuts et une machine à
états qui refuse les transitions illégales (`domain/production/lot-lifecycle.ts`) :

```
PLANIFIE → CREE → ACTIF → { EN_TRANSFERT | SUSPENDU | BLOQUE | ABATTU }
BLOQUE   → LIBERE → { ACTIF | EN_TRANSFERT | ABATTU }
ABATTU   → TRANSFORME → CLOTURE → ARCHIVE
```

`ARCHIVE` est terminal. `PLANIFIE → ABATTU` est refusé. On ne peut pas abattre un lot qui n'a
jamais existé, et le système le fait respecter au lieu de l'espérer.

**Chaque transition** est validée, auditée, et inscrite dans l'historique du lot.

---

# 6. Les données et leur provenance

## 🟢 NIVEAU 1

C'est le point que nous défendons le plus.

**Dans BIOVOLAILLES, aucun chiffre n'est nu.** Chaque valeur porte deux choses :

1. **Son statut** — huit possibilités : Réel · Test · Simulation · Calculé · Estimé ·
   À confirmer · Validé · Manquant.
2. **Sa provenance** — d'où elle vient : quelle source, quel appareil ou quelle personne,
   quand exactement, avec quelle méthode, et par quelle formule si elle est calculée.

Concrètement : **une valeur simulée ne peut jamais ressembler à une valeur validée.** Elles
n'ont pas le même badge, et ce badge est partout — dans les listes, sur les graphiques, dans
le détail.

Deuxième principe : **le système sait dire « je ne sais pas ».** Sur notre lot, l'indice de
consommation affiche « donnée insuffisante » au lieu d'un chiffre inventé. Cinq indicateurs
sur six se calculent ; le sixième s'abstient, et le dit.

## 🔵 NIVEAU 2

`ProvenanceFields` est un mixin porté par **chaque** enregistrement structuré :
`sourceType` · `sourceId` · `actorId` · `deviceId` · `documentId` · `dataStatus` ·
`measurementMethod` · `validationStatus` · `formula`.

Ce n'est pas une colonne de commentaire — c'est ce qui permet à `describeProvenance()` de
reconstruire, pour n'importe quelle valeur à l'écran, la phrase complète « voici d'où vient ce
chiffre ». Le panneau de provenance de l'interface est un rendu direct de cette structure.

**Contrôles au moment de l'écriture** (`services/quality/`) : une pesée datée dans le futur est
rejetée, pas signalée après coup. C'est un bug réel que nous avons attrapé en phase 10 — le
scénario contenait une pesée au 25 août dans un système daté du 17, et le lot héros échouait en
permanence à son propre contrôle qualité.

**Éligibilité des KPI** : chaque KPI retourne `AVAILABLE | LIMITED | INSUFFICIENT` avec une
raison textuelle. L'interface affiche la raison. Le FCR est `INSUFFICIENT` sur le lot héros et
l'écran l'explique — c'est un comportement, pas un manque.

---

# 7. L'IoT

## 🟢 NIVEAU 1

> ⚠ **[SIMULÉ] — à dire avant qu'on ne le demande.**
> **Nous n'avons pas de capteurs installés dans des bâtiments.** Les mesures que vous allez
> voir sont produites par un simulateur, et l'application l'affiche sur chaque valeur.

Ce qui est réellement construit, c'est **tout le chemin** que suit une mesure :

```
Capteur → Mesure horodatée → Provenance → Contrôle qualité → Indicateur → Règle → Alerte
```

Brancher un vrai capteur consiste à **remplacer la première case**. Le reste du système ne
change pas.

Le bâtiment de démonstration a **1 appareil et 5 capteurs** — température, humidité, CO₂,
luminosité, poids — et **525 mesures** enregistrées.

L'interface distingue clairement cinq états : **En direct · Simulation · Donnée obsolète ·
Hors ligne · En défaut.**

## 🔵 NIVEAU 2

**Le simulateur est déterministe.** Le bruit vient d'un hachage de `(capteur, horodatage)`,
jamais de `Math.random`. La même mesure est donc reproductible à l'identique — c'est ce qui
rend la démonstration rejouable à l'octet près.

**Les courbes sont calibrées sur la zootechnie réelle**, pas sur des nombres plausibles :

| Grandeur | Modèle | Référence métier |
|---|---|---|
| Température | `max(21, 32 − 0,3 × âge)` + cycle jour/nuit | 32-34 °C au démarrage → ~21 °C en finition |
| Humidité | inversement liée à la température, bornée 35-85 % | cible 50-70 % |
| CO₂ | 750 ppm, +150 la nuit (ventilation réduite) | alarme > 3 000 ppm |
| Luminosité | 25 lux de 6 h à 20 h, 0,5 lux la nuit | photopériode 14 h/10 h |
| Poids | table Ross 308 interpolée | 42 g à l'éclosion → 2 283 g à 35 j |

**Point d'extension** : l'interface `SensorDataSource` dans le domaine. Le simulateur en est
une implémentation ; un connecteur passerelle en serait une autre. Le reste du système ne
connaît que le modèle `Measurement`.

**Ce qui reste à faire est réel et non trivial [À VENIR]** : protocole terrain, appairage des
appareils, tolérance aux coupures, synchronisation d'horloge.

**Détail d'ingénierie** : la lecture « en direct » est un **calcul pur qui n'écrit jamais en
base**. Elle ne peut donc pas polluer l'historique ni fausser le scénario de démonstration.

---

# 8. De la donnée à l'intelligence

## 🟢 NIVEAU 1

Le système surveille en continu et lève une **anomalie** quand quelque chose sort de
l'attendu. Sur notre lot :

> **Le lot a mangé 14 844 kg là où on en attendait 11 844,7 — soit +25,3 %.**
> **Et sa croissance est en retrait de 32,8 %.**
>
> Un troupeau qui mange plus et grossit moins : c'est un signal que tout éleveur reconnaît.

Les deux conditions réunies font passer l'alerte de « avertissement » à **critique**.

**Et le système explique pourquoi.** Chaque anomalie répond à huit questions :

> Quoi ? · Où ? · Quand ? · Qu'est-ce qui a changé ? · Comparé à quoi ? · De combien ? ·
> Sur quelles données ? · Pourquoi la règle s'est déclenchée ?

> ⚠ **Ce n'est pas de l'intelligence artificielle**, et c'est volontaire. Ce sont des règles
> explicites, écrites, versionnées. Un modèle statistique ne saurait pas vous dire *pourquoi*
> il a alerté. Quand une alerte déclenche une intervention sur un troupeau vivant,
> l'explicabilité vaut mieux que la sophistication.

## 🔵 NIVEAU 2

**Cinq règles**, définies dans `domain/intelligence/rule-definitions.ts` :

| Règle | Condition | Sévérité de base |
|---|---|---|
| `FEED_DEVIATION_ABOVE_REFERENCE` | > +15 % vs référence ajustée à l'âge | Avertissement |
| `PERFORMANCE_DECLINE` | aliment > +10 % **ET** croissance < −10 % | Avertissement, escalade |
| `TEMPERATURE_OUT_OF_RANGE` | hors 18-33 °C | Avertissement |
| `POPULATION_INCONSISTENCY` | écart de réconciliation > 0 | Avertissement, escalade |
| `STALE_SENSOR_DATA` | > 60 min sans mesure | Avertissement |

**Escalade en critique** : quand l'écart dépasse le double du seuil. Sur le lot héros, la
croissance est à −32,8 % contre un seuil de −10 % → critique. **Le seuil est dans le code, pas
dans le discours.**

**La sophistication réelle, souvent invisible : la référence d'aliment est ajustée à l'âge.**

Un broiler mange naturellement 30 à 50 % de plus d'une semaine sur l'autre. Une comparaison
brute « semaine dernière vs cette semaine » signalerait donc **tous** les lots sains, chaque
semaine. `ageAdjustedReference()` met la période précédente à l'échelle par le rapport des âges
moyens des deux fenêtres, ce qui retire la croissance attendue et ne laisse ressortir que
l'écart réel :

```
référence = valeur_précédente × (âge_moyen_actuel / âge_moyen_précédent)
```

Et la fenêtre de comparaison est de **8 jours, pas 7** — parce que les relevés sont espacés de
4 jours et qu'une fenêtre de 7 jours entre en aliasing avec cette cadence : selon la phase de
démarrage du lot, elle capturait 1 ou 2 relevés de référence, faisant osciller la référence sur
des lots pourtant parfaitement sur leur courbe.

**Traçabilité de la décision** : quand une anomalie s'appuie sur un KPI, la valeur est **figée**
dans `kpi_values` et référencée par `anomalies.kpiValueId`. La preuve ne bouge plus, même si le
KPI est recalculé plus tard.

---

# 9. De l'alerte à l'action humaine

## 🟢 NIVEAU 1

C'est le maillon que la plupart des tableaux de bord n'ont pas.

Une alerte, ça ne se contente pas de clignoter. **Un humain décide, et sa décision est
enregistrée.**

```
Alerte ouverte
   → le responsable de ferme la prend en compte, avec un commentaire
   → une action est enregistrée : qui, quand, quoi
   → un événement entre dans l'historique du lot
   → le journal d'audit garde la trace
```

La boucle se ferme sur une personne, pas sur une notification.

## 🔵 NIVEAU 2

Le cycle de vie complet est implémenté : `OPEN → ACKNOWLEDGED → { RESOLVED | DISMISSED }`,
via `acknowledgeAlert()`, `resolveAlert()`, `dismissAlert()` — chacune vérifiant la permission
`ACKNOWLEDGE:ALERTS`.

**Une prise en compte écrit quatre choses dans la même opération** :
1. le statut de l'alerte
2. un `ActionRecord` (acteur, horodatage, description)
3. un `LotEvent` de type `ALERT_ACTION` dans l'historique du lot
4. une entrée d'audit

Vérifié de bout en bout contre la base réelle, pas contre un mock : avant 2 alertes ouvertes /
6 événements / 0 action ; après 1 ouverte + 1 prise en compte / 7 événements / 1 action.

Un contrôle d'intégrité dédié — **T27** — détecte une alerte arrivée en état terminal sans
trace d'audit. Le système vérifie sa propre traçabilité décisionnelle.

**L'auditeur ne peut pas prendre en compte une alerte** : le bouton disparaît *et* le service
refuse.

---

# 10. La traçabilité

## 🟢 NIVEAU 1

Du poussin à la barquette, en une chaîne continue :

```
BU-2026-001  (11 920 sujets)
    ↓ collecte           13 708 kg
    ↓ abattage            9 596 kg de carcasses  (+ 4 112 kg de pertes)
    ↓ transformation      8 636 kg de produit    (+ 960 kg de rebuts)
    ↓ produit             BVU-PROD-2026-001
    ↓ destination         Marché Central Kénitra
```

Les rendements — **70 % à l'abattage, 90 % à la découpe** — sont ceux du métier. Et à chaque
étape, **ce qui sort plus les pertes égale exactement ce qui est entré**. Rien ne se perd dans
le calcul.

Le système fait tourner **761 contrôles automatiques** sur toute la base : chronologie
impossible, quantités non conservées, maillon orphelin, lot bloqué dont le produit serait
sorti. Résultat aujourd'hui : **750 passés, zéro problème critique.**

## 🔵 NIVEAU 2

**Table `relations` générique**, pas une colonne par type de lien : `(fromType, fromId,
relationType, toType, toId)`. Six types d'entité, quinze types de relation.

**Les relations autorisées sont déclarées** (`domain/traceability/relation-rules.ts`) et
**refusées à l'écriture**, pas signalées après coup :

```ts
createRelation()  →  if (!isRelationAllowed(type, from, to)) throw ValidationError
```

On ne peut pas créer un lien « produit conditionné depuis un lot d'élevage » : ce triplet n'est
pas dans la table des règles. La cohérence est structurelle.

**Le graphe est calculé**, jamais stocké : `buildLotTraceabilityChain()` remonte l'amont et
descend l'aval par parcours des relations, en respectant le périmètre de l'appelant.

**19 types de contrôle d'intégrité** implémentés (T01→T27), dont :
`T06` conservation des quantités · `T07` lot bloqué avec produit libéré (le scénario de rappel
qu'on veut rendre impossible) · `T15` chronologie · `T17` réconciliation de population ·
`T10` mutation sans audit · `T09` incohérence réel/simulation.

---

# 11. Le passeport public QR

## 🟢 NIVEAU 1

Le consommateur scanne le QR sur l'emballage et obtient une page mobile simple :

**Ce qu'il voit** : le produit · la ferme et la ville d'origine · la période de production ·
le parcours · les étapes de traçabilité.

**Ce qu'il ne voit jamais** : aucun identifiant interne · aucun indicateur privé · aucune
quantité d'aliment · aucune mesure de capteur · aucune alerte · aucune anomalie · aucun nom
d'utilisateur · aucun coût · aucune coordonnée GPS.

Et un détail qui compte : **la page affiche aujourd'hui « traçabilité NON vérifiée »**, parce
que les données sont simulées. Le statut public reflète l'état réel du système. Si nous
affichions « vérifié » sur un jeu de démonstration, ce mot ne voudrait plus rien dire nulle
part.

## 🔵 NIVEAU 2

**Une seule fonction décide de ce qui est public** : `resolvePublicPassport(token)`. La route
publique n'importe aucun dépôt — c'est structurel, vérifiable en une lecture, et pas une
accumulation de précautions dispersées.

**Le jeton** : 24 octets aléatoires en base64url (~192 bits), délibérément **pas un UUID** — un
identifiant public ne doit jamais pouvoir être confondu avec un identifiant interne.

**Le DTO est curatif, pas filtrant** : on construit un objet ne contenant que les champs
autorisés, plutôt que de retirer des champs d'une entité interne. Une nouvelle colonne interne
ne peut donc pas fuir par oubli.

**Vérifié automatiquement** : un jeton inconnu, un UUID ou une chaîne vide résolvent tous à
`null` (indistinguables — on n'apprend rien en sondant). Et la sérialisation complète du DTO
est testée contre 8 motifs interdits : UUID, codes de lot internes, e-mails, quantités
d'aliment, coûts, coordonnées.

**Le statut public est dérivé de l'état réel** du lot et de la chaîne — il ne peut pas afficher
« vérifié » sur une chaîne incohérente.

---

# 12. Audit et intégrité

## 🟢 NIVEAU 1

Deux garde-fous que peu de MVP ont :

**Le journal d'audit** — chaque modification importante laisse une trace : qui, quoi, valeur
avant, valeur après, motif, horodatage. Rien ne se fait en silence.

**Le centre d'intégrité** — le système se contrôle lui-même, en permanence, sur toute la base.
761 vérifications. Aujourd'hui : 750 passées, **zéro problème critique**, 11 avertissements.

Ces 11 avertissements sont **attendus** : une imperfection de qualité laissée volontairement dans
le jeu de démonstration, et dix appareils du registre que la simulation laisse hors ligne. Le
moteur les trouve. Un tableau affichant 100 % signifierait que le contrôle ne cherche rien.

## 🔵 NIVEAU 2

**Audit** : `recordAudit()` est appelé par chaque service mutant. Le contrôle `T10` détecte
justement une mutation sans entrée d'audit correspondante — le système vérifie que sa propre
piste d'audit est complète.

**Intégrité** : `runIntegrityChecks()` exécute 19 familles de contrôles sur l'ensemble des
entités du périmètre de l'appelant. Le score est calculé, pas déclaré.

**Un point de conception à défendre** : accuser réception d'un problème d'intégrité **ne le
supprime pas**. Le problème reste dans le rapport, annoté `ACKNOWLEDGED`, jusqu'à ce que la
donnée sous-jacente soit réellement corrigée. Personne ne peut « valider » un système
incohérent pour faire passer le tableau au vert.

---

# 13. Réel · Simulé · À venir

## 🟢 NIVEAU 1 et 🔵 NIVEAU 2 — la même diapositive pour tout le monde

C'est la section la plus importante du document. **À présenter avant qu'on ne la demande.**

| ✅ RÉEL | 🟡 SIMULÉ | ⚪ PAS ENCORE FAIT |
|---|---|---|
| L'application et son architecture | Le jeu de données de production | Les capteurs physiques |
| La base de données et son schéma | Les mesures IoT | L'apprentissage automatique |
| Toute la logique métier | L'anomalie de démonstration | Le déploiement industriel |
| Les rôles et les périmètres | La chaîne aval de démonstration | Le déploiement coopérative |
| L'architecture de traçabilité | | Documents et certifications |
| Le journal d'audit | | Application mobile |
| Le moteur d'intégrité | | Multi-langue |
| Les contrôles de qualité | | Consignes ajustées à l'âge (température) |
| 640 tests automatisés | | Limitation de débit sur la route publique |

**La phrase à retenir, mot pour mot :**

> « Nous ne prétendons pas avoir des capteurs dans des bâtiments. Nous démontrons que lorsqu'une
> mesure entre dans ce système, tout le reste de la chaîne existe déjà. »

**Et l'argument qui désamorce « c'est du fake » :**

> « Les données sont simulées, mais **calibrées sur le standard de souche Ross 308** : courbe de
> poids, courbe d'ingestion, indice de consommation entre 1,4 et 2,1 selon les lots, rendement
> carcasse 70 %, rendement de découpe 90 %, bilan matière exact. Simulé n'est pas synonyme
> d'inventé — un ingénieur avicole peut vérifier chaque chiffre contre les tables de la souche. »

---

# 14. Comment nous savons que ça marche

## 🟢 NIVEAU 1

Trois preuves qu'un jury peut vérifier lui-même :

1. **Tout est reproductible.** On efface la base, on rejoue le scénario : on obtient le même
   scénario, jusqu'aux œufs illisibles et aux valeurs des capteurs. Vérifié par un test automatique.
2. **Le système se teste tout seul** — 640 tests automatisés, dont un qui rejoue le scénario
   complet du bâtiment jusqu'au QR.
3. **Ça marche sans internet.** Débranchez le réseau : la démonstration fonctionne. Aucun
   service externe, aucune API tierce, aucune IA distante.

## 🔵 NIVEAU 2

| Contrôle | Résultat |
|---|---|
| `npm run lint` | 0 problème |
| `npm run typecheck` | propre (TypeScript strict, pas de `any`) |
| `npm test` | **640 / 640**, 87 fichiers |
| `npm run build` | propre, 104 routes |
| Contraste WCAG AA | 32 / 32 paires |
| Parcours par rôle | 10 rôles · 226 pages · 0 échec ; 27 / 27 refus des pages d'administration |
| Intégrité | 750 / 761, **0 critique** |
| Santé du système | 13 / 13 |
| Déterminisme | empreinte identique sur 3 réamorçages |
| Balayage route × rôle | 132 / 132 sans erreur |
| Vulnérabilités (prod) | 0 |

**Hors ligne, vérifié** : 0 appel sortant dans le code applicatif, 0 URL externe dans le build
serveur ou client, police Inter auto-hébergée (7 fichiers `.woff2`), base SQLite locale.

**Déterminisme, vérifié** : jetons QR, valeurs de KPI, sévérités d'anomalie et totaux
d'intégrité identiques sur trois réamorçages complets.

---

# 15. Les limites — que nous assumons

## 🟢 NIVEAU 1

Ce que nous **ne** prétendons **pas** :

- Nous n'avons pas de capteurs réels installés
- Nous n'avons pas de données de production réelles
- Nous n'avons pas testé la montée en charge
- Nous n'avons pas conduit d'étude de marché chiffrée
- Nous ne sommes pas déployés chez un client

Un juré qui nous demande « ça tient à combien d'utilisateurs ? » aura droit à : **« nous ne
l'avons pas mesuré »**. Un chiffre inventé s'effondrerait à la question suivante.

## 🔵 NIVEAU 2

Limites techniques connues, documentées dans `RELEASE_NOTES.md` :

- Le scénario est ancré sur des dates fixes (2026-08-16) — garantit le déterminisme, mais le
  jeu de données vieillit avec le temps réel
- `TEMPERATURE_OUT_OF_RANGE` est une **enveloppe de sécurité absolue** (18-33 °C), pas une
  consigne ajustée à l'âge — elle ne peut donc pas signaler « 28 °C, c'est trop chaud pour un
  lot de cinq semaines »
- Les pages `notFound()` renvoient HTTP 200 avec le bon contenu (Next.js diffuse après le début
  du flux)
- `sanitary_observations` existe dans le schéma mais n'a ni dépôt, ni service, ni interface —
  c'est une forme modélisée, pas une fonctionnalité
- Pas de MFA, pas de limitation de débit sur la route publique, pas de chiffrement au repos
- Le bundle client est de 680 à 735 kB non compressé par route

---

# 16. La suite

## 🟢 NIVEAU 1

```
[FAIT] MVP
   → Ferme pilote avec une coopérative partenaire
   → Un premier capteur physique
   → Données de production réelles
   → Documents et certifications dans le passeport
   → Intelligence avancée
   → Déploiement industriel
```

**Le prochain jalon concret** : une ferme pilote, un lot réel, au moins un capteur physique.
C'est le plus petit pas qui transforme « architecture prouvée » en « données réelles ».

> Nous ne donnons pas de calendrier chiffré, parce que nous n'en avons pas.

## 🔵 NIVEAU 2

Les points d'extension existent déjà dans le code, ce qui rend la feuille de route crédible :

| Étape | Point de changement | Ampleur |
|---|---|---|
| Capteur réel | implémenter `SensorDataSource` | 1 module + intégration terrain |
| Postgres | remplacer la couche dépôt Drizzle | interfaces déjà en place |
| Nouvelle règle | ajouter une entrée à `RULE_DEFINITIONS` + son évaluateur | additif |
| Nouveau type tracé | ajouter au type `EntityType` + une règle de relation | pas de changement de schéma |
| Certifications | nouvelle entité + relation `CERTIFIE_PAR` (déjà déclarée) | additif |

La table `relations` étant générique, étendre la traçabilité à la génétique ou au couvoir est
« ajouter une chaîne à une union », pas une migration.

---

# 17. La conclusion

## 🟢 NIVEAU 1

> **BIOVOLAILLES relie la production, la donnée, les capteurs, la performance, l'intelligence,
> la décision humaine, la traçabilité et le produit — autour d'un seul objet : le lot.**
>
> La traçabilité cesse d'être une contrainte réglementaire pour devenir un actif commercial.

Et pour finir : scannez le QR. C'est le vrai passeport du lot que nous venons de suivre.

## 🔵 NIVEAU 2

Ce que ce MVP prouve, précisément :

**Qu'une chaîne complète — du bâtiment physique jusqu'au QR scanné par un consommateur — peut
vivre dans un seul système cohérent, avec une gouvernance par rôle appliquée côté serveur, une
provenance sur chaque valeur, une détection explicable, une décision humaine tracée et un
contrôle d'intégrité qui se surveille lui-même.**

Ce qu'il ne prouve pas : qu'il fonctionne avec de vrais capteurs, à l'échelle industrielle,
sur des données réelles. **C'est la phase suivante, et nous ne la présentons pas comme faite.**

---

## Annexe — où vérifier chaque chiffre

| Chiffre | Vérification |
|---|---|
| 104 routes · 79 tables · 10 rôles · 22 règles · 6 KPI · 19 contrôles | code source |
| 640 tests | `npm test` |
| 761 contrôles, 750 passés, 0 critique | `/integrite` |
| 12 000 → 11 920 sujets · 1,15 kg à j26 | page Lot |
| aliment +25,3 % · croissance −32,8 % | page Alerte |
| 13 708 → 9 596 (70 %) → 8 636 (90 %) | page Traçabilité |
| 1 appareil, 5 capteurs, 525 mesures | `/administration/demo` |
| 12/5/2/2 lots selon le rôle | se connecter avec chaque compte |

**Documents liés** : `DEMO_SCRIPT_3MIN.md` · `DEMO_SCRIPT_5MIN.md` · `DEMO_SCRIPT_10MIN.md` ·
`JURY_QA.md` · `PRESENTATION_FINAL.md` · `ARCHITECTURE_DIAGRAM_PLAN.md` ·
`SLIDE_SCREENSHOT_PLAN.md` · `DEMO_RUNBOOK.md` · `RELEASE_NOTES.md`
