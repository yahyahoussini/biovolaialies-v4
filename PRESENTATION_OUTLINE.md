# BIOVOLAILLES — Plan de présentation

Structure narrative destinée à la construction ultérieure du support visuel.
**Ce n'est pas encore le PowerPoint.**

Règle appliquée dans tout ce document : aucune affirmation qui ne soit adossée à quelque
chose que le produit fait réellement. Les chiffres cités sont ceux que la démonstration
affiche à l'écran. Là où une donnée manque, la section le dit au lieu de l'inventer.

**Positionnement — une seule phrase, à répéter :**

> BIOVOLAILLES est une **plateforme numérique d'exploitation, d'intelligence et de
> traçabilité pour la production avicole**.

Jamais « un tableau de bord IA ».

---

## 1. Problème

L'élevage avicole marocain fonctionne largement sur des relevés papier ou des tableurs
isolés. Conséquences structurelles :

- la donnée d'élevage est saisie mais peu exploitée ;
- un écart de performance se constate après coup, pas pendant ;
- la traçabilité, quand elle existe, s'arrête à la porte de l'exploitation ;
- le consommateur n'a aucun moyen de vérifier l'origine de ce qu'il achète.

> ⚠ **À cadrer honnêtement.** Nous n'avons pas conduit d'étude terrain chiffrée.
> Présenter cette section comme le constat qui a motivé le projet, pas comme une
> étude de marché. Ne citer aucun pourcentage que nous ne pouvons pas sourcer.

## 2. Opportunité

Trois évolutions convergent : exigence croissante de traçabilité alimentaire, coût des
capteurs en baisse, et structuration coopérative du secteur qui rend un déploiement
mutualisé réaliste. La question n'est pas de collecter plus de données, mais de les
relier — de l'élevage jusqu'au consommateur.

## 3. Le concept BIOVOLAILLES

Une chaîne unique, continue, dans un seul système :

```
OPÉRATION PHYSIQUE → DONNÉE → IoT → QUALITÉ → KPI
   → INTELLIGENCE → ALERTE → ACTION → TRAÇABILITÉ → PRODUIT → QR
```

C'est le fil conducteur de toute la présentation, et l'ordre exact de la démonstration.

## 4. Les défis opérationnels adressés

| Défi | Réponse dans le produit |
|---|---|
| Données dispersées | Un modèle unique organisation → coopérative → producteur → ferme → bâtiment → lot |
| Chacun voit tout, ou rien | 6 rôles, périmètres hiérarchiques, matrice de permissions centralisée |
| « D'où vient ce chiffre ? » | Provenance sur chaque valeur : source, acteur, appareil, horodatage, méthode |
| Problèmes détectés trop tard | Moteur de règles sur les KPI, alertes explicables |
| Alerte sans suite | Prise en compte → action enregistrée → événement dans l'historique du lot |
| Traçabilité qui s'arrête à la ferme | Chaîne lot → collecte → abattage → transformation → produit → destination |
| Aucune preuve pour le consommateur | Passeport public par QR, contenu strictement filtré |

## 5. Architecture de la solution

