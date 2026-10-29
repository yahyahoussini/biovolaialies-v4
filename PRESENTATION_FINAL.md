# BIOVOLAILLES — Présentation finale (structure + notes orateur)

Document de travail pour construire le support. **Ce n'est pas encore le PowerPoint.**

**Règle appliquée à chaque diapositive** : toute affirmation est soit visible dans
l'application, soit étiquetée « simulé », soit étiquetée « à venir ». Les chiffres cités ont
été mesurés sur un build de production de ce dépôt le 2026-08-18, pas estimés.

**Positionnement à ne jamais quitter :**

> BIOVOLAILLES est une **plateforme numérique d'exploitation, d'intelligence et de traçabilité
> pour la production avicole**. Le MVP est une **preuve fonctionnelle de l'architecture et des
> workflows** — pas un déploiement industriel.

Jamais « un tableau de bord IA ».

---

## Charte visuelle

| Élément | Valeur |
|---|---|
| Vert principal | `#2F7D4A` |
| Vert foncé (titres, aplats) | `#12372A` · `#205D42` |
| Or (accent, parcimonie) | `#E8C66A` |
| Texte | `#1C2922` · secondaire `#52605A` |
| Fond | `#F4F7F3` · surfaces `#FFFFFF` |
| Sémantique | succès `#2E8B57` · alerte `#D99A2B` · critique `#C94A4A` · info `#3D78A8` |
| Police | Inter |

Règles : ≤ 25 mots par diapositive · une idée par diapositive · diagrammes plutôt que listes ·
captures réelles du produit · **pas** de photos génériques, d'imagerie IA, ni de faux graphiques.

---

## SLIDE 1 — BIOVOLAILLES

**Contenu**
- Titre : **BIOVOLAILLES**
- Sous-titre : Digitalisation de la production avicole
- Une ligne : *De l'élevage au consommateur, dans un seul système.*
- Fond `#12372A`, logo, filet or.

**Notes orateur**
- Pourquoi cette diapo : poser le nom et la catégorie en 10 secondes.
- Dire : « BIOVOLAILLES est une plateforme numérique d'exploitation, d'intelligence et de traçabilité pour la production avicole. »
- Ne pas dire : « intelligence artificielle », « solution complète », « déployée ».
- Question anticipée : aucune. Enchaîner.

---

## SLIDE 2 — Le problème

**Contenu** — 4 blocs, pas de paragraphe :
- Information fragmentée (papier, tableurs isolés)
- Visibilité limitée sur l'élevage en cours
- Détection tardive des écarts
- Traçabilité qui s'arrête à la ferme

**Notes orateur**
- Pourquoi : justifier l'existence du produit.
- Dire : « La donnée d'élevage est saisie, mais peu exploitée. Un écart se constate après coup. Et le consommateur n'a aucun moyen de vérifier l'origine. »
- **Ne pas dire** : aucun pourcentage de marché, aucune taille de filière, aucune perte chiffrée. **Nous n'avons pas conduit d'étude terrain** — présenter cela comme le constat qui a motivé le projet.
- Question anticipée : « D'où viennent ces constats ? » → « De l'observation du secteur, pas d'une étude chiffrée que nous pourrions vous produire aujourd'hui. »

---

## SLIDE 3 — Notre vision

**Contenu**
- Grand titre : **Un seul système continu, de la production au produit.**
- Le fil conducteur en bandeau :
  `OPÉRATION PHYSIQUE → DONNÉE → IoT → QUALITÉ → KPI → INTELLIGENCE → ALERTE → ACTION → TRAÇABILITÉ → PRODUIT → QR`

**Notes orateur**
- Pourquoi : c'est le plan de toute la présentation ET l'ordre exact de la démonstration.
- Dire : « Retenez cette chaîne. Tout ce que je vais montrer suit cet ordre, dans l'application. »
- Ne pas dire : que la chaîne est déployée sur des fermes réelles.

---

## SLIDE 4 — La plateforme

**Contenu** — diagramme *Architecture système* (voir `ARCHITECTURE_DIAGRAM_PLAN.md` §1).
Chiffres discrets en bas : **104 routes · 79 tables · 10 rôles · 22 règles · 6 KPI · 19 types de contrôle d'intégrité**.

