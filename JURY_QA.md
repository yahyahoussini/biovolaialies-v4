# BIOVOLAILLES — Préparation aux questions du jury

Document interne. Réponses **honnêtes et techniques**. Quand nous ne savons pas, la réponse
est « nous ne l'avons pas mesuré » — jamais un chiffre inventé, qui s'effondre à la question
suivante.

**Trois réflexes :**
1. Répondre en une phrase, puis proposer de montrer dans l'application.
2. Si c'est simulé, le dire avant qu'on ne le demande.
3. Ne jamais dire « intelligence artificielle ».

---

## Données et simulation

**Q1 — Pourquoi des données fictives ?**
Parce que nous n'avons pas encore de ferme partenaire en production, et que fabriquer un
faux historique réel aurait été malhonnête. Le jeu de démonstration est simulé et étiqueté
comme tel dans l'interface — mais il est **calibré sur le standard de souche Ross 308** :
courbe de poids (42 g à l'éclosion, 943 g à 21 jours, 2 283 g à 35 jours), courbe
d'ingestion, indice de consommation entre 1,4 et 2,1 selon les lots, rendement carcasse 70 %,
rendement de découpe 90 %, bilan matière exact à chaque étape. Simulé n'est pas synonyme
d'inventé : vous pouvez vérifier chaque chiffre contre les tables de la souche.

**Q2 — Pourquoi l'IoT est-il simulé ?**
Parce que nous n'avons pas de capteurs installés, et nous ne le prétendons pas. Le simulateur
est **déterministe** — le bruit vient d'un hachage, jamais de `Math.random` — donc la même
mesure est reproductible à l'identique. Ce qui est réellement construit, c'est le chemin
complet : capteur → mesure horodatée avec provenance → contrôle qualité → KPI → règle →
anomalie → alerte. Brancher un capteur réel consiste à remplacer la source de mesure, pas à
réécrire le système.

**Q3 — Comment un capteur réel se connecterait-il ?**
Il y a une interface `SensorDataSource` dans le domaine. Le simulateur en est une
implémentation ; un connecteur passerelle en serait une autre. Le reste du système ne change
pas, parce qu'il ne connaît que le modèle `Measurement` — appareil, capteur, valeur, unité,
horodatage, statut de donnée, provenance. Ce qui reste à faire est réel et non trivial :
protocole terrain, appairage des appareils, tolérance aux coupures, mise à l'heure.

**Q4 — Comment empêchez-vous les données fausses ou invalides ?**
Quatre couches, toutes actives :
1. **Statut de donnée obligatoire** sur chaque valeur (8 valeurs : Réel, Test, Simulation,
   Calculé, Estimé, À confirmer, Validé, Manquant). Une donnée simulée ne peut pas ressembler
   à une donnée validée.
2. **Provenance** : source, acteur, appareil, horodatage, méthode, formule.
3. **Contrôles qualité** au moment de l'écriture — une pesée datée dans le futur est rejetée.
4. **Moteur d'intégrité** : 761 contrôles sur toute la base (chronologie, conservation des
   quantités, réconciliation de population, mutation sans audit, incohérence réel/simulation…).
   Aujourd'hui : 750 passés, **zéro critique**, 11 avertissements attendus.

