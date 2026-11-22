# Décisions attendues de votre part

Pour passer au **pilote sur données réelles**. Chaque point a un choix par défaut, pour que le projet
n'attende pas : sans réponse à la date indiquée, nous appliquons ce choix. Vous pourrez le modifier ensuite.

**Date limite de réponse :** [À COMPLÉTER : date]

---

## 1. Ferme pilote et référent sur site

- **Question :** quelle ferme accueille le pilote ? Qui en est le responsable sur place (nom, téléphone) ?
- **Par défaut :** aucun — ce choix vous appartient.
- Sans réponse de votre part avant le [À COMPLÉTER : date], le démarrage du pilote est reporté.

## 2. Saisies contradictoires (même lot, même jour, deux téléphones)

- **Question :** quand deux personnes déclarent une mortalité différente pour le même lot et le même jour,
  que fait le système ?
- **Par défaut :** les deux déclarations sont conservées, la plus récente est affichée et l'écart est signalé.
  L'effectif du lot ne change pas tant qu'un responsable n'a pas arbitré. Le responsable dispose de
  **30 jours** ; au-delà, seul l'administrateur corrige. Le système ne rajoute jamais d'oiseaux de lui-même :
  une correction à la baisse passe par une contre-saisie signée.
- Sans réponse de votre part avant le [À COMPLÉTER : date], nous appliquons ce choix par défaut.

## 3. Perte de données et interruption acceptables

- **Question :** en cas de panne grave, combien d'heures de saisies pouvez-vous perdre au maximum, et en
  combien de temps la plateforme doit-elle être remise en service ?
- **Par défaut :** une sauvegarde automatique chaque jour à 02:30 (heure du Maroc), contrôlée par une
  restauration d'essai. Dans le pire cas, jusqu'à **24 heures de saisies** sont perdues. Remise en service
  sous [À COMPLÉTER : nombre] heures. Conservation des sauvegardes : 7 quotidiennes, 4 hebdomadaires,
  12 mensuelles, avec une copie hors du serveur.
- Sans réponse de votre part avant le [À COMPLÉTER : date], nous appliquons ce choix par défaut.

## 4. Critères de réussite du pilote

- **Question :** à quelles conditions considérez-vous le pilote réussi ?
- **Par défaut :** **4 semaines** de saisies quotidiennes complètes (mortalité, aliment, eau, pesées), qui
  concordent avec les registres papier tenus en parallèle ; tout écart est expliqué.
- Sans réponse de votre part avant le [À COMPLÉTER : date], nous appliquons ce choix par défaut.

## 5. Marquage des œufs : option A, B ou les deux

- **Question :** quelle option de marquage gardez-vous ?
  - **A** — œufs à couver marqués dès la collecte, retrouvés par leur code au mirage et rattachés à leur
    troupeau reproducteur.
  - **B** — œufs de consommation : les plateaux reçoivent un identifiant BIOVOLAILLES et un QR vers une
    page publique.
- **Par défaut :** les deux options restent construites ; **aucune n'est activée** avant la réception (essais
  au banc puis sur site) de l'imprimante et de la caméra. Le jeu de commandes de ces machines reste à obtenir
  du fournisseur.
- Sans réponse de votre part avant le [À COMPLÉTER : date], nous appliquons ce choix par défaut.

## 6. Langue de l'application terrain

- **Question :** les personnes qui saisiront chaque jour sur téléphone lisent-elles le français sans difficulté ?
- **Par défaut :** application en français ; test avec les éleveurs pendant la formation. Si le français
  gêne la saisie, une version arabe est étudiée avant le démarrage du pilote.
- Sans réponse de votre part avant le [À COMPLÉTER : date], nous appliquons ce choix par défaut.

## 7. Durées de conservation des données

- **Question :** combien de temps garder chaque type de donnée ?
- **Par défaut :**

  | Donnée | Conservation |
  |---|---|
  | Mesures brutes des capteurs | 90 jours |
  | Moyennes 15 minutes / horaires | 2 ans / sans limite |
  | Journal d'audit et journal chaîné | Sans limite |
  | Sauvegardes | 7 quotidiennes, 4 hebdomadaires, 12 mensuelles |
  | Données d'identité des personnes (noms, e-mails, téléphones) | [À COMPLÉTER : durée] |

- Sans réponse de votre part avant le [À COMPLÉTER : date], nous appliquons ce choix par défaut
  (sauf la dernière ligne, qui doit être fixée par vous).

## 8. Questions ouvertes sur votre schéma de production

- **Question :** confirmez-vous ces quatre lectures de votre schéma manuscrit ?
- **Par défaut :**
  - « Pistache » est un type d'œuf (pondeuses « Pistache »).
  - Les « Agrégés » sont des fermes partenaires.
  - La phase de croissance se termine à 6 semaines (l'étape 8, barrée, n'est pas reprise).
  - L'identité individuelle (bague, puce) est réservée aux reproducteurs et aux sujets en observation ;
    tous les autres oiseaux sont suivis par lot.
- Sans réponse de votre part avant le [À COMPLÉTER : date], nous appliquons ce choix par défaut.

## 9. Données à nous fournir

- **Question :** pouvez-vous remplir les trois modèles du dossier `modeles/` ?
  - `structure-elevages.csv` — une ligne par bâtiment, avec sa ferme, son producteur, sa coopérative.
  - `utilisateurs.csv` — une ligne par personne, avec son rôle et son périmètre.
  - `lots-en-cours.csv` — une ligne par lot en place.
  - Supprimez la ligne qui commence par « EXEMPLE » ; dates au format JJ/MM/AAAA.
- **Par défaut :** aucun — sans vos données, rien ne peut être chargé.
- Sans réponse de votre part avant le [À COMPLÉTER : date], le démarrage du pilote est reporté.