**Notes orateur**
- Pourquoi : montrer que c'est un système, pas une maquette.
- Dire : « Une application Next.js, une base relationnelle, une couche métier isolée, 640 tests automatisés. »
- Ne pas dire : « scalable », « prêt pour la production » — nous n'avons **pas** fait de test de charge.
- Question anticipée : « Ça tient à l'échelle ? » → voir `JURY_QA.md` Q6.

---

## SLIDE 5 — Qui l'utilise ?

**Contenu** — 6 rôles internes + le public. Tableau court :

| Rôle | Voit |
|---|---|
| Administrateur | Toute la plateforme |
| Responsable coopérative | Ses producteurs et leurs fermes |
| Producteur | Ses fermes |
| Responsable ferme | Sa ferme, ses bâtiments, ses lots |
| Technicien | Vue technique : lots, IoT, anomalies, alertes |
| Auditeur | Tout, en lecture seule |
| **Consommateur** | **Le passeport public uniquement** |

**Notes orateur**
- Pourquoi : la gouvernance est un différenciateur, pas un détail.
- Dire : « Le périmètre n'est pas un filtre d'affichage. Les données réellement retournées changent : l'administrateur voit 12 lots, le responsable de ferme en voit 2. Et un accès direct par URL à un lot hors périmètre est refusé côté serveur. »
- Ne pas dire : « permissions granulaires configurables » — la matrice est en code, pas éditable par l'utilisateur.
- Question anticipée : « Un bouton caché suffit ? » → « Non, et c'est vérifié : nous testons l'accès direct par URL, pas seulement le menu. »

---

## SLIDE 6 — Le lot, objet central

**Contenu** — diagramme *Chaîne opérationnelle* (plan §2) :
`Ferme → Bâtiment → Lot → Données · IoT · KPI · Événements · Traçabilité`
Capture réelle : page Lot `BU-2026-001`.

**Notes orateur**
- Pourquoi : tout le modèle s'accroche au lot ; si le jury retient une chose, c'est ça.
- Dire : « Le lot est l'objet central. Population, données, capteurs, indicateurs, alertes, historique, traçabilité : tout pend à lui. »
- Chiffres à citer : 12 000 sujets à la mise en place, 11 920 aujourd'hui.

---

## SLIDE 7 — Intégration IoT

**Contenu** — diagramme *Flux IoT* (plan §3) :
`Capteur → Mesure → Provenance → Contrôle qualité → Plateforme`
Bandeau explicite : **MVP = IoT simulé**.
Capture réelle : page appareil `DEV-B01-001` avec le badge `Simulation`.

**Notes orateur**
- Pourquoi : c'est la question que le jury va poser. **La devancer.**
- Dire : « Les mesures viennent d'un simulateur déterministe. Nous n'avons pas de capteurs déployés, et l'interface le dit sur chaque valeur. Ce qui est construit, c'est le chemin complet de la mesure jusqu'à l'alerte : brancher un capteur réel consiste à remplacer la source, pas à réécrire le système. »
- Ne pas dire : « compatible LoRaWAN / MQTT / telle marque » — aucune intégration matérielle n'existe.
- Chiffres : 1 appareil, 5 capteurs (température, humidité, CO₂, luminosité, poids), 525 mesures persistées.

---

## SLIDE 8 — De la donnée à l'intelligence

**Contenu** — diagramme *Flux intelligence* (plan §4) :
`Donnée structurée → Contrôle qualité → KPI → Règle → Anomalie → Alerte`
Encadré : **8 statuts de donnée** — Réel · Test · Simulation · Calculé · Estimé · À confirmer · Validé · Manquant.

**Notes orateur**
- Pourquoi : montrer que le système sait ce qu'il ne sait pas.
- Dire deux choses, dans cet ordre :
  1. « Aucune valeur nue : chaque donnée porte son statut. Une valeur simulée ne peut jamais ressembler à une valeur validée. »
  2. « Le système sait dire *je ne sais pas* : l'indice de consommation s'affiche "donnée insuffisante" plutôt qu'un chiffre non fondé. »
