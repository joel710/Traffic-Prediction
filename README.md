# Road Flow — Real-Time Traffic Prediction

**Road Flow** is a real-time traffic prediction system that streams road sensor data through Apache Kafka, runs GNN (Graph Neural Network) inference with PySpark Structured Streaming, and visualizes predictions on an interactive 3D dashboard.

The system follows a **Kappa architecture** — everything is a stream, no batch layer, no databases. From CSV to 3D visualization in under 500ms.

```
┌──────────┐    ┌──────────┐    ┌──────────────────┐    ┌──────────┐    ┌───────────┐    ┌──────────┐
│  Sensor  │───▶│  Kafka   │───▶│   PySpark/GNN    │───▶│  Kafka   │───▶│  FastAPI  │───▶│  Next.js │
│(Simulator)│    │flux_data │    │  (streaming ML)  │    │predictions│    │ (Gateway) │    │Dashboard │
└──────────┘    └──────────┘    └──────────────────┘    └──────────┘    └───────────┘    └──────────┘
                                                                              │
                                                                              ▼
                                                                       asyncio.Queue
                                                                              │
                                                                       WebSocket (WSS)
```

---

## 🚀 Quick Start

### Prerequisites
- Docker & Docker Compose v2
- 4GB+ RAM allocated to Docker

### One-command launch

```bash
git clone <repo-url> && cd road-traffic-pred
cp .env.example .env
make up
```

Then open **http://localhost:3000/dashboard**.

| Command | What it starts |
|---|---|
| `make up` | Full stack: Frontend + API + Kafka + Simulator + Spark |
| `make up-core` | Core only: Frontend + API + Kafka (no ML/simulation) |
| `make logs` | Follow all container logs |
| `make down` | Stop everything and clean volumes |

### URLs

| Service | URL |
|---|---|
| Dashboard | http://localhost:3000/dashboard |
| API docs (Swagger) | http://localhost:8000/docs |
| API health | http://localhost:8000/health |
| Spark UI | http://localhost:4040 |
| Simulator status | http://localhost:8001/status |

---

## 🧱 Architecture Overview

### Services

| Service | Stack | Port | Role |
|---|---|---|---|
| `frontend` | Next.js 15, Three.js, MapLibre GL | `3000` | Real-time 3D traffic dashboard |
| `backend` | FastAPI, WebSockets | `8000` | Kafka consumer → WebSocket bridge |
| `simulator` | FastAPI, kafka-python | `8001` | CSV replay → Kafka producer |
| `spark-processor` | PySpark 3.5, PyTorch, Kafka | — | Streaming GNN inference |
| `kafka` | Apache Kafka 3.8 (KRaft) | `9092` | Event bus (no Zookeeper) |

### Data Flow — Step by Step

```
                          ╔══════════════════════════════════════╗
                          ║         Data Pipeline                ║
                          ╚══════════════════════════════════════╝

 CSV file  ──▶  Simulator  ──▶  Kafka[flux_data]  ──▶  Spark/GNN
(test_gnn.csv)   (replays rows)   (topic: flux_data)   (24-step buffer)
                                                              │
                                                              ▼
                ┌──────────────────────────────────────────────────┐
                │  TrafficGNN Model                               │
                │  4 nodes (junctions), 14 features/step         │
                │  GCNConv layers → Junction-level regression     │
                └──────────────────────────────────────────────────┘
                                                              │
                                                              ▼
 Frontend  ◀──  WebSocket  ◀──  FastAPI  ◀──  Kafka[predictions]
(Dashboard)    (asyncio.Queue)   (consumer)   (topic: traffic_predictions)
```

The system uses **two Kafka topics**:
- `flux_data` — raw sensor readings (produced by Simulator, consumed by Spark)
- `traffic_predictions` — model outputs (produced by Spark, consumed by FastAPI)

---

## 📦 Service Deep-Dive

### 1. Simulator (`mini-services/simulator/simulator.py`)

Reads a CSV file and publishes each row to the `flux_data` Kafka topic with a configurable delay — simulating real-time sensor ingestion.