**Q5 — Pourquoi 11 avertissements d'intégrité ?**
Ils sont attendus. Un seul vient d'une imperfection de qualité laissée volontairement dans le
jeu de données ; les dix autres sont des appareils du registre (caméras, alarmes GSM, thermostats
mécaniques, contrôles d'accès, un capteur dégradé) que la simulation laisse hors ligne. Le moteur
les trouve. Un tableau à 100 % signifierait que le contrôle ne cherche rien.

---

## Technique

**Q6 — Pourquoi SQLite ? Ça passe à l'échelle ?**
SQLite parce que la démonstration doit tourner hors ligne, sans compte, sans service cloud, sur
un portable. Sur l'échelle : **nous ne l'avons pas mesuré, et je ne vais pas vous inventer un
chiffre.** Ce que nous avons fait, c'est isoler tout accès aux données derrière une couche
dépôt — il n'y a pas une ligne de SQL dans une page ou un service — donc passer à Postgres est
un changement localisé, pas une réécriture. Et toute **écriture** passe par un service : une
page ne modifie jamais la base elle-même (vérifié : zéro appel d'écriture depuis `app/`).

**Q7 — Quelle est l'architecture ?**
Quatre couches : UI (Server Components React) → Services (cas d'usage) → Domain (règles pures,
sans dépendance) → Repositories → base. Next.js 16, React 19, TypeScript strict, Drizzle.
640 tests automatisés, dont un test de bout en bout qui rejoue tout le scénario héros.

**Q8 — Comment les données sont-elles protégées ?**
Sessions par cookie chiffré et signé (iron-session), mots de passe hachés, autorisation
**côté serveur** à chaque appel. Le point important : il n'y a pas de contrôle d'accès dispersé
dans les écrans — une **matrice de permissions centralisée** est le seul point de décision.
Un bouton caché ne suffit pas, et nous le testons : un accès direct par URL à un lot hors
périmètre est refusé pour les quatre rôles limités.
Ce qui manque, honnêtement : pas de MFA, pas de limitation de débit sur la route publique,
pas de chiffrement au repos.

**Q9 — Comment fonctionne le RBAC ?**
Deux dimensions combinées : le **rôle** (ce qu'on a le droit de faire) et le **périmètre**
(sur quelles données). 6 rôles, 15 modules, 7 actions. Le périmètre est hiérarchique :
organisation → coopérative → producteur → ferme. Concrètement, sur le même écran :
l'administrateur voit 12 lots, le responsable de coopérative 5, le responsable de ferme 2, et
l'auditeur voit tout mais ne peut rien modifier — le bouton de prise en compte disparaît.

**Q10 — Est-ce que c'est de l'IA ?**
Non, et c'est délibéré. Ce sont **5 règles explicites et versionnées**. Un modèle statistique
n'aurait pas pu vous expliquer pourquoi il s'est déclenché ; nos anomalies répondent à
8 questions, avec les valeurs. Pour un domaine où une alerte déclenche une intervention sur
un troupeau vivant, l'explicabilité vaut mieux que la sophistication. L'apprentissage
automatique est une évolution possible **une fois** que des données réelles existeront — pas
avant.

**Q11 — Comment une anomalie est-elle détectée ?**
Exemple réel sur `BU-2026-001` : la règle « Déviation d'alimentation » compare la consommation
à une référence glissante et se déclenche au-delà de +15 % — ici 14 844 kg contre 11 844,7 kg,
soit +25,3 %. La règle « Dégradation de performance » combine deux conditions : aliment
au-delà de +10 % **et** croissance en retrait de plus de 10 %. Ici la croissance est à −32,8 %,
ce qui dépasse le double du seuil, donc le moteur escalade l'alerte de « avertissement » à
**critique**. Ce seuil d'escalade est dans le code, pas dans le discours.

---

## Métier et traçabilité

**Q12 — Comment fonctionne la traçabilité ?**
Une table de relations générique relie des objets typés : lot, collecte, abattage,
transformation, produit, destination. Le graphe est **calculé** en remontant et descendant ces
relations, jamais codé en dur. Des règles disent quelles relations sont permises entre quels
types — une relation invalide est refusée à l'écriture, pas signalée après coup.

**Q13 — Vos quantités tiennent-elles la route ?**
Oui, et c'est vérifiable à l'écran : 13 708 kg collectés → 9 596 kg de carcasses + 4 112 kg de
pertes (rendement 70 %) → 8 636 kg de produit + 960 kg de rebuts (rendement 90 %). Bilan
matière exact à chaque étape, et les rendements sont ceux du métier.

**Q14 — Que se passe-t-il si un lot est bloqué ?**
Le statut du lot fait partie du modèle (planifié, créé, actif, en transfert, suspendu, bloqué,
libéré, abattu, transformé, clôturé, archivé). Un contrôle d'intégrité dédié — T07 — détecte
un lot bloqué dont un produit aval aurait été libéré, ce qui est exactement le scénario de
rappel qu'on veut rendre impossible. Et le passeport public dérive son statut de l'état réel
du lot : il ne peut pas afficher « vérifié » sur une chaîne incohérente.

**Q15 — Pourquoi le passeport affiche-t-il « traçabilité non vérifiée » ?**
Parce que les données sont simulées, et que le système refuse de certifier ce qu'il ne peut
pas justifier. C'est volontaire : si le statut public affichait « vérifié » sur un jeu de
démonstration, il ne voudrait plus rien dire. Le statut public reflète l'état réel du système.

**Q16 — Que voit exactement le consommateur ?**
Produit, ferme et ville d'origine, période de production, parcours, étapes. Jamais :
identifiants internes, KPI privés, quantités d'aliment, mesures IoT, alertes, anomalies, noms
d'utilisateurs, coûts, coordonnées GPS. Une **seule fonction** décide de ce qui est public — la
séparation est structurelle, et nous la testons automatiquement.

**Q17 — Pourquoi un indicateur est-il vide ?**
L'indice de consommation affiche « donnée insuffisante ». C'est un choix : le système préfère
dire qu'il ne sait pas plutôt que d'afficher un chiffre qu'il ne peut pas justifier. 5 KPI
sur 6 se calculent.

**Q18 — Pourquoi ce lot a-t-il un mauvais indice de consommation (~2,0) ?**
Parce que c'est précisément le lot que le système a signalé : il mange 25 % de trop et sa
croissance chute de 33 %. Un bon indice de consommation contredirait sa propre alerte.

---

## Produit et suite

**Q19 — Qu'est-ce qui est déjà fonctionnel ?**
Tout ce que je vais vous montrer : authentification, rôles et périmètres, ferme/bâtiment/lot,
données de production avec provenance, IoT (source simulée), KPI, détection d'anomalie,
alerte → action → événement, traçabilité jusqu'au produit, passeport public QR, audit,
intégrité. 104 routes, 640 tests.

**Q20 — Qu'est-ce qui reste à construire ?**
Capteurs physiques, consignes de température ajustées à l'âge des animaux, entité documents et
certifications, application mobile terrain, multi-langue, limitation de débit sur la route
publique, et tout ce qui relève d'un déploiement industriel (charge, sauvegarde, supervision).

**Q21 — Quelle est la prochaine étape commerciale ?**
Une ferme pilote avec une coopérative partenaire, sur un lot réel, avec au moins un capteur
physique. C'est le plus petit jalon qui transforme « architecture prouvée » en « données
réelles ».

**Q22 — Combien de temps pour un déploiement réel ?**
Nous ne l'avons pas chiffré, et je préfère vous le dire que d'avancer une date. Le premier
jalon technique est identifié : brancher un capteur sur la source de mesure existante.

**Q23 — Qu'est-ce qui vous différencie d'un logiciel de gestion d'élevage existant ?**
La chaîne complète dans **un seul système** : la plupart des outils s'arrêtent à la porte de
l'exploitation, et la traçabilité aval vit dans un autre logiciel. Ici, la même base porte le
lot, ses mesures, son alerte, l'action humaine qui a suivi, et le QR que scanne le
consommateur. Nous ne prétendons pas être plus complets qu'un ERP avicole établi — nous
prétendons être **continus**.

---

## Questions pièges — à assumer, pas à esquiver

**« Vous avez juste fait une maquette. »**
Non. Une maquette n'a pas 79 tables, 640 tests, un moteur de règles ni un contrôle
d'autorisation côté serveur. Ce qui est simulé, ce sont les **données**, pas le système.
Ouvrez n'importe quel écran et demandez d'où vient une valeur : je vous montre sa provenance.

**« Sans données réelles, comment savoir si ça marche ? »**
Le système ne peut pas prouver que nos chiffres décrivent une vraie ferme — il prouve qu'il
traite correctement les chiffres qu'on lui donne. C'est vérifiable : effacez et rejouez le
scénario, vous obtenez exactement le même résultat, à l'octet près.

**« Le lot est clôturé, il ne se passe rien. »**
C'est exactement pour ça qu'il a un produit et un passeport : il a fini son cycle. C'est la
seule façon de vous montrer la chaîne entière, de l'élevage au QR.

**« Et si je vous demande de casser quelque chose ? »**
Volontiers. Connectez-vous en technicien et essayez d'ouvrir un lot d'une autre ferme par
l'URL — vous serez refusé côté serveur, pas seulement dans le menu.