- Ne pas dire : « machine learning », « modèle prédictif ». **5 règles explicites**, versionnées.

---

## SLIDE 9 — De l'alerte à l'action

**Contenu** — diagramme *Alerte → Action* (plan §5) :
`Alerte → Décision humaine → Action enregistrée → Événement → Historique du lot`
Capture réelle : page alerte avec les valeurs et l'explication.

**Notes orateur**
- Pourquoi : c'est le maillon que la plupart des tableaux de bord n'ont pas.
- Dire : « Sur ce lot : aliment à +25,3 % au-dessus de la référence, et croissance en retrait de 32,8 %. Les deux conditions réunies font passer l'alerte en critique — le seuil d'escalade est −20 %, il est dans le code. Puis le responsable de ferme prend l'alerte en compte : ça crée une action datée et signée, et un événement dans l'historique du lot. La boucle se ferme. »
- Argument central : **aucune boîte noire**. Chaque anomalie répond à 8 questions : quoi, où, quand, qu'est-ce qui a changé, comparé à quoi, de combien, sur quelles données, pourquoi la règle s'est déclenchée.

---

## SLIDE 10 — Traçabilité

**Contenu** — diagramme *Chaîne de traçabilité* (plan §6) avec les quantités réelles :

```
BU-2026-001 (11 920 sujets)
   → COL-2026-001   13 708 kg collectés
   → AB-2026-001     9 596 kg carcasses + 4 112 kg pertes   (rendement 70 %)
   → TR-2026-001     8 636 kg produit + 960 kg rebuts       (rendement 90 %)
   → BVU-PROD-2026-001
   → DEST-2026-001   Marché Central Kénitra
```

**Notes orateur**
- Pourquoi : c'est le cœur de la promesse « traçabilité ».
- Dire : « Le graphe est calculé depuis les relations réelles en base, jamais codé en dur. Le bilan matière est exact à chaque étape, et les rendements — 70 % à l'abattage, 90 % à la découpe — sont ceux du métier. »
- Ajouter : « 761 contrôles automatiques de cohérence tournent sur toute la base : chronologie, conservation des quantités, maillons orphelins. Résultat aujourd'hui : 750 passés, **zéro problème critique**. »

---

## SLIDE 11 — Passeport numérique QR

**Contenu** — écran mobile réel du passeport, à côté d'une liste **Ce qu'il ne voit pas**.

Visible : produit · ferme et ville d'origine · période de production · parcours · étapes.
Jamais : identifiants internes · KPI privés · quantités d'aliment · mesures IoT · alertes ·
anomalies · noms d'utilisateurs · coûts · coordonnées GPS · documents internes.

**Notes orateur**
- Pourquoi : c'est la partie que le jury peut toucher (scanner en salle).
- Dire : « Une **seule fonction** dans tout le code décide de ce qui est public. La séparation est structurelle, pas une accumulation de précautions. »
- Point de confiance à assumer : « La page affiche aujourd'hui *traçabilité non vérifiée*, parce que les données sont simulées. Le statut public reflète l'état réel du système — il n'est pas décoratif. »

---

## SLIDE 12 — Ce que le MVP démontre

**Contenu** — 13 points, deux colonnes, sans phrase :

1. Une plateforme cohérente, pas une collection d'écrans
2. Accès par rôle et par périmètre, appliqué côté serveur
3. Opérations ferme / bâtiment / lot
4. Données de production structurées
5. Provenance sur chaque valeur
6. Intégration IoT simulée de bout en bout
7. KPI et performance
8. Détection d'anomalies explicable
9. Chaîne alerte → action → événement
10. Traçabilité centrée lot
11. Lignage jusqu'au produit
12. Passeport public par QR
13. Audit et contrôles d'intégrité

**Notes orateur**
- Dire : « Chacun de ces points est démontrable dans les cinq minutes qui suivent. »
- Ne rien ajouter à cette liste à l'oral.

---

## SLIDE 13 — Réel / Simulé / À venir

**Diapositive obligatoire. Elle crée la crédibilité — la présenter avant qu'on ne la demande.**

