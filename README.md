# Road Flow — Prédiction de Trafic en Temps Réel

**Road Flow** est un système de prédiction de trafic routier en temps réel qui diffuse des données de capteurs via Apache Kafka, exécute l'inférence d'un **GNN (Graph Neural Network)** avec PySpark Structured Streaming, et visualise les prédictions sur un tableau de bord 3D interactif.

Le système suit une **architecture Kappa** — tout est un flux, pas de batch, pas de base de données. Du CSV à la visualisation 3D en moins de 500ms.

```
┌──────────┐    ┌──────────┐    ┌──────────────────┐    ┌──────────┐    ┌───────────┐    ┌──────────┐
│ Capteurs │───▶│  Kafka   │───▶│   PySpark/GNN    │───▶│  Kafka   │───▶│  FastAPI  │───▶│  Next.js │
│(Simulateur)│   │flux_data │    │  (ML temps réel) │    │predictions│    │ (Passerelle)│   │Dashboard │
└──────────┘    └──────────┘    └──────────────────┘    └──────────┘    └───────────┘    └──────────┘
                                                                              │
                                                                              ▼
                                                                       asyncio.Queue
                                                                              │
                                                                       WebSocket
```

---

## 🚀 Démarrage Rapide

### Prérequis
- Docker & Docker Compose v2
- 4 Go+ de RAM alloués à Docker

### Lancement en une commande

```bash
git clone https://github.com/joel710/Traffic-Prediction.git && cd road-traffic-pred
cp .env.example .env
make up
```

Ouvre ensuite **http://localhost:3000/dashboard**.

| Commande | Services démarrés |
|---|---|
| `make up` | Full stack : Frontend + API + Kafka + Simulateur + Spark |
| `make up-core` | Core uniquement : Frontend + API + Kafka (pas de ML/simulation) |
| `make logs` | Suivre les logs de tous les conteneurs |
| `make down` | Tout arrêter et nettoyer les volumes |
| `make rebuild` | Reconstruction complète depuis zéro |

### URLs

| Service | URL |
|---|---|
| Tableau de bord | http://localhost:3000/dashboard |
| Documentation API (Swagger) | http://localhost:8000/docs |
| Santé de l'API | http://localhost:8000/health |
| Interface Spark | http://localhost:4040 |
| Statut du simulateur | http://localhost:8001/status |

---

## 🧱 Architecture

### Services

| Service | Technologie | Port | Rôle |
|---|---|---|---|
| `frontend` | Next.js 15, Three.js, MapLibre GL | `3000` | Tableau de bord trafic 3D temps réel |
| `backend` | FastAPI, WebSockets | `8000` | Consumer Kafka → pont WebSocket |
| `simulator` | FastAPI, kafka-python | `8001` | Rejeu CSV → producteur Kafka |
| `spark-processor` | PySpark 3.5, PyTorch, Kafka | — | Inférence streaming GNN |
| `kafka` | Apache Kafka 3.8 (KRaft) | `9092` | Bus d'événements (sans Zookeeper) |

### Flux de Données — Étape par Étape

```
                          ╔══════════════════════════════════════╗
                          ║         Pipeline de Données          ║
                          ╚══════════════════════════════════════╝

 Fichier CSV ──▶ Simulateur ──▶ Kafka[flux_data] ──▶  Spark/GNN
(test_gnn.csv)   (rejoue les    (topic: flux_data)   (buffer 24 pas)
                 lignes)                                      │
                                                              ▼
                ┌──────────────────────────────────────────────────┐
                │  Modèle TrafficGNN                               │
                │  4 nœuds (jonctions), 14 features/pas           │
                │  Couches GCNConv → Régression par junction      │
                └──────────────────────────────────────────────────┘
                                                              │
                                                              ▼
  Frontend  ◀──  WebSocket  ◀──  FastAPI  ◀──  Kafka[predictions]
(Dashboard)     (asyncio.Queue)   (consumer)   (topic: traffic_predictions)
```

