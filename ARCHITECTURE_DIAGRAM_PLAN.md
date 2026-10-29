# BIOVOLAILLES — Plan des diagrammes

Six diagrammes à produire pour le support. **Chacun décrit l'architecture réelle du dépôt**,
vérifiée le 2026-08-18 — pas une architecture idéalisée.

**Charte** : vert `#2F7D4A`, vert foncé `#12372A`, or `#E8C66A` (accent rare), gris
`#52605A`, fond `#F4F7F3`. Police Inter. Traits 2 px, coins 8 px. Pas d'ombres portées, pas
de dégradés, pas d'icônes décoratives.

**Convention de lecture, à appliquer aux six** :

| Style | Signification |
|---|---|
| Trait plein, fond blanc | Implémenté et démontrable |
| Trait plein, **liseré or** | Implémenté, mais **alimenté par des données simulées** |
| **Pointillés, gris** | Pas encore implémenté (évolution) |

Mettre cette légende sur chaque diagramme. C'est elle qui rend le support honnête.

---

## §1 — Architecture système *(slide 4 et 14)*

Cinq couches empilées, flèches vers le bas uniquement.

```
┌─ UI ─────────────────────────────────────────────┐
│  React Server Components · Server Actions         │
│  30 pages · 30 composants client                  │
└───────────────────┬──────────────────────────────┘
                    │ écritures : toujours via un service
                    │ lectures d'écran : dépôt en lecture seule
┌─ SERVICES ────────▼──────────────────────────────┐
│  13 modules : auth · identity · production ·      │
│  iot · quality · provenance · intelligence ·      │
│  traceability · public · audit · integrity ·      │
│  dashboard · demo                                 │
└───────────────────┬──────────────────────────────┘
┌─ DOMAIN ──────────▼──────────────────────────────┐
│  Règles pures. Zéro import de data/ ou services/  │
│  (vérifié). Permissions · règles · qualité ·      │
│  relations de traçabilité                         │
└───────────────────┬──────────────────────────────┘
┌─ REPOSITORIES ────▼──────────────────────────────┐
│  Interfaces dans domain/, implémentations Drizzle │
│  Seul point à changer pour SQLite → Postgres      │
└───────────────────┬──────────────────────────────┘
┌─ BASE ────────────▼──────────────────────────────┐
│  SQLite / libSQL · 79 tables                      │
└──────────────────────────────────────────────────┘
```

Encart latéral (liseré or) :
`Simulateur déterministe ──▶ interface SensorDataSource ──▶ services/iot`
et en pointillés dessous : `Passerelle capteurs réels ──▶ même interface`

**Le point à faire passer** : la flèche de substitution est au niveau de l'*interface*, pas du
système. C'est ce qui rend « brancher un vrai capteur » crédible.

---

## §2 — Flux de données opérationnel *(slide 6)*

Horizontal, gauche → droite. Le lot au centre, visuellement plus gros.

```
Organisation → Coopérative → Producteur → Ferme → Bâtiment → ⟪ LOT ⟫
                                                                │
        ┌───────────────────┬───────────────┬──────────────────┼─────────────┐
        ▼                   ▼               ▼                  ▼             ▼
   Données            Mesures IoT        KPI            Événements     Traçabilité
   structurées        (liseré or)      (6 définis)      (historique)    (aval)
   aliment · eau
   pesée · mortalité
   environnement
```

Sous chaque bloc de données, un petit badge : `statut de donnée + provenance`.

**Le point à faire passer** : tout pend au lot. Si le jury retient un seul schéma, c'est
celui-là.

---

## §3 — Flux IoT *(slide 7)*

Linéaire, avec le bandeau simulé bien visible.

```
┌────────────────────────────────────────────┐
│  MVP : SOURCE SIMULÉE (déterministe)       │  ← bandeau or, pleine largeur
└────────────────────────────────────────────┘

Appareil ──▶ Capteur ──▶ Mesure ──▶ Provenance ──▶ Contrôle qualité ──▶ Plateforme
DEV-B01-001   5 types    valeur      source           fraîcheur          KPI · règles
                         unité       acteur/appareil  plage
                         horodatage  méthode          cohérence
                         statut

              ⋯⋯⋯⋯ Capteur physique (à venir) ⋯⋯▶ même modèle Measurement
```

Les 5 types de capteur, nommés : température · humidité · CO₂ · luminosité · poids.

**Le point à faire passer** : ce qui est simulé, c'est la **première case**. Tout le reste de
la chaîne est réel.

---