```python
# Core publish loop — one CSV row per tick
async def run(self):
    df = pd.read_csv(CSV_PATH)
    df["DateTime"] = pd.to_datetime(df["DateTime"])
    df = df.sort_values("DateTime")
    for _, row in df.iterrows():
        data = row.to_dict()
        data["DateTime"] = data["DateTime"].strftime("%Y-%m-%d %H:%M:%S")
        self.producer.send(TOPIC_INPUT, value=data)
        await asyncio.sleep(STREAM_DELAY)  # e.g. 2 seconds
```

**Kafka producer** with automatic auth fallback (SSL → SASL → PLAINTEXT):

```python
def build_kafka_producer():
    opts = {
        "bootstrap_servers": [BOOTSTRAP_SERVER],  # kafka:9092
        "value_serializer": lambda x: json.dumps(x).encode("utf-8"),
        "acks": "all",
    }
    # Three-tier auth: mTLS > SASL > PLAINTEXT
    if all([KAFKA_SSL_CA, KAFKA_SSL_CERT, KAFKA_SSL_KEY]):
        opts["security_protocol"] = "SSL"
    elif KAFKA_USERNAME and KAFKA_PASSWORD:
        opts["security_protocol"] = "SASL_SSL"
        opts["sasl_mechanism"] = "PLAIN"
    return KafkaProducer(**opts)
```

Each message published to `flux_data` looks like:

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

> **14 features** — 6 cyclic time encodings (hour, day-of-week, month), 1 binary (weekend), 7 derived vehicle statistics (lags, moving averages, first difference).

---

### 2. Spark Processor (`mini-services/spark/spark_processor.py`)

The ML brain of the system. Uses **PySpark Structured Streaming** with `foreachBatch` to:
1. Consume rows from `flux_data` in micro-batches
2. Buffer the last 24 timesteps per junction (in `deque` windows)
3. Run the **TrafficGNN** model when all 4 junctions have enough data
4. Publish predictions to `traffic_predictions`

**Spark streaming reader:**

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

**Feature extraction** — each raw Kafka row is converted to a 14-dimensional vector:

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

**GNN inference** — runs when all 4 junctions have 24 timesteps buffered:

```python
@torch.no_grad()
def predict_all_junctions() -> dict[int, float] | None:
    # Wait until every junction has a full 24-step window
    for j in range(1, NUM_NODES + 1):
        if len(feat_window[j]) < SEQ_LEN:  # SEQ_LEN = 24
            return None

    # Stack: (4 junctions, 24 steps, 14 features)
    sequences = np.stack([
        np.array(list(feat_window[j])) for j in range(1, NUM_NODES + 1)
    ], axis=0)

    # Normalize only vehicle features (indices 7:14)
    sequences[:, :, 7:14] = (sequences[:, :, 7:14] - mean_y) / std_y

    # GNN forward pass
    x = torch.tensor(sequences, dtype=torch.float32).unsqueeze(0)  # (1, 4, 24, 14)
    out = model(x).squeeze(0)  # (4, 1) — one prediction per junction

    preds = {}
    for i, jid in enumerate(range(1, NUM_NODES + 1)):
        unscaled = float(out[i, 0]) * std_y + mean_y
        preds[jid] = max(0.0, round(unscaled, 2))  # vehicles can't be negative

    return preds  # {1: 38.2, 2: 12.7, 3: 25.1, 4: 8.3}
```

**Model architecture** (`TrafficGNN`):

```python
class TrafficGNN(nn.Module):
    def __init__(self, in_channels=14, hidden_dim=64, seq_len=24, num_nodes=4):
        super().__init__()
        # Temporal convolution: (batch, 14, seq_len) → (batch, hidden_dim, 1)
        self.temporal_conv = nn.Conv1d(in_channels, hidden_dim, kernel_size=seq_len)
        # Two GCN layers with the 4-junction road graph
        self.gcn1 = GCNConv(hidden_dim, hidden_dim)
        self.gcn2 = GCNConv(hidden_dim, 1)  # single output per node

    def forward(self, x):
        # x shape: (batch, num_nodes, seq_len, in_channels)
        B, N, T, F = x.shape
        x = x.view(B * N, T, F).permute(0, 2, 1)  # (B*N, F, T)
        x = torch.relu(self.temporal_conv(x)).squeeze(-1)  # (B*N, hidden_dim)
        x = x.view(B, N, -1)  # (B, N, hidden_dim)
        x = torch.relu(self.gcn1(x, edge_index))
        x = self.gcn2(x, edge_index)
        return x  # (B, N, 1)
```