Le système utilise **deux topics Kafka** :
- `flux_data` — relevés bruts des capteurs (produit par le Simulateur, consommé par Spark)
- `traffic_predictions` — sorties du modèle (produit par Spark, consommé par FastAPI)

---

## 📦 Plongée dans chaque Service

### 1. Simulateur (`mini-services/simulator/simulator.py`)

Lit un fichier CSV et publie chaque ligne dans le topic Kafka `flux_data` avec un délai configurable — simulant l'ingestion temps réel de capteurs.

```python
# Boucle de publication principale — une ligne CSV par tick
async def run(self):
    df = pd.read_csv(CSV_PATH)
    df["DateTime"] = pd.to_datetime(df["DateTime"])
    df = df.sort_values("DateTime")
    for _, row in df.iterrows():
        data = row.to_dict()
        data["DateTime"] = data["DateTime"].strftime("%Y-%m-%d %H:%M:%S")
        self.producer.send(TOPIC_INPUT, value=data)
        await asyncio.sleep(STREAM_DELAY)  # ex: 2 secondes
```

**Producteur Kafka** avec fallback d'authentification automatique (SSL → SASL → PLAINTEXT) :

```python
def build_kafka_producer():
    opts = {
        "bootstrap_servers": [BOOTSTRAP_SERVER],  # kafka:9092
        "value_serializer": lambda x: json.dumps(x).encode("utf-8"),
        "acks": "all",
    }
    # Auth à 3 niveaux : mTLS > SASL > PLAINTEXT
    if all([KAFKA_SSL_CA, KAFKA_SSL_CERT, KAFKA_SSL_KEY]):
        opts["security_protocol"] = "SSL"
    elif KAFKA_USERNAME and KAFKA_PASSWORD:
        opts["security_protocol"] = "SASL_SSL"
        opts["sasl_mechanism"] = "PLAIN"
    return KafkaProducer(**opts)
```

Chaque message publié dans `flux_data` ressemble à :

```json
{
  "Junction": 1,
  "DateTime": "2024-06-15 08:30:00",
  "Vehicles": 42,
  "hour_sin": 0.5,
  "hour_cos": 0.86,
  "dow_sin": 0.78,
  "dow_cos": 0.62,
  "month_sin": 0.0,
  "month_cos": 1.0,
  "is_weekend": 0,
  "veh_lag_1": 38.0,
  "veh_lag_2": 41.0,
  "veh_lag_3": 39.0,
  "veh_lag_24": 35.0,
  "veh_ma_6": 40.2,
  "veh_ma_24": 37.8,
  "veh_diff_1": 4.0
}
```

> **14 features** — 6 encodages cycliques temporels (heure, jour de la semaine, mois), 1 binaire (week-end), 7 statistiques dérivées des véhicules (lags, moyennes mobiles, différence première).

---

### 2. Processeur Spark (`mini-services/spark/spark_processor.py`)

Le cerveau ML du système. Utilise **PySpark Structured Streaming** avec `foreachBatch` pour :
1. Consommer les lignes de `flux_data` en micro-batches
2. Bufferiser les 24 derniers pas de temps par junction (fenêtres `deque`)
3. Exécuter le modèle **TrafficGNN** quand les 4 junctions ont assez de données
4. Publier les prédictions dans `traffic_predictions`

**Lecteur Spark streaming :**

```python
df = spark.readStream \
    .format("kafka") \
    .option("kafka.bootstrap.servers", BOOTSTRAP_SERVER) \
    .option("subscribe", TOPIC_INPUT) \
    .load()

json_df = df.select(
    from_json(col("value").cast("string"), input_schema).alias("data")
).select("data.*")

query = json_df.writeStream \
    .foreachBatch(process_microbatch) \
    .start()

query.awaitTermination()
```

**Extraction des features** — chaque ligne Kafka brute est convertie en un vecteur à 14 dimensions :

