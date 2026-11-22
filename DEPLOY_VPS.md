# Déploiement sur le VPS — BIOVOLAILLES

Deux instances possibles sur le même VPS, chacune dans son dossier :

- **Démonstration et formation** (§2 à §6) : données fictives, comptes de démonstration partagés,
  sélecteur de rôle. Ne jamais y saisir de données réelles.
- **Installation réelle** (§7) : base vide, premier administrateur créé par `npm run setup`, mots de
  passe personnels, double authentification, structure des élevages saisie ou importée, tâches
  planifiées et sauvegarde nocturne vérifiée.

Prérequis sur le VPS : Docker avec Docker Compose, et un reverse proxy HTTPS (Nginx, Caddy, Traefik…).
L'application n'écoute que sur `127.0.0.1` (port 3100, ou `HOST_PORT`) ; elle n'est jamais exposée
directement.

---

## 1. DNS

Dans la zone DNS de `brandhubos.cloud` : un enregistrement **A** `biovolailles` vers l'adresse IP du
VPS (et **AAAA** si le VPS a une IPv6). Vérifier :

```bash
dig +short biovolailles.brandhubos.cloud
```

## 2. Installer et démarrer

```bash
git clone --branch claude/affectionate-maxwell-x35sye https://github.com/yahyahoussini/biovolaialies-v4.git biovolailles
cd biovolailles
cp deploy/vps.env.example deploy/vps.env
sed -i "s/^SESSION_SECRET=.*/SESSION_SECRET=$(openssl rand -hex 32)/" deploy/vps.env
docker compose up -d --build
```

Dépôt privé : `git clone` demande un jeton GitHub en lecture seule (ou une clé de déploiement).

Premier démarrage : la base de démonstration est copiée sur le volume `biovolailles-data`, puis le
serveur démarre (« Ready » dans les journaux). Contrôle :

```bash
docker compose logs --tail 30 app
curl -s http://127.0.0.1:3100/api/v1/health/ready
```

Réponse attendue : `{"status":"ready",…}`.

## 3. HTTPS

**Point de sécurité :** l'application lit l'adresse du visiteur dans `X-Real-IP` (limitation des
tentatives de connexion). Le proxy doit **remplacer** cet en-tête, sinon un visiteur peut l'inventer.

**Nginx** (`/etc/nginx/sites-available/biovolailles`, puis lien dans `sites-enabled`) :

```nginx
server {
    listen 80;
    server_name biovolailles.brandhubos.cloud;

    location / {
        proxy_pass http://127.0.0.1:3100;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 20m;
    }
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d biovolailles.brandhubos.cloud
```

**Caddy** (certificat automatique) :

```caddy
biovolailles.brandhubos.cloud {
    reverse_proxy 127.0.0.1:3100 {
        header_up X-Real-IP {remote_host}
    }
}
```

**Traefik, Coolify ou autre** : router `biovolailles.brandhubos.cloud` vers `127.0.0.1:3100` et
écraser `X-Real-IP` avec l'adresse du client.

## 4. Comptes de démonstration

Les comptes (un par rôle, plus cinq éleveurs partenaires) sont listés dans `DEMO_RUNBOOK.md` §1. Ils
partagent un même mot de passe, à communiquer au client de vive voix, pas par écrit public. Le
sélecteur de rôle (barre du haut) n'existe que sur cette instance de démonstration.

## 5. Mettre à jour

```bash
cd biovolailles
git pull
docker compose up -d --build
```

La base reste sur le volume : une mise à jour ne l'efface pas.

## 6. Remettre la démonstration à zéro

- **Dans l'application** : compte Administrateur → Administration → Démo → Réinitialiser.
- **Repartir de la base d'origine** :

```bash
docker compose down
docker volume rm biovolailles_biovolailles-data
docker compose up -d
```

(Le nom du volume commence par le nom du dossier ; vérifier avec `docker volume ls`.)

## 7. Installation réelle (données du client)

Une seconde instance, dans son propre dossier, avec sa propre base, son sous-domaine et son port.
Recommandé : l'installation réelle sur `biovolailles.brandhubos.cloud`, la démonstration déplacée sur
`demo-biovolailles.brandhubos.cloud` (enregistrement DNS A et bloc de proxy en plus, port 3100).

```bash
git clone --branch claude/affectionate-maxwell-x35sye https://github.com/yahyahoussini/biovolaialies-v4.git biovolailles-prod
cd biovolailles-prod
printf 'HOST_PORT=3101\nIMAGE_NAME=biovolailles-prod\nAPP_URL=https://biovolailles.brandhubos.cloud\n' > .env
cp deploy/vps.env.production.example deploy/vps.env
for k in SESSION_SECRET MFA_ENCRYPTION_KEY LEDGER_ANCHOR_KEY; do sed -i "s/^$k=.*/$k=$(openssl rand -hex 32)/" deploy/vps.env; done
```

Compléter `deploy/vps.env` : `APP_URL`, les mentions légales `LEGAL_*`, et l'e-mail (Resend) quand le
compte existe. Puis :

```bash
docker compose --profile production up -d --build
docker compose exec app npm run setup -- --email admin@client.ma --name "Prénom Nom"
```

`setup` crée la base vide et le premier administrateur, et affiche **une seule fois** un mot de passe
provisoire. À la première connexion : nouveau mot de passe, puis double authentification (application
Google Authenticator ou Microsoft Authenticator) et dix codes de secours à garder. Ensuite :

1. **Structure des élevages** (`/structure`) : saisie, ou import du fichier
   `livraison/modeles/structure-elevages.csv` (`/structure/import`, modèle téléchargeable sur la page).
2. **Utilisateurs** : chaque compte reçoit un mot de passe provisoire affiché une fois, remplacé par la
   personne à sa première connexion. Double authentification obligatoire pour Administrateur,
   Responsable qualité et Direction.
3. **Lots** : créés dans l'application (menu Lots).

Le profil `production` démarre aussi le service `scheduler` : tâches toutes les 5 minutes, sauvegarde
vérifiée chaque nuit (02:30, heure du Maroc) dans `./backups`, gardée 14 jours (`BACKUP_KEEP_DAYS`).
**Copier ces sauvegardes hors du VPS** chaque jour (autre serveur, stockage objet) :

```bash
crontab -e
# 15 3 * * * rsync -a /chemin/biovolailles-prod/backups/ sauvegarde@autre-serveur:/backups/biovolailles/
```

Surveillance : faire appeler `https://biovolailles.brandhubos.cloud/api/v1/health/ready` toutes les
5 minutes par un service externe (UptimeRobot, Better Stack…) ; les erreurs serveur partent par e-mail
à `ERRORS_NOTIFY_TO` quand l'e-mail est configuré. Page **Administration → Exploitation** : ce qui
s'est arrêté (schéma, journal, règles, purge, fuseau horaire, clés, mentions légales).

Avant d'y mettre des données réelles : déclaration CNDP (loi 09-08) et mentions légales complétées.

Les tâches planifiées ne tournent **pas** sur l'instance de démonstration : ses données sont figées en
août–octobre 2026, et la purge des mesures brutes de plus de 90 jours les effacerait.
