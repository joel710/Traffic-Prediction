from fastapi import FastAPI, WebSocket, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import json
import os
import ssl
import asyncio
from asyncio import Queue
from pathlib import Path
from threading import Thread
from collections import deque, defaultdict
from typing import Optional
from datetime import datetime
import time
from kafka import KafkaConsumer
from kafka.errors import NoBrokersAvailable
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="Road Traffic Gateway API — Kafka-Native")

# ─── CORS ────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Aiven Kafka Configuration ───────────────────────────────────
KAFKA_HOST = os.getenv("KAFKA_HOST", "localhost")
KAFKA_PORT = int(os.getenv("KAFKA_PORT", "9092"))
KAFKA_USERNAME = os.getenv("KAFKA_USERNAME", "")
KAFKA_PASSWORD = os.getenv("KAFKA_PASSWORD", "")
def resolve_path(p: str) -> str:
    """Resolve path relative to project root or current directory."""
    if not p: return ""
    path_obj = Path(p)
    if path_obj.exists():
        return str(path_obj.absolute())
    # Try relative to parent if we are in mini-services/...
    parent_path = Path("..") / Path("..") / path_obj
    if parent_path.exists():
        return str(parent_path.absolute())
    # Try one level up
    one_up = Path("..") / path_obj
    if one_up.exists():
        return str(one_up.absolute())
    return p

KAFKA_SSL_CA = resolve_path(os.getenv("KAFKA_SSL_CA", ""))
KAFKA_SSL_CERT = resolve_path(os.getenv("KAFKA_SSL_CERT", ""))
KAFKA_SSL_KEY = resolve_path(os.getenv("KAFKA_SSL_KEY", ""))
TOPIC_OUTPUT = os.getenv("KAFKA_TOPIC_OUTPUT", "traffic_predictions")
BOOTSTRAP_SERVER = f"{KAFKA_HOST}:{KAFKA_PORT}"

# ─── In-Memory State (replaces Redis & PostgreSQL) ───────────────
current_state: dict[int, dict] = {}          # junction_id → latest prediction
history: dict[int, deque] = defaultdict(     # junction_id → [prediction, …]
    lambda: deque(maxlen=2000)
)

# ─── WebSocket Manager ───────────────────────────────────────────
websocket_clients: set[WebSocket] = set()
broadcast_queue: asyncio.Queue = Queue()


def build_kafka_consumer() -> KafkaConsumer:
    """KafkaConsumer with SSL client certs (Aiven mTLS) or SASL_SSL fallback."""
    opts = {
        "bootstrap_servers": [BOOTSTRAP_SERVER],
        "group_id": "traffic-api-consumer",
        "auto_offset_reset": "latest",
        "value_deserializer": lambda v: json.loads(v.decode("utf-8")),
        "api_version": (2, 8, 0),
    }
    # Prefer SSL with client certificates (Aiven mTLS)
    if KAFKA_SSL_CA and KAFKA_SSL_CERT and KAFKA_SSL_KEY \
       and Path(KAFKA_SSL_CA).exists() and Path(KAFKA_SSL_CERT).exists() and Path(KAFKA_SSL_KEY).exists():
        
        context = ssl.create_default_context(cafile=KAFKA_SSL_CA)
        context.load_cert_chain(certfile=KAFKA_SSL_CERT, keyfile=KAFKA_SSL_KEY)
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE

        opts.update(
            security_protocol="SSL",
            ssl_context=context,
        )
    # Fallback to SASL_SSL if only username/password are provided
    elif KAFKA_USERNAME and KAFKA_PASSWORD:
        opts.update(
            security_protocol="SASL_SSL",
            sasl_mechanism="PLAIN",
            sasl_plain_username=KAFKA_USERNAME,
            sasl_plain_password=KAFKA_PASSWORD,
        )
        if KAFKA_SSL_CA and Path(KAFKA_SSL_CA).exists():
            opts["ssl_cafile"] = KAFKA_SSL_CA
    return KafkaConsumer(TOPIC_OUTPUT, **opts)


