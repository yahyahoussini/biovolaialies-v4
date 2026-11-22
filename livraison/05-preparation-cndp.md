# Préparation de la déclaration CNDP (loi n° 09-08)

> **Projet — à faire relire par un juriste avant dépôt.** Ce document recense ce que la plateforme traite
> réellement ; il ne remplace pas le formulaire de la CNDP.

## Identification

- Responsable du traitement : [À COMPLÉTER]
- Sous-traitant (hébergement et exploitation) : [À COMPLÉTER]
- Lieu d'hébergement du serveur (VPS) : [À COMPLÉTER : pays, ville, hébergeur]
- **Si le serveur est hors du Maroc :** il s'agit d'un transfert de données vers l'étranger ; vérifier avec le
  juriste les conditions et l'autorisation éventuelle de la CNDP.
- Contact pour l'exercice des droits (accès, rectification, opposition) : [À COMPLÉTER : adresse e-mail dédiée]

## Traitements

| Traitement | Finalité | Données | Personnes concernées | Conservation |
|---|---|---|---|---|
| Comptes utilisateurs | Donner accès à la plateforme selon le rôle et le périmètre | Nom complet, adresse e-mail, rôle, périmètre, empreinte du mot de passe | Personnel du client, éleveurs partenaires, intervenants | [À COMPLÉTER] — durée à fixer par le client |
| Journal des connexions | Sécuriser l'accès, bloquer les tentatives répétées | Date et heure, adresse e-mail saisie, résultat, empreinte à clé de l'adresse du poste (l'adresse elle-même n'est pas gardée), navigateur utilisé | Utilisateurs et personnes qui tentent de se connecter | Conservé, sans durée fixée — [À COMPLÉTER] |
| Saisies terrain | Enregistrer la production (mortalité, aliment, eau, pesées, santé) | Auteur, heure de la saisie, identifiant du téléphone, contenu de la saisie | Éleveurs, aides, techniciens | [À COMPLÉTER] |
| Journal d'audit et journal chaîné | Prouver qui a modifié quoi, quand et pourquoi | Auteur, date, valeur avant et après, motif | Tous les utilisateurs qui modifient une donnée | Sans limite (rien ne les efface en production) — durée à justifier avec le juriste |
| Formulaire de contact du site public | Traiter une demande et suivre la relation commerciale | Entreprise, nom du contact, e-mail professionnel ; téléphone et volume d'activité (facultatifs) ; activité, besoin ; date et version du consentement | Prospects | [À COMPLÉTER] |
| E-mails d'alerte | Prévenir les personnes concernées d'une anomalie | Adresse e-mail des destinataires (selon leur rôle et leur périmètre), contenu de l'alerte | Utilisateurs destinataires | [À COMPLÉTER] |
| Exports | Remettre des fichiers opposables | Contenu exporté (dont, pour les rôles d'audit, le journal d'audit) ; empreinte SHA-256 de chaque fichier | Selon le fichier | Registre des exports conservé |

**Base du traitement du formulaire de contact :** le consentement, recueilli par une case à cocher ; la version
du texte accepté est enregistrée.

## Destinataires

- Les utilisateurs habilités, chacun limité à son rôle et à son périmètre.
- Le prestataire d'envoi d'e-mails, s'il est activé : [À COMPLÉTER : nom, pays].
- Aucune donnée n'est vendue ni cédée. Le passeport QR public ne montre qu'une liste fixe de champs approuvés,
  sans donnée fournisseur ni client.

## Mesures de sécurité en place

- Mots de passe stockés sous forme d'empreinte (scrypt), jamais en clair.
- Session de connexion dans un cookie chiffré.
- Blocage après 5 échecs de connexion par compte ou 20 par poste en 15 minutes ; journal des connexions.
- Cloisonnement des données par périmètre (organisation, coopérative, producteur, ferme), contrôlé côté serveur.
- Journal d'audit de chaque modification et journal chaîné en ajout seul : toute altération du journal est
  détectée.
- Sauvegardes vérifiées par une restauration d'essai.
- Connexion chiffrée (HTTPS).
- Prévu dans la version pilote : connexion en deux étapes, obligatoire pour les rôles Administrateur,
  Responsable qualité et Direction.
