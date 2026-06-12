# 🐳 Documentation Docker — Road Flow

## Table des matières

1. [Vue d'ensemble](#1-vue-densemble)
2. [Architecture des conteneurs](#2-architecture-des-conteneurs)
3. [Analyse détaillée des Dockerfiles](#3-analyse-détaillée-des-dockerfiles)
4. [Réseau et DNS](#4-réseau-et-dns)
5. [Volumes et données persistantes](#5-volumes-et-données-persistantes)
6. [Santé des services (Healthchecks)](#6-santé-des-services-healthchecks)
7. [Chaînes de dépendance](#7-chaînes-de-dépendance)
8. [Profiles Docker Compose](#8-profiles-docker-compose)
9. [Variables d'environnement](#9-variables-denvironnement)
10. [Build et optimisation](#10-build-et-optimisation)
11. [Makefile — commandes de gestion](#11-makefile--commandes-de-gestion)
12. [Dépannage Docker](#12-dépannage-docker)
13. [Scénarios d'utilisation](#13-scénarios-dutilisation)

---

## 1. Vue d'ensemble

Le projet **Road Flow** est entièrement conteneurisé avec Docker. Il se compose de **5 services** orchestrés par Docker Compose, tournant sur un réseau bridge interne.

### Services

| Service | Image | Build context | Dépend de | Profil |
|---|---|---|---|---|
| `kafka` | `apache/kafka:3.8.0` | — (image officielle) | — | *par défaut* |
| `frontend` | `road-traffic-pred-frontend` | `.` (racine) | `backend` | *par défaut* |
| `backend` | `road-traffic-pred-backend` | `./mini-services/api` | `kafka` (healthy) | *par défaut* |
| `simulator` | `road-traffic-pred-simulator` | `./mini-services/simulator` | `kafka` + `backend` | `full` |
| `spark-processor` | `road-traffic-pred-spark-processor` | `./mini-services/spark` | `kafka` + `backend` | `full` |

### Topologie réseau

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Docker Bridge Network                           │
│                  road-traffic-pred_default                          │
│                                                                     │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐      │
│  │   frontend   │───▶│   backend    │───▶│      kafka       │      │
│  │    :3000     │    │    :8000     │    │     :9092        │      │
│  └──────────────┘    └──────┬───────┘    └──────────────────┘      │
│                             │                                      │
│                    ┌────────┴────────┐                             │
│                    ▼                 ▼                              │
│           ┌──────────────┐  ┌──────────────────┐                   │
│           │  simulator   │  │ spark-processor  │                   │
│           │    :8001     │  │                  │                   │
│           └──────────────┘  └──────────────────┘                   │
│                                                                     │
│  Volumes : kafka_data (persistant)                                 │
│  Montages : ./certs → /app/certs (ro)                              │
│             ./data  → /app/data  (ro)                              │
│             ./models → /app/models (ro)                            │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Architecture des conteneurs

### 2.1 Diagramme de démarrage

```
Temps
│
├──▶ docker compose up -d
│
├──▶ [kafka]     Démarre le broker KRaft (pas de Zookeeper)
│     │          Healthcheck : kafka-broker-api-versions.sh
│     │          Port : 9092 exposé
│     │
│     ├──▶ [backend]   Attend que kafka soit healthy
│     │     │          Healthcheck : /health endpoint
│     │     │          Port : 8000 exposé
│     │     │
│     │     ├──▶ [frontend]  Démarre après backend
│     │     │     │          Healthcheck : requête HTTP :3000
│     │     │     │          Port : 3000 exposé
│     │     │
│     │     ├──▶ [simulator] (profil full)
│     │     │     │          Attend kafka + backend
│     │     │     │          Aucun healthcheck
│     │     │     │          Port : 8001 exposé
│     │     │
│     │     └──▶ [spark-processor] (profil full)
│     │               Attend kafka + backend
│     │               Aucun healthcheck
│     │               Aucun port exposé
│     │
│     └──▶ Tout est "Up (healthy)" ✔️
```

### 2.2 Ordonnancement des dépendances

```
kafka (healthy)
  │
  ├──▶ backend (healthy)
  │     │
  │     ├──▶ frontend (healthy)
  │     │
  │     ├──▶ simulator (running)
  │     │
  │     └──▶ spark-processor (running)
```

### 2.3 Politique de redémarrage

Tous les services utilisent `restart: unless-stopped`. Cela signifie :

- Si un conteneur plante, Docker le relance automatiquement
- Si Docker lui-même redémarre, les conteneurs redémarrent aussi
- Un `docker stop` manuel empêche le redémarrage jusqu'au prochain `docker start`

---

## 3. Analyse détaillée des Dockerfiles

### 3.1 Frontend (`Dockerfile` — racine du projet)

**Type :** Multi-stage build (2 stages)

```dockerfile
# Stage 1 : Builder — installation des dépendances + compilation Next.js
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN NODE_OPTIONS="--max-old-space-size=4096" npm install

COPY . .

# Génération du client Prisma (optionnel — ne bloque pas si absent)
ARG DATABASE_URL=file:./db/custom.db
RUN npx prisma generate 2>/dev/null || echo "  ⚡ No Prisma schema found, skipping"

# Les variables NEXT_PUBLIC_* sont cuites dans le bundle JS au build time
ARG NEXT_PUBLIC_API_URL=http://localhost:8000
ARG NEXT_PUBLIC_SIMULATOR_URL=http://localhost:8001
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_SIMULATOR_URL=$NEXT_PUBLIC_SIMULATOR_URL

RUN NODE_OPTIONS="--max-old-space-size=4096" npx next build

# Copie des artefacts standalone
RUN cp -r .next/static .next/standalone/.next/ && cp -r public .next/standalone/

# Stage 2 : Runner — image de production minimale
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000
CMD ["node", "server.js"]
```

**Points clés :**
- **Multi-stage** : le builder contient tous les outils de compilation (500+ Mo), le runner est minimal (~150 Mo)
- **Standalone output** : Next.js compile en mode standalone, produisant un `server.js` autonome avec les fichiers statiques
- **Build-time args** : `NEXT_PUBLIC_API_URL` et `NEXT_PUBLIC_SIMULATOR_URL` sont injectés au build (Next.js les incorpore dans le JS client)
- **Prisma optionnel** : la génération du client Prisma ne bloque pas si le schéma est absent
- **Max old space** : 4 Go alloués à Node pour éviter les erreurs heap lors de la compilation

### 3.2 Backend API (`mini-services/api/Dockerfile`)

```dockerfile
FROM python:3.11-slim
WORKDIR /app

RUN apt-get update && apt-get install -y gcc \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

**Points clés :**
- **Python 3.11-slim** : image légère (~120 Mo) contenant l'essentiel
- **gcc** : installé car certaines dépendances Python (ex : `kafka-python` avec extensions C) nécessitent un compilateur à l'installation pip
- **--no-cache-dir** : évite de remplir le cache pip dans l'image
- **R purge des apt lists** : réduit la taille de l'image finale

**Dépendances** (`requirements.txt`) :

```
fastapi==0.104.1
uvicorn[standard]==0.24.0
pydantic==2.5.0
python-multipart==0.0.6
kafka-python==2.0.2
python-dotenv==1.0.0
aiofiles==23.2.1
websockets==12.0
```

### 3.3 Simulateur (`mini-services/simulator/Dockerfile`)

```dockerfile
FROM python:3.11-slim
WORKDIR /app

RUN apt-get update && apt-get install -y gcc \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["python", "simulator.py"]
```

**Points clés :**
- Structure identique au backend (même image de base)
- `CMD ["python", "simulator.py"]` : lance directement le script Python (pas de framework web, bien que FastAPI soit importé)

**Dépendances** (`requirements.txt`) :

```
pandas==2.1.3
httpx==0.25.2
kafka-python==2.0.2
python-dotenv==1.0.0
fastapi==0.104.1
uvicorn[standard]==0.24.0
```

### 3.4 Spark Processor (`mini-services/spark/Dockerfile`)

```dockerfile
FROM python:3.11-slim

# Java requis par PySpark
RUN apt-get update && apt-get install -y \
    openjdk-21-jre wget \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

ENV PYSPARK_PYTHON=python3
ENV PYSPARK_DRIVER_PYTHON=python3

# Pré-téléchargement des connecteurs Kafka Spark (évite les soucis DNS au runtime)
RUN mkdir -p /app/jars && \
    wget -q -O /app/jars/spark-sql-kafka-0-10_2.12-3.5.4.jar \
    "https://repo1.maven.org/..." && \
    wget -q -O /app/jars/kafka-clients-3.5.1.jar \
    "https://repo1.maven.org/..." && \
    wget -q -O /app/jars/spark-token-provider-kafka-0-10_2.12-3.5.4.jar \
    "https://repo1.maven.org/..." && \
    wget -q -O /app/jars/commons-pool2-2.11.1.jar \
    "https://repo1.maven.org/..." && \
    echo "✅ Spark Kafka jars downloaded"

WORKDIR /app
COPY spark_processor.py traffic_gnn.py ./

ENTRYPOINT []
CMD ["spark-submit", "--master", "local[*]", \
     "--jars", "/app/jars/*", \
     "spark_processor.py"]
```

**Points clés :**
- **openjdk-21-jre** : Spark est écrit en Java, nécessite une JRE (attention : la version Java doit être compatible avec Spark 3.5)
- **Pré-téléchargement des JARs** : les connecteurs Kafka (`spark-sql-kafka`, `kafka-clients`, etc.) sont téléchargés au build plutôt qu'au runtime. Cela évite les échecs de résolution DNS lors du démarrage du job Spark
- **ENTRYPOINT []** : vide intentionnellement, car `spark-submit` gère lui-même son entrypoint
- **Spark local mode** : `--master local[*]` utilise tous les cœurs CPU disponibles sans cluster distribué
- **JARs chargés via wildcard** : `--jars /app/jars/*` inclut automatiquement tous les fichiers .jar

**Dépendances** (`requirements.txt`) :

```
pyspark==3.5.4
torch==2.2.0
torch-geometric==2.5.3
kafka-python==2.0.2
pandas==2.1.3
numpy==1.24.3
scikit-learn==1.8.0
joblib==1.3.2
python-dotenv==1.0.0
```

### 3.5 Kafka — image officielle

Le service `kafka` utilise l'image officielle `apache/kafka:3.8.0` sans Dockerfile personnalisé.

```yaml
kafka:
  image: apache/kafka:3.8.0
```

**Caractéristiques :**
- Image officielle Apache, maintenue par la communauté
- Basée sur `eclipse-temurin:17-jre` (Java 17)
- Taille : ~350 Mo
- Configure automatiquement les répertoires de logs au premier démarrage

---

## 4. Réseau et DNS

### 4.1 Réseau par défaut

Docker Compose crée automatiquement un réseau bridge nommé `road-traffic-pred_default`. Les services communiquent entre eux par leur nom de service.

| Hostname interne | Adresse accessible |
|---|---|
| `kafka` | `kafka:9092` |
| `backend` | `backend:8000` |
| `frontend` | `frontend:3000` |
| `simulator` | `simulator:8001` |
| `spark-processor` | (aucun port exposé) |

### 4.2 DNS personnalisé

Les services `backend`, `simulator` et `spark-processor` ont un DNS explicite :

```yaml
dns:
  - 8.8.8.8
  - 1.1.1.1
```

**Utilité** : ces services se connectent à Kafka. En mode local, le DNS Docker résout `kafka` via le réseau interne. En mode Aiven Cloud, le nom de domaine Aiven est résolu via 8.8.8.8/1.1.1.1. Sans DNS explicite, certains hôtes Docker peinent à résoudre les domaines externes.

### 4.3 Kafka advertised listeners

```yaml
KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://kafka:9092
```

**Explication** : `ADVERTISED_LISTENERS` est l'adresse que Kafka annonce aux consommateurs/producteurs. Ici, on utilise `kafka:9092` (le nom du service Docker) pour que les autres conteneurs puissent se connecter. Si on mettait `localhost:9092`, les autres conteneurs ne pourraient pas joindre Kafka (car `localhost` pour un conteneur, c'est lui-même).

### 4.4 Build network (Linux uniquement)

```makefile
UNAME_S := $(shell uname -s)
BUILD_NET := $(if $(filter Linux,$(UNAME_S)),--network=host,)
```

Sur Linux, le flag `--network=host` est ajouté aux builds Docker. Cela permet à Docker de résoudre les noms DNS lors du `pip install` et `npm install` dans les Dockerfiles. Sans cela, certaines résolutions DNS échouent pendant le build sur Linux.

---

## 5. Volumes et données persistantes

### 5.1 Volume nommé : `kafka_data`

```yaml
volumes:
  - kafka_data:/var/lib/kafka/data

# En bas du fichier :
volumes:
  kafka_data:
```

Persiste les logs de Kafka entre les redémarrages. Sans ce volume, Kafka devrait rejouer l'ensemble du log à chaque démarrage et les topics seraient perdus.

### 5.2 Montages bind (lecture seule)

```yaml
# Certificats SSL mTLS (Aiven Cloud)
volumes:
  - ./certs:/app/certs:ro
```
Monté dans : `backend`, `simulator`, `spark-processor`
Contient : `ca.pem`, `service.cert`, `service.key`

```yaml
# Données CSV d'entraînement/test
volumes:
  - ./data:/app/data:ro
```
Monté dans : `simulator` uniquement
Contient : `test_gnn.csv`

```yaml
# Modèle entraîné + scaler
volumes:
  - ./models:/app/models:ro
```
Monté dans : `spark-processor` uniquement
Contient : `gnn_model.pth`, `scaler_y.pkl`

**Pourquoi en lecture seule (`:ro`) ?** Aucun service ne doit modifier ces fichiers. La lecture seule est une bonne pratique de sécurité.

### 5.3 Cycle de vie des volumes

La commande `make down` utilise `-v` (ou `--volumes`) pour supprimer les volumes :

```makefile
down:
    docker compose --profile full down -v 2>/dev/null || true
    docker compose down -v 2>/dev/null || true
```

Cela détruit `kafka_data`. Les montages bind (`.env`, `certs/`, `data/`, `models/`) ne sont pas affectés car ce sont des répertoires du host.

---

## 6. Santé des services (Healthchecks)

### 6.1 Kafka

```yaml
healthcheck:
  test: ["CMD-SHELL", "/opt/kafka/bin/kafka-broker-api-versions.sh --bootstrap-server localhost:9092 > /dev/null 2>&1"]
  interval: 15s
  timeout: 5s
  retries: 10
  start_period: 45s
```

- Utilise le script officiel `kafka-broker-api-versions.sh`
- Vérifie que le broker répond sur le port 9092
- `start_period: 45s` : laisse à Kafka le temps de formater les logs KRaft au premier démarrage
- 10 tentatives max (15s × 10 = 150s avant de déclarer le service comme défaillant)

### 6.2 Backend

```yaml
healthcheck:
  test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8000/health').read()"]
  interval: 15s
  timeout: 5s
  retries: 5
  start_period: 30s
```

- Vérifie que le endpoint `/health` répond (code HTTP 200)
- 5 tentatives max avant déclaration d'échec

### 6.3 Frontend

```yaml
healthcheck:
  test: ["CMD", "node", "-e", "require('http').get('http://localhost:3000/', r => { process.exit(r.statusCode === 200 ? 0 : 1) })"]
  interval: 30s
  timeout: 10s
  retries: 5
  start_period: 40s
```

- Vérifie que le serveur Next.js répond HTTP 200 sur la page d'accueil
- Intervalle plus long (30s) car c'est un service web moins critique
- `start_period: 40s` : Next.js met du temps à compiler au premier démarrage (surtout sans cache)

### 6.4 Simulateur et Spark Processor

**Pas de healthcheck.** Ces services n'exposent pas de port HTTP ou d'endpoint simple à sonder. Leur bon fonctionnement est vérifié via les logs (`make logs`). Ils dépendent des healthchecks de `kafka` et `backend` pour s'assurer que l'infrastructure est prête.

### 6.5 Visualisation des healthchecks

```bash
docker compose --profile full ps
```

La colonne `STATUS` montre :
- `Up` — le conteneur tourne
- `Up (healthy)` — le conteneur tourne ET le healthcheck passe
- `Up (unhealthy)` — le conteneur tourne mais le healthcheck échoue

---

## 7. Chaînes de dépendance

### 7.1 Dépendances conditionnelles

Le projet utilise `depends_on` avec des conditions explicites :

```yaml
backend:
  depends_on:
    kafka:
      condition: service_healthy   # ← attend que Kafka soit healthy

simulator:
  depends_on:
    backend:
      condition: service_started   # ← attend que backend soit démarré (pas healthy)
    kafka:
      condition: service_healthy   # ← attend que Kafka soit healthy

spark-processor:
  depends_on:
    backend:
      condition: service_started
    kafka:
      condition: service_healthy
```

**Différence entre `service_started` et `service_healthy` :**
- `service_started` : le conteneur est lancé (mais peut être en plein démarrage)
- `service_healthy` : le conteneur est lancé ET le healthcheck a passé

### 7.2 Problème connu

Le simulateur et spark-processor dépendent de `backend` avec `service_started`. En théorie, ils devraient attendre `service_healthy`. En pratique, le démarrage est :
1. Kafka healthy → backend démarre
2. Backend met ~5s à devenir healthy (uvicorn + consumer Kafka)
3. Simulateur et spark démarrent en parallèle de l'attente healthcheck de backend

Si le backend n'est pas encore prêt, le simulateur implémente une boucle de retry dans son code Python :

```python
# Dans le constructeur du simulateur :
def wait_for_backend(self, retries=30, delay=2):
    for i in range(retries):
        try:
            resp = httpx.get("http://backend:8000/health")
            if resp.status_code == 200:
                return True
        except Exception:
            pass
        time.sleep(delay)
    return False
```

### 7.3 Graphe de dépendance complet

```
                    ┌───────────┐
                    │   kafka   │
                    └─────┬─────┘
                          │ condition: service_healthy
                          ▼
                    ┌───────────┐
                    │  backend  │
                    └──┬───┬───┘
                       │   │
        ┌──────────────┘   └──────────────┐
        │ condition:        condition:    │
        │ service_started   service_started│
        ▼                                  ▼
  ┌───────────┐                    ┌───────────────┐
  │ simulator │                    │ spark-process │
  └───────────┘                    └───────────────┘
        │                                  │
        └─── tous deux dépendent aussi ─────┘
                  de kafka (healthy)
```

---

## 8. Profiles Docker Compose

### 8.1 Principe

Les services `simulator` et `spark-processor` sont sous `profiles: [full]` :

```yaml
simulator:
  profiles:
    - full

spark-processor:
  profiles:
    - full
```

**Cela signifie :**
- `docker compose up -d` → démarre seulement `kafka`, `backend`, `frontend`
- `docker compose --profile full up -d` → démarre TOUS les services

### 8.2 Commandes associées

```bash
# Core uniquement (dev rapide)
docker compose up -d

# Tout le stack (ML + simulation)
docker compose --profile full up -d

# Arrêter tout
docker compose --profile full down -v
docker compose down -v
```

### 8.3 Pourquoi des profiles ?

- **Temps de démarrage** : le spark-processor charge PyTorch, Spark, le modèle GNN (~30s). Inutile de l'attendre si on travaille seulement sur le frontend.
- **Ressources** : le spark-processor utilise ~2 Go RAM. Sur une machine à 8 Go, c'est significatif.
- **Débogage ciblé** : on peut tester le simulateur indépendamment de Spark, ou vice-versa.

---

## 9. Variables d'environnement

### 9.1 Injection

Les variables sont injectées par **trois mécanismes** :

```yaml
backend:
  env_file:                      # 1. Fichier .env (chargé d'abord)
    - .env
  environment:                   # 2. Variables explicites (écrasent .env)
    - KAFKA_HOST=${KAFKA_HOST:-kafka}   # Valeur de .env, ou "kafka" par défaut
    - KAFKA_PORT=${KAFKA_PORT:-9092}
    - KAFKA_SSL_CA=${KAFKA_SSL_CA}
    - KAFKA_SSL_CERT=${KAFKA_SSL_CERT}
    - KAFKA_SSL_KEY=${KAFKA_SSL_KEY}
```

**Ordre de précédence :**
1. `environment` dans docker-compose.yml
2. `env_file` (.env)
3. Shell environment (au moment du `docker compose up`)

### 9.2 Syntaxe des valeurs par défaut

```yaml
KAFKA_HOST=${KAFKA_HOST:-kafka}
```

Signifie : « utilise la valeur de la variable `KAFKA_HOST` si elle est définie (dans `.env` ou le shell), sinon utilise `kafka` comme valeur par défaut ».

### 9.3 Variables par service

| Variable | Services | Description |
|---|---|---|
| `KAFKA_HOST` | backend, simulator, spark | Hôte Kafka (défaut: `kafka`) |
| `KAFKA_PORT` | backend, simulator, spark | Port Kafka (défaut: `9092`) |
| `KAFKA_SSL_CA` | backend, simulator, spark | Chemin du certificat CA |
| `KAFKA_SSL_CERT` | backend, simulator, spark | Chemin du certificat client |
| `KAFKA_SSL_KEY` | backend, simulator, spark | Chemin de la clé privée |
| `CSV_PATH` | simulator | Chemin du fichier CSV |
| `MODEL_PATH` | spark | Chemin du modèle .pth |
| `SCALER_Y_PATH` | spark | Chemin du scaler .pkl |
| `SPARK_RPC_AUTHENTICATION_ENABLED` | spark | Désactive l'auth Spark RPC |
| `SPARK_RPC_ENCRYPTION_ENABLED` | spark | Désactive le chiffrement Spark |
| `NODE_ENV` | frontend | Mode production |
| `HOSTNAME` | frontend | Écouter sur toutes les interfaces |

### 9.4 Fichiers d'environnement

| Fichier | Usage |
|---|---|
| `.env` | Config par défaut (Kafka local) |
| `.env.aiven` | Config pour Aiven Cloud (prêt à copier) |
| `.env.example` | Exemple de configuration minimale |

---

## 10. Build et optimisation

### 10.1 Build parallèle

Le `Makefile` build les 4 images en parallèle :

```makefile
up:
    docker build ... road-traffic-pred-frontend . & pids="$! ..."
    docker build ... road-traffic-pred-backend ./mini-services/api & pids="$! ..."
    docker build ... road-traffic-pred-simulator ./mini-services/simulator & pids="$! ..."
    docker build ... road-traffic-pred-spark-processor ./mini-services/spark & pids="$! ..."
    wait $$pids  # ← attend que TOUS les builds soient finis
```

Les builds s'exécutent en parallèle. Le temps total est celui du build le plus long (spark-processor avec PyTorch).

### 10.2 Cache Docker

Les Dockerfiles sont organisés pour maximiser le cache :

```
1. FROM python:3.11-slim        → change rarement → cache
2. RUN apt-get install ...      → change rarement → cache
3. COPY requirements.txt .      → change peu → cache
4. RUN pip install ...          → change peu → cache
5. COPY . .                     → change souvent → INVALIDE LE CACHE À PARTIR D'ICI
```

Astuce : si tu modifies `requirements.txt`, les étapes 1-3 sont en cache, seule l'étape 4 est reconstruite.

### 10.3 `.dockerignore`

Le fichier `.dockerignore` de la racine exclut du contexte de build :

```
node_modules/          # Réinstallé dans le conteneur
.next/ /out/ /build/   # Généré pendant le build
.env*                  # Jamais dans l'image
certs/ data/ models/   # Montés au runtime
mini-services/         # Build séparé (contexte différent)
*.md *.sh              # Docs et scripts inutiles dans l'image
.git/ .claude/         # Outils de dev
```

**Pourquoi c'est important** : le contexte de build (tout ce qui est envoyé au daemon Docker) est plus rapide à transférer. Sans `.dockerignore`, le `COPY . .` inclurait `node_modules` (500+ Mo) et ralentirait considérablement le build.

### 10.4 Spark — pré-téléchargement des JARs

```dockerfile
RUN mkdir -p /app/jars && \
    wget -q -O /app/jars/spark-sql-kafka-0-10_2.12-3.5.4.jar "https://repo1.maven.org/..."
```

**Pourquoi ?** Spark télécharge les connecteurs Kafka au moment du `readStream.format("kafka")`. Ce téléchargement runtime peut échouer si le DNS ne résout pas `repo1.maven.org` (problème fréquent dans les conteneurs Docker). En les pré-téléchargeant au build, on garantit leur disponibilité.

### 10.5 Spark — sécurité simplifiée

```yaml
environment:
  - SPARK_RPC_AUTHENTICATION_ENABLED=no
  - SPARK_RPC_ENCRYPTION_ENABLED=no
```

En mode `local[*]`, Spark n'a pas besoin d'authentifier ou chiffrer ses communications RPC (tout est dans le même processus). Ces flags désactivent les avertissements de sécurité superflus dans les logs.

---

## 11. Makefile — commandes de gestion

### 11.1 Tableau des commandes

| Commande | Description | Équivalent Docker |
|---|---|---|
| `make up` | Build parallèle + lancement full stack | `docker compose --profile full up -d` |
| `make up-core` | Build + lancement core (frontend + api + kafka) | `docker compose up -d` |
| `make down` | Arrêt + suppression des volumes | `docker compose --profile full down -v` |
| `make logs` | Logs en temps réel de tous les services | `docker compose --profile full logs -f` |
| `make ps` | Statut des conteneurs | `docker compose --profile full ps` |
| `make rebuild` | Reconstruction complète sans cache + redémarrage | build + compose up combinés |

### 11.2 Détail de `make up`

```
1. Build parallèle des 4 images :
   - road-traffic-pred-frontend (Dockerfile racine)
   - road-traffic-pred-backend (mini-services/api/Dockerfile)
   - road-traffic-pred-simulator (mini-services/simulator/Dockerfile)
   - road-traffic-pred-spark-processor (mini-services/spark/Dockerfile)

2. Lancement docker compose --profile full up -d
   - kafka      (image officielle, pas de build)
   - frontend   (déjà buildé)
   - backend    (déjà buildé)
   - simulator  (déjà buildé, profil full)
   - spark (déjà buildé, profil full)
```

### 11.3 Détail de `make rebuild`

```
1. docker compose --profile full down -v  → arrête tout + supprime volumes
2. docker build --no-cache ...  → reconstruction sans cache Docker
3. docker compose --profile full up -d  → redémarrage
```

Utile quand :
- Une dépendance a changé (pip, npm)
- Le cache Docker est corrompu
- On veut une image 100% fraîche

---

## 12. Dépannage Docker

### 12.1 Problèmes fréquents et solutions

| Problème | Cause probable | Solution |
|---|---|---|
| `port already allocated` | Un conteneur existant utilise le port | `docker stop <conteneur>` ou changer le port dans `docker-compose.yml` |
| `No such file or directory` pour un volume | Le dossier local n'existe pas | `mkdir -p certs/ data/ models/` |
| `Failed to create new KafkaAdminClient` | Kafka pas encore prêt | Attendre le healthcheck, vérifier `make ps` |
| `pip install` échoue pendant le build | Problème DNS ou réseau | Vérifier `--network=host` dans le Makefile (Linux uniquement) |
| Spark ne trouve pas `kafka` | Mauvais `KAFKA_HOST` | Vérifier que `KAFKA_HOST=kafka` dans `.env` |
| `Permission denied` sur un volume | Le conteneur n'a pas les droits | Vérifier les permissions : `chmod 644 certs/*` |
| L'image ne se rebuild pas | Docker utilise le cache | Utiliser `docker build --no-cache` ou `make rebuild` |
| `exec: "spark-submit": not found` | Java absent ou Spark corrompu | Rebuild l'image spark : `docker build --no-cache mini-services/spark` |

### 12.2 Commandes de diagnostic

```bash
# Voir les logs d'un service spécifique
docker compose logs backend
docker compose logs spark-processor

# Voir les logs en temps réel
docker compose logs -f

# Voir les ressources utilisées
docker stats

# Inspecter le réseau
docker network inspect road-traffic-pred_default

# Voir les healthchecks
docker inspect --format='{{.State.Health.Status}}' road-traffic-pred-kafka-1

# Nettoyer tout (images + conteneurs + volumes inutilisés)
docker system prune -a --volumes
```

### 12.3 Réinitialisation complète

```bash
# Arrêter et supprimer volumes
make down

# Nettoyer les images inutilisées
docker system prune -f

# Rebuild et relance
make rebuild
```

---

## 13. Scénarios d'utilisation

### 13.1 Développement frontend uniquement

```bash
make up-core
# → kafka, backend, frontend sans simulation ni ML
# → http://localhost:3000 pour le frontend
# → http://localhost:8000/docs pour l'API
```

### 13.2 Test du simulateur uniquement

```bash
make up-core
# puis manuellement pour activer le simulateur :
docker compose run --rm simulator
```

### 13.3 Test de Spark uniquement

```bash
make up-core
# puis :
docker compose --profile full up -d --no-deps spark-processor
```

### 13.4 Mode Aiven Cloud (Kafka managé)

```bash
# 1. Commenter le service kafka dans docker-compose.yml
# 2. Éditer .env avec les identifiants Aiven
# 3. Placer les certificats dans certs/
# 4. Lancer :
make up
```

### 13.5 Reconstruction complète après mise à jour de code

```bash
# Rebuild seulement un service modifié
docker compose build backend

# Relancer sans rebuild
docker compose up -d --no-build

# Ou tout reconstruire
make rebuild
```

---

## Annexe : Schéma d'ensemble

```
┌────────────────────────────────────────────────────────────────────────────┐
│                     docker-compose.yml                                     │
│                                                                            │
│  services:                                                                 │
│    kafka:          apache/kafka:3.8.0   :9092   (KRaft, pas de ZK)        │
│    frontend:       road-traffic-pred-frontend  :3000                       │
│    backend:        road-traffic-pred-backend   :8000                       │
│    simulator:      road-traffic-pred-simulator :8001  [profil: full]       │
│    spark-processor:road-traffic-pred-spark     :—      [profil: full]      │
│                                                                            │
│  volumes:  kafka_data                                                      │
│                                                                            │
│  Réseau : road-traffic-pred_default (bridge, DNS interne)                  │
│                                                                            │
│  Builds séparés :                                                          │
│    frontend  ← Dockerfile (./)            ← multi-stage Node.js           │
│    backend   ← Dockerfile (./mini-services/api) ← Python 3.11-slim        │
│    simulator ← Dockerfile (./mini-services/simulator) ← Python 3.11-slim  │
│    spark     ← Dockerfile (./mini-services/spark) ← Python 3.11-slim + JDK│
│    kafka     ← image officielle, pas de build                              │
└────────────────────────────────────────────────────────────────────────────┘
```
