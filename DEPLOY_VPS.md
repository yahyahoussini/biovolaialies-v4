# Déploiement sur le VPS — BIOVOLAILLES

**Livraison du jour :** instance de **démonstration et de formation** (données fictives, comptes de
démonstration) à `https://biovolailles.brandhubos.cloud`. Ne pas y saisir de données réelles.

L'installation sur données réelles est la prochaine étape (§7) : elle attend la création du premier
administrateur sans données de démonstration, les écrans de structure des élevages et la sécurité des
comptes (changement de mot de passe, double authentification).

Prérequis sur le VPS : Docker avec Docker Compose, et un reverse proxy HTTPS (Nginx, Caddy, Traefik…).
L'application n'écoute que sur `127.0.0.1:3100` ; elle n'est jamais exposée directement.

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

## 7. Installation réelle (prochaine étape — pas aujourd'hui)

À faire avant d'y mettre des données réelles :

1. Création du premier administrateur sur une base vide, sans données de démonstration.
2. Écrans et import de la structure (organisations, coopératives, producteurs, fermes, bâtiments).
3. Sécurité des comptes : changement de mot de passe obligatoire, réinitialisation, double
   authentification pour Administrateur, Responsable qualité et Direction.
4. Une seconde instance avec son propre volume et `DEMO_MODE=false`,
   `DEMO_SNAPSHOT_ON_FIRST_START=false`.
5. Tâches planifiées toutes les 5 minutes (`npm run telemetry:jobs`, voir `EXPLOITATION.md` §4),
   sauvegarde quotidienne (`npm run db:backup`) et copie hors du VPS (`EXPLOITATION.md` §5).
6. Déclaration CNDP (loi 09-08) et mentions légales complétées.

Les tâches planifiées ne tournent **pas** sur l'instance de démonstration : ses données sont figées en
août–octobre 2026, et la purge des mesures brutes de plus de 90 jours les effacerait.
