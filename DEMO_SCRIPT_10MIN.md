# BIOVOLAILLES — Script de démonstration · 10 minutes (version étendue)

**Structure** : les 16 étapes du script 5 minutes, **puis** quatre extensions. Les extensions
sont secondaires — elles ne doivent jamais interrompre le récit principal. Si le temps se
réduit en cours de route, on coupe dans les extensions, jamais dans le cœur.

**Préparation** : `DEMO_RUNBOOK.md` §0. `DEMO_MODE="true"`, 13/13 « Conforme ».

---

## Partie 1 — Le récit principal (≈ 5 min)

Dérouler intégralement `DEMO_SCRIPT_5MIN.md`, étapes 1 à 16.

**Ne pas accélérer pour gagner du temps sur les extensions.** Les deux pauses (après l'alerte,
après le passeport public) restent obligatoires.

---

## Partie 2 — Extension A · La provenance (≈ 1 min 30)

| MONTRER | DIRE | MESSAGE CLÉ |
|---|---|---|
| Lot → onglet **Données** → ouvrir la provenance d'une mesure | « Chaque valeur du système sait d'où elle vient : sa source, l'acteur ou l'appareil, l'horodatage, la méthode de mesure, et la formule quand elle est calculée. » | On peut auditer un chiffre, pas seulement le lire |
| Pointer le **statut de donnée** | « Huit statuts : réel, test, simulation, calculé, estimé, à confirmer, validé, manquant. Une valeur simulée ne peut jamais ressembler à une valeur validée. » | Aucune valeur nue |

> Anticipe : *« D'où vient ce chiffre ? »* — la question la plus fréquente d'un ingénieur.

---

## Partie 3 — Extension B · Les rôles (≈ 2 min)

Utiliser le **sélecteur de rôle** en haut à droite. C'est une **vraie réauthentification**, pas
un affichage conditionnel — le dire.

| MONTRER | DIRE | MESSAGE CLÉ |
|---|---|---|
| Passer en **Technicien** | « Quatre modules seulement : lots, IoT, anomalies, alertes. Pas d'utilisateurs, pas d'audit, pas de paramètres. » | Le rôle définit la surface |
| Rester technicien, ouvrir **Lots** | « Et deux lots seulement, ceux de sa ferme. Le périmètre ne filtre pas l'affichage : il change les données réellement retournées. » | Périmètre = données, pas menu |
| *(si un juré technique est présent)* tenter un lot hors périmètre par l'URL | « Un bouton caché ne suffirait pas. L'autorisation est appliquée côté serveur : l'accès direct est refusé. » | Sécurité réelle, pas cosmétique |
| Passer en **Auditeur** | « L'auditeur voit tout — 12 lots, 8 fermes — mais ne peut rien modifier. Regardez : le bouton de prise en compte a disparu. » | Lecture seule appliquée |

---

## Partie 4 — Extension C · L'audit (≈ 1 min)

| MONTRER | DIRE | MESSAGE CLÉ |
|---|---|---|
| `/audit`, filtrer par lot héros | « Chaque mutation importante est tracée : qui, quoi, valeur avant, valeur après, motif, horodatage. » | Rien ne se fait sans trace |
| Pointer l'entrée créée à l'étape 10 | « Voici la prise en compte que nous venons de faire, il y a trois minutes. » | La démonstration s'auto-documente |

---

## Partie 5 — Extension D · L'intégrité (≈ 1 min 30)

| MONTRER | DIRE | MESSAGE CLÉ |
|---|---|---|
| `/integrite` | « 761 contrôles automatiques tournent sur toute la base : chronologie impossible, quantités non conservées, population non réconciliée, mutation sans audit, incohérence réel/simulation, lot bloqué avec produit libéré. » | Le système se surveille |
| Pointer le score | « 750 passés, **zéro problème critique**. » | Résultat, pas intention |
| Pointer les 11 avertissements | « Ces onze avertissements sont attendus : une imperfection de qualité laissée volontairement dans le jeu de données, et dix appareils du registre que la simulation laisse hors ligne. Le moteur les trouve. Un tableau à 100 % signifierait que le contrôle ne cherche rien. » | Assumé, pas subi |

---

## Clôture (≈ 30 s)

> « Pour résumer : l'application, la base, la logique métier, les rôles, la traçabilité,
> l'audit et l'intégrité sont réels et testés — 640 tests automatisés. Les données de
> production et les mesures IoT sont simulées, calibrées sur le standard Ross 308, et
> étiquetées partout dans l'interface. Ce que ce MVP prouve, c'est qu'une chaîne complète —
> du bâtiment jusqu'au QR que scanne le consommateur — peut vivre dans un seul système
> cohérent. »

---

## Arbitrage si le temps se réduit

| Temps restant | Couper |
|---|---|
| 9 min | Extension C (audit) |
| 8 min | + Extension D (intégrité) |
| 7 min | + Extension B (rôles) — garder une seule bascule, Technicien |
| 6 min | + Extension A (provenance) |
| ≤ 5 min | Basculer sur `DEMO_SCRIPT_5MIN.md` |
| ≤ 3 min | Basculer sur `DEMO_SCRIPT_3MIN.md` |

## Optionnel — rejouer l'anomalie en direct

Si le jury demande à voir l'anomalie **apparaître** plutôt que la trouver déjà là :
`/administration/demo` → **Revenir à l'état normal**, puis **Déclencher l'écart**.

Le vrai moteur de règles s'exécute et crée l'alerte devant eux. Voir `DEMO_RUNBOOK.md` §3 bis.

> ⚠ « Revenir à l'état normal » réamorce la base et déconnecte les autres onglets. À faire
> **avant** de commencer, ou pendant une pause — jamais au milieu du parcours.