> **Parameters**: 102,017 — nearly all in the temporal projection layer.

---

### 3. FastAPI Gateway (`mini-services/api/main.py`)

The bridge between Kafka and the browser. No databases — all state lives in memory as Python `dict`s and `deque`s.

```python
# In-memory state — no Redis, no PostgreSQL
current_state: dict[int, dict] = {}              # junction → latest prediction
history: dict[int, deque] = defaultdict(          # junction → last 2000 predictions
    lambda: deque(maxlen=2000)
)
```

**Kafka consumer → asyncio bridge** — a background thread polls Kafka and dispatches into the asyncio event loop:

```python
def kafka_listener(loop):
    """Runs in a dedicated thread. Pushes Kafka messages into the asyncio broadcast queue."""
    consumer = build_kafka_consumer()
    for msg in consumer:
        data = msg.value
        junction = data.get("Junction")
        if junction is not None:
            current_state[junction] = data
            history[junction].append(data)
        # Thread-safe handoff to asyncio
        asyncio.run_coroutine_threadsafe(broadcast_queue.put(data), loop)
```

**WebSocket broadcast** — fans out predictions to all connected dashboard clients:

```python
async def broadcast_worker():
    """Coroutine: drains broadcast_queue and sends to all connected WebSocket clients."""
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

**Kafka auth** — transparently adapts to local (PLAINTEXT) or cloud Aiven (SSL/SASL):

```python
def build_kafka_consumer() -> KafkaConsumer:
    opts = {
        "bootstrap_servers": [f"{KAFKA_HOST}:{KAFKA_PORT}"],
        "auto_offset_reset": "latest",
        "value_deserializer": lambda v: json.loads(v.decode("utf-8")),
    }
    # SSL mTLS (Aiven certs)
    if all([KAFKA_SSL_CA, KAFKA_SSL_CERT, KAFKA_SSL_KEY]):
        opts["security_protocol"] = "SSL"
        # ... SSL context with check_hostname=False
    # SASL_SSL (Aiven username/password)
    elif KAFKA_USERNAME and KAFKA_PASSWORD:
        opts["security_protocol"] = "SASL_SSL"
        # ... SASL PLAIN mechanism
    # else: PLAINTEXT (for local KRaft)
    return KafkaConsumer(TOPIC_OUTPUT, **opts)
```

---

### 4. Frontend (`src/`)

A **Next.js 15** application with hybrid rendering. The dashboard uses:

- **MapLibre GL** — 2D map with junction markers colored by congestion level
- **Three.js** — 3D car models animated on the road network at 60 FPS
- **Recharts** — Sparkline charts for each junction's vehicle count history

**WebSocket connection with auto-reconnect:**

```typescript
// app/dashboard/page.tsx
useEffect(() => {
  const connect = () => {
    const ws = new WebSocket(`ws://localhost:8000/ws/traffic`);
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      updateJunctionState(data);  // junction, vehicles, predicted, status
    };
    ws.onclose = () => setTimeout(connect, 5000);  // auto-reconnect
  };
  connect();
}, []);
```

**Live model accuracy metrics** — rolling 200-sample error buffer:

```typescript
const errorsBuffer: number[] = [];

const err = Math.abs(data.Vehicles - data.PredictedVehicles);
errorsBuffer.push(err);
if (errorsBuffer.length > 200) errorsBuffer.shift();