## §4 — Flux intelligence *(slide 8)*

```
Donnée structurée
      │
      ▼
Contrôle qualité ──▶ 8 statuts : Réel · Test · Simulation · Calculé
      │                          Estimé · À confirmer · Validé · Manquant
      ▼
KPI (6) ──▶ éligibilité : disponible / limitée / insuffisante
      │      « le système sait dire je ne sais pas »
      ▼
Règle (5 explicites, versionnées)
      │      température · déviation aliment · dégradation performance
      │      incohérence population · capteur obsolète
      ▼
Anomalie ──▶ explication en 8 questions
      │      quoi · où · quand · qu'est-ce qui a changé
      │      comparé à quoi · de combien · sur quelles données · pourquoi
      ▼
Alerte ──▶ sévérité calculée (escalade en critique au-delà du double du seuil)
```

**À écrire sur le diagramme, en toutes lettres** : *règles explicites — pas de modèle
statistique, pas d'apprentissage automatique*.

**Le point à faire passer** : chaque flèche est traçable. C'est l'argument anti-boîte-noire.

---

## §5 — Alerte → action *(slide 9)*

Boucle fermée, pas une ligne droite — c'est le sens du schéma.

```
        ┌──────────────────────────────────────────────┐
        │                                              │
        ▼                                              │
     Alerte ──▶ Décision humaine ──▶ Action ──▶ Événement
   (ouverte)     rôle habilité      enregistrée   dans l'historique
                 + commentaire      acteur+date      du lot
                                         │
                                         ▼
                                   Journal d'audit
                                   avant/après/motif
```

Annoter la flèche de retour : *l'historique du lot alimente les KPI suivants*.

**Le point à faire passer** : le maillon « décision humaine » est ce que la plupart des
tableaux de bord n'ont pas.

---

## §6 — Chaîne de traçabilité *(slide 10)*

Avec les quantités réelles du scénario héros — pas des nombres ronds inventés.

```
   AMONT (structure)              LOT                    AVAL (transformation)
   Organisation                                          COL-2026-001   13 708 kg
   Coopérative        ──▶   ⟪ BU-2026-001 ⟫   ──▶        AB-2026-001     9 596 kg  (70 %)
   Producteur               11 920 sujets                 + 4 112 kg pertes
   Ferme Al Baraka          1,15 kg à j26                TR-2026-001     8 636 kg  (90 %)
   BAT-01                                                 + 960 kg rebuts
                                                         BVU-PROD-2026-001
                                                         DEST-2026-001
                                                         Marché Central Kénitra
                                                                │
                                                                ▼
                                                        ⟪ QR PUBLIC ⟫
```

Annoter : *bilan matière exact à chaque étape · graphe calculé depuis les relations, jamais
codé en dur · 761 contrôles de cohérence, 0 critique*.

---

## §7 — Niveaux d'accès *(slide 5)*

Pyramide de périmètres à gauche, matrice à droite.

```
   PÉRIMÈTRE (quelles données)          RÔLE (quelles actions)

   Global ──── Administrateur           7 actions :
        │      Auditeur (lecture)       voir · créer · modifier · supprimer
        │                               valider · prendre en compte · exporter
   Coopérative ─ Resp. coopérative
        │                               × 15 modules
   Producteur ── Producteur
        │                               = une matrice centralisée
   Ferme ─────── Resp. ferme            (un seul point de décision
                 Technicien              dans tout le code)

   ─────────────────────────────
   PUBLIC ────── Passeport QR uniquement
```

Chiffres mesurés à mettre sous la pyramide, ils rendent le schéma concret :

| Rôle | Lots visibles | Modules |
|---|---|---|
| Administrateur | 12 | 13 |
| Auditeur | 12 (lecture seule) | 11 |
| Resp. coopérative | 5 | 8 |
| Producteur / Resp. ferme | 2 | 5 |
| Technicien | 2 | 4 |
| Public | 0 | passeport seul |

**Le point à faire passer** : ce sont les **données retournées** qui changent, pas seulement le
menu — et c'est appliqué côté serveur.

---

## Contrôle avant livraison des diagrammes

- [ ] La légende simulé / implémenté / à venir figure sur les six.
- [ ] Aucune boîte ne nomme une technologie absente du `package.json`.
- [ ] Aucune flèche ne suggère une intégration matérielle existante.
- [ ] Les chiffres correspondent à `PRESENTATION_FINAL.md` § « Vérification finale ».
- [ ] Rien n'est nommé « IA » ou « ML ».