```python
FEATURE_COLS = [
    "hour_sin", "hour_cos", "dow_sin", "dow_cos", "month_sin", "month_cos",
    "is_weekend",
    "veh_lag_1", "veh_lag_2", "veh_lag_3", "veh_lag_24",
    "veh_ma_6", "veh_ma_24", "veh_diff_1",
]

def extract_14_features(row_dict: dict) -> np.ndarray:
    return np.array([float(row_dict.get(c) or 0) for c in FEATURE_COLS], dtype=np.float32)
```

**Inférence GNN** — s'exécute quand les 4 junctions ont bufferisé 24 pas temporels :

```python
@torch.no_grad()
def predict_all_junctions() -> dict[int, float] | None:
    # Attendre que chaque junction ait une fenêtre complète de 24 pas
    for j in range(1, NUM_NODES + 1):
        if len(feat_window[j]) < SEQ_LEN:  # SEQ_LEN = 24
            return None

    # Empiler : (4 junctions, 24 pas, 14 features)
    sequences = np.stack([
        np.array(list(feat_window[j])) for j in range(1, NUM_NODES + 1)
    ], axis=0)

    # Normaliser seulement les features véhicules (indices 7:14)
    sequences[:, :, 7:14] = (sequences[:, :, 7:14] - mean_y) / std_y

    # Passage dans le GNN
    x = torch.tensor(sequences, dtype=torch.float32).unsqueeze(0)  # (1, 4, 24, 14)
    out = model(x).squeeze(0)  # (4, 1) — une prédiction par junction

    preds = {}
    for i, jid in enumerate(range(1, NUM_NODES + 1)):
        unscaled = float(out[i, 0]) * std_y + mean_y
        preds[jid] = max(0.0, round(unscaled, 2))  # pas de véhicules négatifs

    return preds  # {1: 38.2, 2: 12.7, 3: 25.1, 4: 8.3}
```

**Architecture du modèle** (`TrafficGNN`) :

```python
class TrafficGNN(nn.Module):
    def __init__(self, in_channels=14, hidden_dim=64, seq_len=24, num_nodes=4):
        super().__init__()
        # Convolution temporelle : (batch, 14, seq_len) → (batch, hidden_dim, 1)
        self.temporal_conv = nn.Conv1d(in_channels, hidden_dim, kernel_size=seq_len)
        # Deux couches GCN avec le graphe routier des 4 junctions
        self.gcn1 = GCNConv(hidden_dim, hidden_dim)
        self.gcn2 = GCNConv(hidden_dim, 1)  # une sortie par nœud

    def forward(self, x):
        # x shape : (batch, num_nodes, seq_len, in_channels)
        B, N, T, F = x.shape
        x = x.view(B * N, T, F).permute(0, 2, 1)  # (B*N, F, T)
        x = torch.relu(self.temporal_conv(x)).squeeze(-1)  # (B*N, hidden_dim)
        x = x.view(B, N, -1)  # (B, N, hidden_dim)
        x = torch.relu(self.gcn1(x, edge_index))
        x = self.gcn2(x, edge_index)
        return x  # (B, N, 1)
```

> **Paramètres** : 102 017 — presque tous dans la couche de projection temporelle.

---

### 3. Passerelle FastAPI (`mini-services/api/main.py`)

Le pont entre Kafka et le navigateur. Pas de base de données — tout l'état vit en mémoire dans des `dict` et `deque` Python.

```python
# État en mémoire — pas de Redis, pas de PostgreSQL
current_state: dict[int, dict] = {}              # junction → dernière prédiction
history: dict[int, deque] = defaultdict(          # junction → 2000 dernières prédictions
    lambda: deque(maxlen=2000)
)
```

**Pont Consumer Kafka → asyncio** — un thread d'arrière-plan interroge Kafka et distribue dans la boucle d'événements asyncio :