const mae  = errorsBuffer.reduce((a,b) => a+b, 0) / errorsBuffer.length;
const rmse = Math.sqrt(errorsBuffer.reduce((a,b) => a + b*b, 0) / errorsBuffer.length);
const accuracy = Math.max(0, 100 - mae);  // simplified % accuracy
```

**Dijkstra routing** with congestion-weighted edge costs (re-routes every 3s):

| Traffic Status | Edge Weight |
|---|---|
| `fluid` | 1.0× (normal) |
| `moderate` | 3.0× |
| `congested` | 8.0× |

---

### 5. Kafka (`docker-compose.yml`)

Runs in **KRaft mode** (no Zookeeper) — lighter and faster.

```yaml
kafka:
  image: apache/kafka:3.8.0
  environment:
    KAFKA_NODE_ID: 1
    KAFKA_PROCESS_ROLES: broker,controller           # KRaft: single process
    KAFKA_LISTENERS: PLAINTEXT://0.0.0.0:9092,CONTROLLER://0.0.0.0:9093
    KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://kafka:9092  # Docker DNS
    KAFKA_CONTROLLER_QUORUM_VOTERS: 1@kafka:9093
    KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1
    CLUSTER_ID: road-traffic-pred-01
```

Topics are **auto-created** on first use — no manual setup needed.

---

## 🧠 Model Performance

### TrafficGNN — Junction-level MAE

| Junction | MAE (vehicles) |
|---|---|
| **J1** | 3.73 |
| **J2** | 1.98 |
| **J3** | 2.61 |
| **J4** | 2.13 |

The model was trained on 14-dimensional feature vectors with 24-timestep history windows, using a 4-node graph where edges represent road connections between junctions.

---

## ⚙️ Configuration

### Environment (`.env`)

```ini
# Local Kafka (default — runs in Docker)
KAFKA_HOST=kafka
KAFKA_PORT=9092

# Aiven Cloud (uncomment for managed Kafka)
# KAFKA_HOST=kafka-xxxx.aivencloud.com
# KAFKA_PORT=17498
# KAFKA_SSL_CA=certs/ca.pem
# KAFKA_SSL_CERT=certs/service.cert
# KAFKA_SSL_KEY=certs/service.key
```

### Switching to Aiven Cloud Kafka

```bash
# Edit .env with your Aiven host/port/credentials, then:
docker compose --profile full up -d
```

No code changes needed — the auth fallback chain (SSL → SASL → PLAINTEXT) auto-detects your config.

---

## 📁 Project Structure

```
.
├── docker-compose.yml           # All services + Kafka (KRaft)
├── Makefile                     # up, down, logs, rebuild, ps
├── .env                         # Environment (local Kafka by default)
├── ARCHITECTURE.md              # High-level design
├── docs/
│   ├── BACKEND.md               # Backend deep-dive
│   ├── FRONTEND.md              # Frontend architecture
│   └── INTEGRATION.md           # End-to-end data lifecycle
├── mini-services/
│   ├── api/main.py              # FastAPI + WebSocket + Kafka consumer
│   ├── simulator/simulator.py   # CSV replay → Kafka producer
│   └── spark/
│       ├── spark_processor.py   # PySpark Structured Streaming + GNN
│       └── traffic_gnn.py       # TrafficGNN model definition
├── src/                         # Next.js 15 frontend
│   ├── app/dashboard/           # Dashboard page with WebSocket hook
│   └── components/traffic/      # Map, 3D cars, sparklines, sidebar
├── models/                      # Trained .pth weights + scaler
└── data/                        # Traffic datasets (CSV)
```

---

## 🔧 Troubleshooting

| Symptom | Fix |
|---|---|
| `Failed to create new KafkaAdminClient` | Run `docker compose up -d` — Kafka needs to be running |
| Port 3000/8000 already in use | Change ports in `docker-compose.yml` |
| Spark crashes on startup | Ensure 4GB+ RAM allocated to Docker |
| No data on dashboard | Check `make logs` — simulator must be publishing to `flux_data` |
| Model loads with version warning | Safe — `sklearn` version mismatch warning is cosmetic |

---

## ✍️ Authors

- **Joel ADZONYA** — AI Research & Core Infrastructure
- **Ghislaine EKLOU** — Data Engineering & Visualization Design
