# Road Flow — Architecture & Documentation

## Table of Contents
1. [Project Overview](#1-project-overview)
2. [Architecture Diagram](#2-architecture-diagram)
3. [Data Pipeline — Step by Step](#3-data-pipeline--step-by-step)
4. [Data Formats](#4-data-formats)
5. [Frontend Architecture](#5-frontend-architecture)
6. [Map & Routing System](#6-map--routing-system)
7. [Setup & Run Guide](#7-setup--run-guide)
8. [Model & Training](#8-model--training)

---

## 1. Project Overview

**Road Flow** is a real-time road traffic prediction system using a **Graph Neural Network (GNN)**. It streams live traffic data through Apache Kafka (KRaft mode, no Zookeeper), processes it with **PySpark Structured Streaming**, runs inference with **PyTorch TrafficGNN**, and displays results on an interactive **Next.js 3D dashboard**.

### Tech Stack

| Layer | Technology |
|---|---|
| **Streaming** | Apache Kafka 3.8 (KRaft, local or Aiven Cloud) |
| **Processing** | Apache Spark 3.5.4 (PySpark Structured Streaming) |
| **ML Inference** | PyTorch TrafficGNN (GCNConv, 102k params) |
| **API Gateway** | FastAPI + WebSocket (thread-to-asyncio bridge) |
| **Frontend** | Next.js 15, React 18, MapLibre GL, Three.js |
| **Charts** | Recharts sparklines |
| **Infrastructure** | Docker Compose (5 services + Kafka) |

### Services (6 Docker containers)

| Service | Image | Port | Role |
|---|---|---|---|
| `kafka` | `apache/kafka:3.8.0` | `9092` | Event bus (KRaft — no Zookeeper) |
| `frontend` | `road-traffic-pred-frontend` | `3000` | Next.js dashboard |
| `backend` | `road-traffic-pred-backend` | `8000` | FastAPI + WebSocket gateway |
| `simulator` | `road-traffic-pred-simulator` | `8001` | CSV replay → Kafka producer |
| `spark-processor` | `road-traffic-pred-spark-processor` | — | PySpark Streaming + GNN inference |

**Kafka modes** (auto-detected):
- **Local (default)**: `apache/kafka:3.8.0` KRaft, PLAINTEXT, no credentials
- **Aiven Cloud**: External broker, mTLS (SSL) or SASL_SSL authentication

---

## 2. Architecture Diagram

### Docker Deployment

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Docker Network                               │
│                                                                     │
│  ┌──────────────┐     ┌──────────────────┐     ┌──────────────┐    │
│  │  Simulator   │     │   Spark/GNN      │     │   FastAPI    │    │
│  │  (port 8001) │     │   Processor      │     │  (port 8000) │    │
│  │  CSV→Kafka   │────▶│ Kafka→GNN→Kafka  │────▶│  Kafka→WS    │    │
│  │  producer    │     │   inference      │     │  consumer    │    │
│  └──────┬───────┘     └──────────────────┘     └──────┬───────┘    │
│         │                    │                        │            │
│         │   flux_data        │  traffic_predictions   │            │
│         ▼                    ▼                        ▼            │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │              Kafka Broker (KRaft, port 9092)                 │   │
│  │  Topics: flux_data / traffic_predictions (auto-created)     │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│         ┌──────────────────┐                                        │
│         │   Next.js 15     │◀──── WebSocket (predictions)           │
│         │  (port 3000)     │                                        │
│         │  Dashboard       │                                        │
│         └──────────────────┘                                        │
└─────────────────────────────────────────────────────────────────────┘
```

### Data Pipeline

```
CSV Row ──▶ Simulator ──▶ Kafka[flux_data] ──▶ Spark/GNN ──▶ Kafka[predictions] ──▶ FastAPI ──▶ WS ──▶ Next.js
```

**End-to-end latency**: ~500ms (95th percentile) from CSV read to browser render.

---

## 3. Data Pipeline — Step by Step

### 3.1 Simulator (`mini-services/simulator/simulator.py`)

Reads a CSV of historical traffic data and publishes each row as a JSON message to the `flux_data` Kafka topic.

```python
async def run(self):
    df = pd.read_csv(CSV_PATH)
    df["DateTime"] = pd.to_datetime(df["DateTime"])
    df = df.sort_values("DateTime")
    for _, row in df.iterrows():
        data = row.to_dict()
        data["DateTime"] = data["DateTime"].strftime("%Y-%m-%d %H:%M:%S")
        self.producer.send("flux_data", value=data)
        await asyncio.sleep(STREAM_DELAY)  # configurable, default 2s
```

**Kafka auth** — automatic fallback chain:

| Mode | When | Auth |
|---|---|---|
| SSL (mTLS) | All 3 cert env vars set | `security_protocol="SSL"` with CA/cert/key |
| SASL_SSL | Username + password set | `security_protocol="SASL_SSL"`, PLAIN mechanism |
| PLAINTEXT | Default (local KRaft) | No auth |

### 3.2 Spark Processor (`mini-services/spark/spark_processor.py`)

The ML brain. A PySpark Structured Streaming job that:

1. **Reads** from `flux_data` topic via `readStream.format("kafka")`
2. **Buffers** the last 24 timesteps per junction in Python `deque` windows
3. **Runs** the TrafficGNN model when all 4 junctions have enough data
4. **Publishes** predictions to `traffic_predictions` topic

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

**Feature extraction** — 14 features per step:

```python
FEATURE_COLS = [
    "hour_sin", "hour_cos",           # cyclic hour (0-23)
    "dow_sin", "dow_cos",             # cyclic day-of-week (0-6)
    "month_sin", "month_cos",         # cyclic month (1-12)
    "is_weekend",                      # binary: weekend flag
    "veh_lag_1", "veh_lag_2",         # vehicle count 1h/2h ago
    "veh_lag_3", "veh_lag_24",        # vehicle count 3h/24h ago
    "veh_ma_6", "veh_ma_24",          # moving averages (6h, 24h)
    "veh_diff_1",                      # first difference (t - t-1)
]
```

**GNN inference** — called on every micro-batch when buffers are full:

```python
@torch.no_grad()
def predict_all_junctions() -> dict[int, float] | None:
    # Wait for all 4 junctions to have 24-step buffers
    for j in range(1, NUM_NODES + 1):
        if len(feat_window[j]) < SEQ_LEN:
            return None

    # Stack: (4, 24, 14)
    sequences = np.stack([
        np.array(list(feat_window[j])) for j in range(1, NUM_NODES + 1)
    ], axis=0)

    # Normalize vehicle features only (cols 7:14)
    sequences[:, :, 7:14] = (sequences[:, :, 7:14] - mean_y) / std_y

    # GNN forward pass
    x = torch.tensor(sequences, dtype=torch.float32).unsqueeze(0)
    out = model(x).squeeze(0)  # (4, 1)

    preds = {}
    for i, jid in enumerate(range(1, NUM_NODES + 1)):
        unscaled = float(out[i, 0]) * std_y + mean_y
        preds[jid] = max(0.0, round(unscaled, 2))
    return preds
```

**Model architecture** (`TrafficGNN`):

```
Input:  (batch, 4 nodes, 24 steps, 14 features)
  │
  ├── Conv1d(14→64, kernel=24)   # Temporal projection per node
  ├── ReLU
  │
  ├── GCNConv(64→64)             # Spatial: message passing across 4 junctions
  ├── ReLU
  │
  ├── GCNConv(64→1)              # Output: 1 prediction per node
  │
Output: (batch, 4 nodes, 1)      # Predicted vehicles per junction
```

**Parameters**: 102,017 (mostly in the temporal projection layer).

### 3.3 FastAPI Gateway (`mini-services/api/main.py`)

Bridge between Kafka and the browser. No external databases — all state lives in RAM.

```python
# In-memory state (no Redis, no PostgreSQL)
current_state: dict[int, dict] = {}         # junction_id → latest prediction
history: dict[int, deque] = defaultdict(     # junction_id → last 2000 predictions
    lambda: deque(maxlen=2000)
)
```

**Thread → asyncio bridge** — Kafka polling runs in a background thread, dispatches into the event loop:

```python
def kafka_listener(loop):
    consumer = build_kafka_consumer()
    for msg in consumer:
        data = msg.value
        junction = data.get("Junction")
        if junction is not None:
            current_state[junction] = data
            history[junction].append(data)
        asyncio.run_coroutine_threadsafe(broadcast_queue.put(data), loop)
```

**WebSocket broadcast** — fans out to all connected clients:

```python
async def broadcast_worker():
    while True:
        data = await broadcast_queue.get()
        dead = [ws for ws in websocket_clients if not await safe_send(ws, data)]
        for ws in dead:
            websocket_clients.discard(ws)
```

**API Endpoints:**

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Service status + connection count |
| `GET` | `/traffic/current` | Latest prediction per junction |
| `GET` | `/traffic/history/{id}` | Last N predictions for one junction |
| `POST` | `/traffic/ingest` | REST fallback for data ingestion |
| `GET` | `/health` | Health check |
| `WS` | `/ws/traffic` | Real-time prediction stream |

---

## 4. Data Formats

### 4.1 Simulator → Kafka (`flux_data` topic)

14-feature JSON per message:

```json
{
  "DateTime": "2017-03-11 09:00:00",
  "Junction": 3,
  "Vehicles": 11,
  "ID": "20170311093",
  "hour_sin": 0.7071,
  "hour_cos": -0.7071,
  "dow_sin": 0.0,
  "dow_cos": 0.0,
  "month_sin": 0.5,
  "month_cos": 0.866,
  "is_weekend": 1,
  "veh_lag_1": 12.0,
  "veh_lag_2": 8.0,
  "veh_lag_3": 7.0,
  "veh_lag_24": 13.0,
  "veh_ma_6": 10.2,
  "veh_ma_24": 11.5,
  "veh_diff_1": 4.0
}
```

### 4.2 Spark Processor → Kafka (`traffic_predictions` topic)

```json
{
  "DateTime": "2017-03-11 09:00:00",
  "Junction": 3,
  "Vehicles": 11,
  "PredictedVehicles": 10.23,
  "Status": "fluid",
  "Timestamp": "2026-06-12T14:00:00+00:00"
}
```

**Status thresholds**: `<30` fluid, `<60` moderate, `≥60` congested.

### 4.3 WebSocket Payload (to Frontend)

Same format as Spark output — forwarded verbatim:

```typescript
type WsPayload = {
  Junction: number;
  Vehicles: number;
  PredictedVehicles: number;
  Status: 'fluid' | 'moderate' | 'congested';
  DateTime: string;
  Timestamp: string;  // ISO 8601
};
```

### 4.4 REST Response (`/traffic/current`)

```json
[
  { "Junction": 1, "Vehicles": 88, "PredictedVehicles": 85.4, "Status": "congested", "DateTime": "2017-03-11 09:00:00" },
  { "Junction": 2, "Vehicles": 14, "PredictedVehicles": 12.1, "Status": "fluid",     "DateTime": "2017-03-11 09:00:00" },
  { "Junction": 3, "Vehicles": 11, "PredictedVehicles": 10.2, "Status": "fluid",     "DateTime": "2017-03-11 09:00:00" },
  { "Junction": 4, "Vehicles": 47, "PredictedVehicles": 44.8, "Status": "moderate",  "DateTime": "2017-03-11 09:00:00" }
]
```

---

## 5. Frontend Architecture

### 5.1 Component Tree

```
src/
├── app/
│   ├── layout.tsx                 — Root layout (metadata, dark theme)
│   ├── page.tsx                   — Home: renders <Launchpad />
│   └── dashboard/
│       └── page.tsx               — Dashboard: renders <TrafficDashboard />
│
└── components/traffic/
    ├── Launchpad.tsx               — Landing: search, quick routes, junction grid
    ├── TrafficDashboard.tsx        — Orchestrator: WebSocket, state, routing
    ├── TrafficMap.tsx              — MapLibre GL: markers, routes, popups
    ├── MapCarAnimator.tsx          — Animated car (60fps, re-routing)
    ├── Sidebar.tsx                 — Cards, metrics, sparklines, 3D car view
    ├── ThreeCarVisualizer.tsx      — Three.js 3D model in sidebar
    └── TimeSlider.tsx              — 0-24h range filter
```

### 5.2 Frontend Data Flow

```
WebSocket (ws://localhost:8000/ws/traffic)
  │
  ├─→ setJunctions()
  │     ├── Map markers: color by status (emerald/amber/red)
  │     ├── Sidebar cards: live value, sparkline, accuracy
  │     ├── Route recalculation (Dijkstra, weighted)
  │     └── Live metrics (MAE/RMSE rolling buffer)
  │
  └─→ REST fallback (/traffic/current) on mount

Junction Selection:
  Click marker → flyTo junction → popup → 3D car sidebar

Car Routing:
  Sidebar "GO" → Dijkstra(congestion-weighted) → animate along path
  → re-route every 3s if congestion changes
```

### 5.3 Live Metrics

```typescript
const errorsBuffer: number[] = [];

// On each WebSocket message:
const err = Math.abs(data.Vehicles - data.PredictedVehicles);
errorsBuffer.push(err);
if (errorsBuffer.length > 200) errorsBuffer.shift();

const mae  = errorsBuffer.reduce((a, b) => a + b, 0) / errorsBuffer.length;
const rmse = Math.sqrt(errorsBuffer.reduce((a, b) => a + b*b, 0) / errorsBuffer.length);
```

### 5.4 WebSocket Connection with Auto-Reconnect

```typescript
useEffect(() => {
  const connect = () => {
    const ws = new WebSocket(`ws://localhost:8000/ws/traffic`);
    ws.onmessage = (event) => {
      const data: WsPayload = JSON.parse(event.data);
      updateJunctionState(data);
    };
    ws.onclose = () => setTimeout(connect, 5000);
  };
  connect();
}, []);
```

---

## 6. Map & Routing System

### 6.1 Map Configuration

- **Engine**: MapLibre GL via `react-map-gl/maplibre`
- **Basemap**: CartoDB dark-matter (toggle to positron)
- **Initial view**: Paris center `[2.3522, 48.8566]`, zoom 12.5
- **Camera**: pitch 58°, unique bearing per junction

### 6.2 Junction Markers

4 junctions (J1–J4) as animated markers:
- Pulsing halo (framer-motion, 2.5s loop)
- Color by status: emerald (fluid), amber (moderate), red (congested)
- Click → camera flyTo + popup with live/predicted flow + 3D car preview

### 6.3 Road Geometries

6 routes connecting the junctions, tracing real Paris streets:

| Route | Path |
|---|---|
| J1↔J2 | Gare du Nord → Champs-Élysées |
| J1↔J3 | Gare du Nord → Place d'Italie |
| J1↔J4 | Gare du Nord → Bastille |
| J2↔J3 | Champs-Élysées → Place d'Italie |
| J2↔J4 | Champs-Élysées → Bastille |
| J3↔J4 | Place d'Italie → Bastille |

### 6.4 Dijkstra Routing

Edge weights updated in real-time based on traffic status:

| Status | Weight | Traffic |
|---|---|---|
| `fluid` | 1.0× | Normal flow |
| `moderate` | 3.0× | Slower |
| `congested` | 8.0× | Heavy traffic |

The car follows real road geometry waypoints (20-35 per route). Re-routing every 3 seconds — switches path if a segment becomes congested.

### 6.5 Car Animation

- **60 FPS** via `requestAnimationFrame`
- Position interpolated between waypoints
- Direction: `atan2(dy, dx)` on consecutive points
- Camera follows via `map.panTo()` every 20 frames
- Trail dots with fade effect behind car

---

## 7. Setup & Run Guide

### 7.1 Prerequisites

**With Docker (recommended):**
```bash
Docker + Docker Compose v2   # That's it!
```

**Without Docker (manual dev):**
```bash
Java 21+       # Apache Spark
Python 3.11+   # Backend + ML
Node.js 20+    # Frontend
```

### 7.2 Quick Start (Docker)

```bash
git clone <repo-url> && cd road-traffic-pred

# Default: local Kafka (KRaft)
cp .env.example .env
make up
```

Access:
- **Dashboard**: http://localhost:3000/dashboard
- **API docs**: http://localhost:8000/docs
- **Spark UI**: http://localhost:4040

### 7.3 Using Aiven Cloud Kafka

```bash
# 1. Edit .env with Aiven credentials
KAFKA_HOST=kafka-xxxxx.h.aivencloud.com
KAFKA_PORT=17498
KAFKA_SSL_CA=certs/ca.pem
KAFKA_SSL_CERT=certs/service.cert
KAFKA_SSL_KEY=certs/service.key

# 2. Place certificates in certs/
# 3. Run (comment out kafka service in compose first)
docker compose --profile full up -d
```

### 7.4 Managing the Stack

```bash
make up         # Full stack (build + launch)
make up-core    # Core only (no simulator/spark)
make logs       # Follow all logs
make ps         # Container status
make down       # Stop + clean volumes
make rebuild    # Full rebuild from scratch
```

---

## 8. Model & Training

### 8.1 Model Files

| File | Description |
|---|---|
| `models/gnn_model.pth` | Trained TrafficGNN weights (102,017 params) |
| `models/scaler_y.pkl` | Target StandardScaler (mean=20.1, std=17.86) |

### 8.2 Performance — Junction MAE

| Junction | MAE (vehicles) |
|---|---|
| **J1** | 3.73 |
| **J2** | 1.98 |
| **J3** | 2.61 |
| **J4** | 2.13 |

### 8.3 Training Data

| File | Rows | Description |
|---|---|---|
| `data/train.csv` | ~38k | Training set (14 features + target) |
| `data/test_gnn.csv` | ~10k | Test set (used by simulator) |

**Training config**:
- Sequence length: 24 time steps
- Feature dimension: 14 (6 cyclic time + 1 binary + 7 derived vehicle stats)
- Graph: 4 nodes (junctions), edges based on road connectivity
- Target: Vehicles (next time step, denormalized with `std_y=17.86`)
- Architecture: Conv1d → GCNConv → GCNConv

### 8.4 Output Example

```
Spark streaming log:
✅ TrafficGNN loaded from /app/models/gnn_model.pth (102,017 params)
🚀 Spark Streaming (GNN) — Kafka → GNN → Kafka
🔮 J1: Actual=42 veh → Pred=38.5 veh | Status=moderate
🔮 J2: Actual=12 veh → Pred=10.8 veh | Status=fluid
🔮 J3: Actual=55 veh → Pred=52.1 veh | Status=moderate
🔮 J4: Actual=8 veh  → Pred=7.2 veh  | Status=fluid
```