```python
def kafka_listener(loop):
    """S'exécute dans un thread dédié. Pousse les messages Kafka dans la file asyncio."""
    consumer = build_kafka_consumer()
    for msg in consumer:
        data = msg.value
        junction = data.get("Junction")
        if junction is not None:
            current_state[junction] = data
            history[junction].append(data)
        # Transfert thread-safe vers asyncio
        asyncio.run_coroutine_threadsafe(broadcast_queue.put(data), loop)
```

**Diffusion WebSocket** — distribue les prédictions à tous les clients connectés :

```python
async def broadcast_worker():
    """Coroutine : vide la broadcast_queue et envoie à tous les clients WebSocket."""
    while True:
        data = await broadcast_queue.get()
        dead_clients = []
        for ws in websocket_clients:
            try:
                await ws.send_json(data)
            except Exception:
                dead_clients.append(ws)
        for ws in dead_clients:
            websocket_clients.discard(ws)

@app.websocket("/ws/traffic")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    websocket_clients.add(ws)
    try:
        while True:
            await ws.receive_text()  # keepalive ping
    except Exception:
        pass
    finally:
        websocket_clients.discard(ws)
```

**Auth Kafka** — s'adapte transparentement au local (PLAINTEXT) ou au cloud Aiven (SSL/SASL) :

```python
def build_kafka_consumer() -> KafkaConsumer:
    opts = {
        "bootstrap_servers": [f"{KAFKA_HOST}:{KAFKA_PORT}"],
        "auto_offset_reset": "latest",
        "value_deserializer": lambda v: json.loads(v.decode("utf-8")),
    }
    # SSL mTLS (certificats Aiven)
    if all([KAFKA_SSL_CA, KAFKA_SSL_CERT, KAFKA_SSL_KEY]):
        opts["security_protocol"] = "SSL"
    # SASL_SSL (identifiant/mot de passe Aiven)
    elif KAFKA_USERNAME and KAFKA_PASSWORD:
        opts["security_protocol"] = "SASL_SSL"
    # sinon : PLAINTEXT (pour KRaft local)
    return KafkaConsumer(TOPIC_OUTPUT, **opts)
```

---

### 4. Frontend (`src/`)

Une application **Next.js 15** au rendu hybride. Le tableau de bord utilise :

- **MapLibre GL** — carte 2D avec marqueurs de junctions colorés par niveau de congestion
- **Three.js** — modèles de voitures 3D animées sur le réseau routier à 60 FPS
- **Recharts** — graphiques sparkline pour l'historique du trafic par junction

**Connexion WebSocket avec reconnexion automatique :**

```typescript
// app/dashboard/page.tsx
useEffect(() => {
  const connect = () => {
    const ws = new WebSocket(`ws://localhost:8000/ws/traffic`);
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      updateJunctionState(data);  // junction, véhicules, prédiction, statut
    };
    ws.onclose = () => setTimeout(connect, 5000);  // reconnexion auto
  };
  connect();
}, []);
```

**Métriques de précision du modèle en direct** — buffer glissant de 200 échantillons :

```typescript
const errorsBuffer: number[] = [];

const err = Math.abs(data.Vehicles - data.PredictedVehicles);
errorsBuffer.push(err);
if (errorsBuffer.length > 200) errorsBuffer.shift();

const mae  = errorsBuffer.reduce((a,b) => a+b, 0) / errorsBuffer.length;
const rmse = Math.sqrt(errorsBuffer.reduce((a,b) => a + b*b, 0) / errorsBuffer.length);
const accuracy = Math.max(0, 100 - mae);  // % de précision simplifié
```

**Routage Dijkstra** avec pondération par congestion (recalcul toutes les 3s) :

| État du trafic | Poids de l'arête |
|---|---|
| `fluid` | 1.0× (normal) |
| `moderate` | 3.0× |
| `congested` | 8.0× |

---

### 5. Kafka (`docker-compose.yml`)

Fonctionne en mode **KRaft** (pas de Zookeeper) — plus léger et plus rapide.

```yaml
kafka:
  image: apache/kafka:3.8.0
  environment:
    KAFKA_NODE_ID: 1
    KAFKA_PROCESS_ROLES: broker,controller           # KRaft : processus unique
    KAFKA_LISTENERS: PLAINTEXT://0.0.0.0:9092,CONTROLLER://0.0.0.0:9093
    KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://kafka:9092  # DNS Docker
    KAFKA_CONTROLLER_QUORUM_VOTERS: 1@kafka:9093
    KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1
    CLUSTER_ID: road-traffic-pred-01