- **Next.js 16 / React 19 / TypeScript strict**, rendu serveur par défaut.
- **Couche métier isolée** : `domain` (règles pures) → `services` (cas d'usage) → `data` (dépôts).
  Toute **écriture** passe par un service ; les pages ne modifient jamais la base elles-mêmes
  (vérifié : zéro appel d'écriture depuis `app/`). Les lectures d'écran passent par la couche
  dépôt. La couche `domain` est pure : zéro import de `data/` ou `services/`.
- **Une seule matrice de permissions** (`domain/shared/permissions.ts`) — jamais de test de
  rôle dispersé dans les écrans.
- **SQLite/Drizzle** en démonstration ; la couche dépôt est l'unique point à changer pour
  passer à Postgres.
- **413 tests automatisés**, dont un test de bout en bout qui rejoue tout le scénario héros.

Message : *l'architecture est réelle et testée ; c'est le déploiement qui reste à faire.*

## 6. La plateforme

Démonstration en direct, pas de captures d'écran. Montrer le poste de pilotage :
périmètre affiché en permanence, indicateurs d'état, éléments nécessitant attention.

## 7. Les rôles utilisateurs

| Rôle | Ce qu'il voit |
|---|---|
| Administrateur | Tout, plateforme entière |
| Responsable coopérative | Ses producteurs et leurs fermes |
| Producteur | Ses fermes |
| Responsable ferme | Sa ferme, ses bâtiments, ses lots |
| Technicien | Vue technique : lots, IoT, anomalies, alertes — 4 modules |
| Auditeur | Tout, en lecture seule |

Le changement de rôle effectue une **véritable réauthentification** : ce n'est pas un
affichage conditionnel, les données réellement retournées changent.

## 8. Intégration IoT

- Appareils, capteurs, mesures modélisés comme entités de premier rang, rattachés au bâtiment.
- Cinq types de mesure : température, humidité, CO₂, luminosité, poids.
- Chaque valeur porte son **statut de donnée** et sa provenance.
- L'interface distingue **En direct / Simulation / Obsolète / Hors ligne / En défaut**.

> **À dire explicitement** : les mesures sont produites par un simulateur déterministe.
> Nous n'avons pas de capteurs déployés. Ce qui est construit et démontrable, c'est le
> **chemin complet** de la mesure jusqu'à l'alerte — brancher un capteur réel consiste à
> remplacer la source, pas à réécrire le système.

## 9. Donnée → KPI → Intelligence

Chaîne : enregistrement structuré → contrôle qualité → KPI → règle → anomalie.

> **Les données de démonstration sont calibrées sur le standard de souche Ross 308** — courbe
> de poids (42 g à l'éclosion, 943 g à 21 j, 2 283 g à 35 j), courbe d'ingestion, indice de
> consommation entre 1,4 et 2,1 selon les lots, rendement carcasse 70 %, rendement de découpe
> 90 %. Simulé n'est pas synonyme d'inventé : un ingénieur avicole peut vérifier chaque chiffre
> contre les tables de la souche.

Deux principes défendables devant un jury :

1. **Aucune valeur nue.** Chaque donnée porte un statut (Réel, Simulation, Calculé, Estimé,
   À confirmer, Validé, Manquant). Une valeur simulée ne peut jamais ressembler à une valeur validée.
2. **Le système sait dire « je ne sais pas ».** L'indice de consommation s'affiche
   « Donnée insuffisante » plutôt qu'un chiffre non fondé.

## 10. Anomalie → Alerte → Action

Sur `BU-2026-001` : consommation d'aliment **14 844 kg** contre une référence de
**11 844,7 kg**, soit **+25,3 %**, ET une croissance en retrait de **−32,8 %**. Les deux
conditions réunies font passer l'alerte de « avertissement » à **critique** — le seuil
d'escalade est −20 %, il est dans le code, pas dans le discours.

Le lot pèse 1,15 kg à 26 jours là où le standard Ross 308 est ~1,40 kg : un troupeau qui mange
plus et grossit moins. C'est un scénario que tout éleveur reconnaît.

Chaque anomalie répond à huit questions : quoi, où, quand, qu'est-ce qui a changé, comparé
à quoi, de combien, sur quelles données, pourquoi la règle s'est déclenchée.

Puis le maillon que la plupart des tableaux de bord n'ont pas : le responsable de ferme
**prend l'alerte en compte**, ce qui crée une action datée et signée, et inscrit un
événement dans l'historique du lot. La boucle se ferme.

> Argument central : **aucune boîte noire**. Chaque alerte est explicable ligne à ligne,
> parce qu'elle vient de règles explicites et non d'un modèle statistique opaque.

## 11. Traçabilité du lot

Chaîne réelle en base, reconstituée depuis les relations :

```
BU-2026-001 → COL-2026-001 → AB-2026-001 → TR-2026-001
            → BVU-PROD-2026-001 → DEST-2026-001
```

Le graphe est calculé, jamais codé en dur. Des contrôles de cohérence vérifient
chronologie, conservation des quantités et absence de maillon orphelin :
**750 contrôles passés sur 761, zéro problème critique**.

## 12. Passeport numérique QR

Le consommateur scanne et obtient : produit, ferme et ville d'origine, période de
production, parcours, étapes.

Il n'obtient **jamais** : identifiants internes, KPI privés, quantités d'aliment, mesures
IoT, alertes, anomalies, noms d'utilisateurs, coûts, coordonnées GPS, documents internes.

Une **seule fonction** dans tout le code décide de ce qui est public — la séparation est
structurelle, pas une accumulation de précautions dispersées.

Point de confiance à souligner : la page affiche aujourd'hui **« Traçabilité non
vérifiée »**, parce que les données sont simulées. Le statut public reflète l'état réel du
système. Il n'est pas décoratif.

## 13. Ce que le MVP démontre

1. Une plateforme cohérente, pas une collection d'écrans
2. Accès par rôle et par périmètre
3. Opérations ferme / bâtiment / lot
4. Gestion de données structurées
5. Provenance sur chaque valeur
6. Intégration IoT simulée de bout en bout
7. KPI et performance
8. Détection d'anomalies **explicable**
9. Chaîne alerte → action
10. Traçabilité centrée lot
11. Lignage jusqu'au produit
12. Passeport public par QR
13. Audit et intégrité

## 14. Réel / Simulé / Pas encore fait

Diapositive obligatoire. C'est elle qui crée la crédibilité — la présenter avant que le
jury ne pose la question.

**RÉEL** — architecture applicative · workflows · base de données et schéma · logique
métier · permissions et périmètres · architecture de traçabilité · journal d'audit ·
moteur d'intégrité · 413 tests.

**SIMULÉ** — mesures IoT · données de production de démonstration · anomalies de
démonstration · chaîne aval de démonstration. Tout est étiqueté comme tel dans l'interface.

**PAS ENCORE FAIT** — intégration de capteurs physiques · apprentissage automatique ·
déploiement industriel · déploiement coopérative complet · écosystème de certification ·
application mobile · multi-langue.

> Formulation recommandée :
> « Nous ne prétendons pas avoir des capteurs dans des bâtiments. Nous démontrons que
> lorsqu'une mesure entre dans ce système, tout le reste de la chaîne existe déjà. »

## 15. Phase suivante

- Brancher un capteur physique réel sur la source de mesure existante
- Migrer vers Postgres (un seul point de changement : la couche dépôt)
- Pilote sur une exploitation réelle avec une coopérative partenaire
- Documents et certifications rattachés au passeport (l'entité n'existe pas encore)
- Application mobile terrain pour la saisie
- Arabe et amazigh

## 16. Vision long terme

Un registre de confiance partagé pour la filière avicole marocaine : les coopératives
pilotent, les producteurs gagnent en performance, les autorités disposent d'une piste
d'audit, et le consommateur vérifie l'origine d'un scan.

La traçabilité cesse d'être une contrainte réglementaire pour devenir un actif commercial.

---

## Annexe — questions probables du jury

| Question | Réponse |
|---|---|
| « C'est de l'IA ? » | Non, et c'est délibéré. Des règles explicites et versionnées — donc chaque alerte est justifiable. Un modèle statistique n'aurait pas pu expliquer le déclenchement. |
| « Les données sont réelles ? » | Non, elles sont simulées et étiquetées comme telles dans l'interface. Mais elles sont calibrées sur le standard Ross 308 — poids, ingestion, indice de consommation, rendements d'abattage et de découpe. L'architecture, elle, est réelle et testée. |
| « Vos chiffres tiennent-ils la route zootechniquement ? » | Oui, et c'est vérifiable : bilan matière exact à chaque étape (13 708 → 9 596 + 4 112 → 8 636 + 960), rendements 70 % et 90 %, indice de consommation dans la plage réelle 1,4–2,1, aucune valeur biologiquement impossible. |
| « Pourquoi le passeport dit non vérifié ? » | Parce que les données sont simulées. Le statut public reflète l'état réel — nous n'affichons pas une certification que nous ne pouvons pas justifier. |
| « Pourquoi 11 avertissements d'intégrité ? » | Attendus : une imperfection de qualité laissée volontairement dans le jeu de données, et dix appareils du registre que la simulation laisse hors ligne. Zéro problème critique — un tableau à 100 % signifierait que le contrôle ne cherche rien. |
| « Pourquoi un KPI est vide ? » | Le système refuse de calculer un indicateur qu'il ne peut pas justifier avec les données disponibles. |
| « Combien de temps pour un déploiement réel ? » | Nous ne l'avons pas chiffré. Le premier jalon technique est le branchement d'un capteur physique sur la source de mesure existante. |
| « Ça passe à l'échelle ? » | Non mesuré à ce jour. La couche dépôt est isolée pour permettre le passage à Postgres, mais nous n'avons pas conduit de test de charge. |

> Sur les deux dernières lignes : **ne pas improviser de chiffre.** « Nous ne l'avons pas
> encore mesuré » est une réponse solide devant un jury technique ; un chiffre inventé qui
> s'effondre à la question suivante ne l'est pas.