def kafka_listener(loop):
    """Background thread: read predictions from Kafka and push to the asyncio queue."""
    try:
        consumer = build_kafka_consumer()
        print(f"📡 Kafka consumer listening on '{TOPIC_OUTPUT}' …")
        for msg in consumer:
            data = msg.value
            junction = data.get("Junction")
            if junction is not None:
                # Update in-memory state
                current_state[junction] = data
                history[junction].append(data)

            # Push to asyncio broadcast queue using FastAPI's running event loop
            asyncio.run_coroutine_threadsafe(
                broadcast_queue.put(data),
                loop,
            )
    except Exception as e:
        print(f"❌ Kafka consumer error: {e}")


def wait_for_kafka(retries=30, delay=2):
    """Block until Kafka broker is reachable, with retries."""
    for attempt in range(retries):
        try:
            consumer = build_kafka_consumer()
            consumer.close()
            print("✅ Kafka broker reachable")
            return True
        except NoBrokersAvailable:
            print(f"⏳ Waiting for Kafka broker... ({attempt + 1}/{retries})")
            time.sleep(delay)
        except Exception as e:
            print(f"⏳ Kafka not ready: {e} ({attempt + 1}/{retries})")
            time.sleep(delay)
    print("❌ Kafka broker not available after timeout")
    return False


@app.on_event("startup")
async def startup():
    loop = asyncio.get_running_loop()
    # Wait for Kafka to be ready before starting the listener
    await loop.run_in_executor(None, wait_for_kafka)
    # Start Kafka listener in background thread, using FastAPI's event loop
    thread = Thread(target=kafka_listener, args=(loop,), daemon=True)
    thread.start()
    print("✅ Kafka listener thread started")
    # Start the broadcast worker
    asyncio.create_task(broadcast_worker())


async def broadcast_worker():
    """Continuously drain the broadcast queue and send to all WebSocket clients."""
    while True:
        data = await broadcast_queue.get()
        dead_clients: list[WebSocket] = []
        for ws in websocket_clients:
            try:
                await ws.send_json(data)
            except Exception:
                dead_clients.append(ws)
        for ws in dead_clients:
            websocket_clients.discard(ws)


# ─── Models ──────────────────────────────────────────────────────
class TrafficData(BaseModel):
    DateTime: str
    Junction: int
    Vehicles: Optional[int] = None
    ID: Optional[int] = None


# ─── REST Endpoints ──────────────────────────────────────────────
@app.get("/")
def root():
    return {
        "status": "online",
        "service": "traffic-gateway-api",
        "mode": "kafka-native (no Redis/PostgreSQL)",
        "active_connections": len(websocket_clients),
    }


@app.get("/traffic/current")
def get_current():
    """Return the latest prediction for every junction (from in-memory state)."""
    return sorted(current_state.values(), key=lambda x: x.get("Junction", 0))


@app.get("/traffic/history/{junction_id}")
def get_history(junction_id: int, limit: int = 50):
    """Return recent prediction history for a junction (from in-memory deque)."""
    junction_history = list(history.get(junction_id, []))
    return junction_history[-limit:]


# ─── POST Ingestion (from Simulator) ────────────────────────────
@app.post("/traffic/ingest")
async def ingest_traffic(data: TrafficData):
    """Receive traffic data from the simulator."""
    payload = data.model_dump()
    # Optionally: update in-memory state immediately
    if data.Junction is not None:
        current_state[data.Junction] = payload
        history[data.Junction].append(payload)
    return {"status": "received", "junction": data.Junction}


@app.get("/health")
def health():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "websocket_connections": len(websocket_clients),
        "junctions_tracked": len(current_state),
    }


# ─── WebSocket Endpoint ──────────────────────────────────────────
@app.websocket("/ws/traffic")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    websocket_clients.add(ws)
    print(f"🔌 WebSocket client connected ({len(websocket_clients)} total)")

    try:
        while True:
            # Keep the connection alive; client pings will reset the timeout
            await ws.receive_text()
    except Exception:
        pass
    finally:
        websocket_clients.discard(ws)
        print(f"🔌 WebSocket client disconnected ({len(websocket_clients)} remaining)")