```

Les topics sont **créés automatiquement** au premier usage — aucune configuration manuelle nécessaire.

---

## 🧠 Performance du Modèle

### TrafficGNN — MAE par Junction

| Junction | MAE (véhicules) |
|---|---|
| **J1** | 3.73 |
| **J2** | 1.98 |
| **J3** | 2.61 |
| **J4** | 2.13 |

Le modèle a été entraîné sur des vecteurs de 14 features avec des fenêtres de 24 pas temporels, en utilisant un graphe à 4 nœuds dont les arêtes représentent les connexions routières entre junctions.

---

## ⚙️ Configuration

### Environnement (`.env`)

```ini
# Kafka local (par défaut — tourne dans Docker)
KAFKA_HOST=kafka
KAFKA_PORT=9092

# Aiven Cloud (décommenter pour Kafka managé)
# KAFKA_HOST=kafka-xxxx.aivencloud.com
# KAFKA_PORT=17498
# KAFKA_SSL_CA=certs/ca.pem
# KAFKA_SSL_CERT=certs/service.cert
# KAFKA_SSL_KEY=certs/service.key
```

### Basculer vers Aiven Cloud Kafka

```bash
# Éditer .env avec l'hôte/port/credentials Aiven, puis :
docker compose --profile full up -d
```

Aucun changement de code nécessaire — la chaîne de fallback d'authentification (SSL → SASL → PLAINTEXT) détecte automatiquement votre configuration.

---

## 📁 Structure du Projet

```
.
├── docker-compose.yml           # Tous les services + Kafka (KRaft)
├── Makefile                     # up, down, logs, rebuild, ps
├── .env                         # Environnement (Kafka local par défaut)
├── ARCHITECTURE.md              # Conception haut niveau (FR)
├── docs/
│   ├── BACKEND.md               # Plongée dans le backend
│   ├── FRONTEND.md              # Architecture frontend
│   └── INTEGRATION.md           # Cycle de vie des données (FR)
├── mini-services/
│   ├── api/main.py              # FastAPI + WebSocket + consumer Kafka
│   ├── simulator/simulator.py   # Rejeu CSV → producteur Kafka
│   └── spark/
│       ├── spark_processor.py   # PySpark Structured Streaming + GNN
│       └── traffic_gnn.py       # Définition du modèle TrafficGNN
├── src/                         # Frontend Next.js 15
│   ├── app/dashboard/           # Page tableau de bord (hook WebSocket)
│   └── components/traffic/      # Carte, voitures 3D, sparklines, sidebar
├── models/                      # Poids entraînés .pth + scaler
└── data/                        # Jeux de données trafic (CSV)
```

---

## 🔧 Dépannage

| Symptôme | Solution |
|---|---|
| `Failed to create new KafkaAdminClient` | Lancer `docker compose up -d` — Kafka doit être en cours d'exécution |
| Port 3000/8000 déjà utilisé | Changer les ports dans `docker-compose.yml` |
| Spark plante au démarrage | Allouer au moins 4 Go de RAM à Docker |
| Aucune donnée sur le tableau de bord | Vérifier `make logs` — le simulateur doit publier dans `flux_data` |
| Avertissement de version sklearn | Sans danger — le décalage de version est cosmétique |

---

## ✍️ Auteurs

- **Joel ADZONYA** — Recherche IA & Infrastructure principale
- **Ghislaine EKLOU** — Ingénierie des données & Conception de la visualisation