| RÉEL | SIMULÉ | PAS ENCORE FAIT |
|---|---|---|
| Application et architecture | Jeu de données de production | Capteurs physiques |
| Base de données et schéma | Mesures IoT | Apprentissage automatique |
| Logique métier | Anomalie de démonstration | Déploiement industriel |
| Rôles et périmètres | Chaîne aval de démonstration | Déploiement coopérative |
| Architecture de traçabilité | | Écosystème de certification |
| Journal d'audit | | Application mobile |
| Moteur d'intégrité | | Multi-langue |
| 640 tests automatisés | | Consignes ajustées à l'âge |

**Notes orateur**
- Dire, mot pour mot si besoin : « Nous ne prétendons pas avoir des capteurs dans des bâtiments. Nous démontrons que lorsqu'une mesure entre dans ce système, tout le reste de la chaîne existe déjà. »
- Ajouter : « Les données sont simulées mais **calibrées sur le standard de souche Ross 308** — courbe de poids, courbe d'ingestion, indice de consommation, rendements d'abattage et de découpe. Un ingénieur avicole peut vérifier chaque chiffre contre les tables de la souche. »

---

## SLIDE 14 — Architecture

**Contenu** — diagramme en couches (plan §1) :
`UI (Server Components) → Services (cas d'usage) → Domain (règles pures) → Repositories → Base`
Plus l'encart substitution :
`IoT simulé → même modèle de données → IoT réel demain`

**Notes orateur**
- Pourquoi : répondre à « et après ? » par de l'ingénierie, pas par une promesse.
- Dire : « Toute écriture passe par un service — une page ne modifie jamais la base elle-même. Les lectures simples d'un écran passent par la couche dépôt, jamais par du SQL dans la page. La couche dépôt est le seul point à changer pour passer de SQLite à Postgres, et la source de mesure le seul point à changer pour passer du simulateur à un capteur réel. »
- **Vérifié** : 0 appel d'écriture depuis `app/` · 0 import de `data/` ou `services/` depuis `domain/` (couche métier réellement pure).
- Ne pas dire « les pages n'accèdent jamais à la base » : 19 pages lisent via les dépôts pour des consultations simples. C'est délibéré et sans danger — mais c'est une nuance à énoncer correctement si un juré technique lit le code.
- Ne pas dire : « microservices », « cloud-native », « architecture hexagonale complète ».

---

## SLIDE 15 — Évolution

**Contenu** — frise, avec **MVP** seul marqué « fait » :

```
[FAIT] MVP  →  Fermes pilotes  →  IoT réel  →  Données de production réelles
      →  Traçabilité étendue (documents, certifications)  →  Intelligence avancée
      →  Déploiement industriel
```

**Notes orateur**
- Dire : « Le premier jalon technique est le branchement d'un capteur physique sur la source de mesure existante. Le premier jalon commercial est une ferme pilote avec une coopérative partenaire. »
- **Ne pas donner de calendrier chiffré** — nous n'en avons pas.

---

## SLIDE 16 — Conclusion

**Contenu**
- **BIOVOLAILLES relie production, donnée, IoT, intelligence, action et traçabilité dans une seule plateforme.**
- Sous-ligne : *La traçabilité cesse d'être une contrainte réglementaire pour devenir un actif commercial.*
- QR du passeport public, grand, scannable depuis la salle.

**Notes orateur**
- Dire : « Scannez-le. C'est le vrai passeport du lot que nous venons de suivre. »
- Finir sur le QR, pas sur une liste.

---

## Vérification finale des chiffres cités

| Chiffre | Où le vérifier |
|---|---|
| 104 routes · 79 tables · 10 rôles · 22 règles · 6 KPI · 19 types de contrôle | code source |
| 640 tests | `npm test` |
| 761 contrôles exécutés, 750 passés, 0 critique | `/integrite` |
| 12 000 → 11 920 sujets · 1,15 kg à j26 | page Lot |
| aliment +25,3 % · croissance −32,8 % | page Alerte |
| 13 708 → 9 596 (70 %) → 8 636 (90 %) | page Traçabilité |
| 1 appareil, 5 capteurs, 525 mesures | page IoT / `/administration/demo` |

Si un chiffre change après un réamorçage, c'est un bug : le scénario est déterministe.
