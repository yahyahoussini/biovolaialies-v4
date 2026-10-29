# BIOVOLAILLES — Plan de captures d'écran

> ⚠ **Les captures n'existent pas encore et doivent être prises à la main.**
> L'environnement qui a produit ce dépôt n'a pas de navigateur : aucune image n'a pu être
> générée, et en fabriquer aurait été pire qu'inutile. Ce document dit **quoi capturer,
> depuis quel compte, dans quel état, à quelle largeur** — pour que les captures soient
> reproductibles et fidèles.
>
> Le contenu exact que chaque écran doit afficher est listé dans `DEMO_SCREENS.md`, généré
> depuis le serveur réel : servez-vous-en pour vérifier qu'une capture est la bonne.

---

## Préparation (à faire une fois, avant toute capture)

```bash
# serveur arrêté
npm run db:reset
npm run start
```

- `DEMO_MODE="true"` dans `.env.local`.
- `/administration/demo` doit afficher **13/13 « Conforme »**. Sinon, ne rien capturer.
- Navigateur en **fenêtre privée**, zoom **100 %**.
- **Masquer** la barre de favoris et toute extension.
- Largeur **1440 px** pour les écrans bureau, **390 px** pour le passeport public.
- Format **PNG**, pas de compression destructive.

**Ne jamais retoucher une capture** autrement qu'en recadrant. Pas de valeur repeinte, pas de
badge ajouté. Si un écran ne montre pas ce qu'on veut, c'est le scénario qu'on change, pas
l'image.

---

## Captures prioritaires (les 7 qui portent la présentation)

| # | Écran | Slide | Compte | État requis | Cadrage |
|---|---|---|---|---|---|
| **C1** | Tableau de bord | 4, 6 | Resp. coopérative | 2 lots actifs, 13 895 sujets | Pleine page, **badge DÉMO visible** |
| **C2** | Lot `BU-2026-001` — en-tête + onglets | 6 | Resp. ferme | Onglet *Aperçu* | En-tête + barre d'onglets + bandeau population |
| **C3** | IoT — appareil `DEV-B01-001` | 7 | Resp. ferme | Lecture en direct chargée | Cadrer sur **la valeur + le badge `Simulation`** |
| **C4** | Alerte — valeurs | 8, 9 | Resp. ferme | Alerte critique, statut *ouverte* | Les 3 cartes : observée / référence / écart |
| **C5** | Alerte — explication | 8, 9 | Resp. ferme | idem | Les 3 blocs : Situation / Mesure / Fondement |
| **C6** | Traçabilité complète | 10 | Resp. ferme | Chaîne complète | Le graphe entier, du lot au produit |
| **C7** | Passeport public | 11, 16 | **aucun** (navigation privée) | — | **390 px**, premier écran sans défilement |

---

## Captures secondaires (version 10 minutes, ou réserve)

| # | Écran | Compte | Ce qui doit être lisible |
|---|---|---|---|
| C8 | Ferme Al Baraka | Resp. ferme | 2 bâtiments, ville Kénitra |
| C9 | Bâtiment BAT-01 | Resp. ferme | État environnemental + lot hébergé |
| C10 | Lot — onglet *Performance* | Resp. ferme | Les 6 cartes KPI, dont **FCR « donnée insuffisante »** |
| C11 | Lot — onglet *Données* + provenance | Resp. ferme | Le panneau de provenance ouvert |
| C12 | Lot — onglet *Événements* | Resp. ferme | L'événement `ALERT_ACTION` après la prise en compte |
| C13 | Journal d'audit | Auditeur | Colonnes acteur / avant / après / motif |
| C14 | Centre d'intégrité | Auditeur | Score **750/761, 0 critique** |
| C15 | Sélecteur de rôle — vue Technicien | Technicien | Sidebar à **4 modules seulement** |
| C16 | Commandes présentateur | Administrateur | 13/13 conforme + les panneaux de contrôle |

---

## Paires de comparaison (très efficaces en slide)

Ces deux paires valent mieux qu'un paragraphe. À capturer dans la même session, au même zoom.

**P1 — Le périmètre change les données** *(slide 5)*
Même écran `/lots`, deux comptes :
- gauche : **Administrateur** → 12 lots
- droite : **Technicien** → 2 lots

**P2 — Interne vs public** *(slide 11)*
- gauche : traçabilité interne (codes `COL-`, `AB-`, `TR-`, identifiants)
- droite : passeport public (aucun identifiant, étapes seules)

C'est la démonstration visuelle la plus forte du support : la même chaîne, deux niveaux
d'information.

---

## Ce qu'il ne faut pas capturer

- Les identifiants ou l'URL de connexion avec un compte saisi.
- La sortie du terminal (`npm run db:seed`) — même si elle n'affiche plus le mot de passe.
- Un écran d'erreur ou un état de chargement.
- Une page où le badge **DÉMO** est coupé : il doit rester visible sur les captures d'écrans
  internes, c'est ce qui rend le support honnête.
- Toute vue montrant un jeton QR complet en clair sur une slide destinée à être diffusée
  publiquement — le QR de la slide 16 est volontairement scannable, les autres non.

---

## Contrôle avant intégration au support

- [ ] Les 7 captures prioritaires existent.
- [ ] Toutes prises après un `db:reset` propre, sur le **même** jeu de données.
- [ ] Les valeurs correspondent à `PRESENTATION_FINAL.md` § « Vérification finale des chiffres ».
- [ ] Le badge DÉMO est visible sur au moins C1.
- [ ] Le badge `Simulation` est lisible sur C3.
- [ ] Aucune capture n'a été retouchée.
- [ ] C7 est bien en 390 px (mobile), pas un bureau rétréci.
