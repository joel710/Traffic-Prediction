import pandas as pd
import json
import time
import os
import asyncio
from pathlib import Path
from kafka import KafkaProducer
from kafka.errors import NoBrokersAvailable
from fastapi import FastAPI, BackgroundTasks
import uvicorn
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="Road Traffic Simulator - Aiven Kafka")

# ─── Aiven Kafka Configuration ───────────────────────────────────
KAFKA_HOST = os.getenv("KAFKA_HOST", "localhost")
KAFKA_PORT = int(os.getenv("KAFKA_PORT", "9092"))
KAFKA_USERNAME = os.getenv("KAFKA_USERNAME", "")
KAFKA_PASSWORD = os.getenv("KAFKA_PASSWORD", "")
KAFKA_SSL_CA = os.getenv("KAFKA_SSL_CA", "")
KAFKA_SSL_CERT = os.getenv("KAFKA_SSL_CERT", "")
KAFKA_SSL_KEY = os.getenv("KAFKA_SSL_KEY", "")
TOPIC_INPUT = os.getenv("KAFKA_TOPIC_INPUT", "traffic_stream")
CSV_PATH = os.getenv("CSV_PATH", "data/test.csv")
STREAM_DELAY = float(os.getenv("STREAM_DELAY", "1.0"))

BOOTSTRAP_SERVER = f"{KAFKA_HOST}:{KAFKA_PORT}"


def build_kafka_producer() -> KafkaProducer:
    """Build a KafkaProducer with SSL client certs (Aiven mTLS) or plaintext fallback."""
    common_opts = {
        "bootstrap_servers": [BOOTSTRAP_SERVER],
        "value_serializer": lambda x: json.dumps(x).encode("utf-8"),
        "retries": 5,
        "acks": "all",
    }

    # Prefer SSL with client certificates (Aiven mTLS)
    if KAFKA_SSL_CA and KAFKA_SSL_CERT and KAFKA_SSL_KEY \
       and Path(KAFKA_SSL_CA).exists() and Path(KAFKA_SSL_CERT).exists() and Path(KAFKA_SSL_KEY).exists():
        common_opts.update(
            security_protocol="SSL",
            ssl_cafile=KAFKA_SSL_CA,
            ssl_certfile=KAFKA_SSL_CERT,
            ssl_keyfile=KAFKA_SSL_KEY,
        )
        print(f"🔐 Connecting to Aiven Kafka at {BOOTSTRAP_SERVER} (SSL mTLS)")
    # Fallback to SASL_SSL if only username/password are provided
    elif KAFKA_USERNAME and KAFKA_PASSWORD:
        common_opts.update(
            security_protocol="SASL_SSL",
            sasl_mechanism="PLAIN",
            sasl_plain_username=KAFKA_USERNAME,
            sasl_plain_password=KAFKA_PASSWORD,
        )
        if KAFKA_SSL_CA and Path(KAFKA_SSL_CA).exists():
            common_opts["ssl_cafile"] = KAFKA_SSL_CA
        print(f"🔐 Connecting to Aiven Kafka at {BOOTSTRAP_SERVER} (SASL_SSL)")
    else:
        print(f"🔓 Connecting to local Kafka at {BOOTSTRAP_SERVER} (PLAINTEXT)")

    return KafkaProducer(**common_opts)


class TrafficSimulator:
    def __init__(self):
        self.producer = None
        self.is_running = False

    def connect_kafka(self):
        retries = 30
        while retries > 0:
            try:
                self.producer = build_kafka_producer()
                # Force metadata lookup to validate connection
                self.producer.partitions_for(TOPIC_INPUT)
                print(f"✅ Connected to Kafka topic '{TOPIC_INPUT}' successfully.")
                return True
            except NoBrokersAvailable as e:
                print(f"⚠️ Kafka broker not available at {BOOTSTRAP_SERVER}: {e}. Retrying in 5s…")
            except Exception as e:
                print(f"⚠️ Kafka connection error: {e}. Retrying in 5s…")
            retries -= 1
            time.sleep(5)
        return False

    async def run(self):
        if not self.producer:
            loop = asyncio.get_event_loop()
            connected = await loop.run_in_executor(None, self.connect_kafka)
            if not connected:
                print("❌ Could not connect to Kafka broker. Simulation aborted.")
                self.is_running = False
                return

        self.is_running = True
        print(f"🚀 Starting simulation. Reading {CSV_PATH}…")

        try:
            df = pd.read_csv(CSV_PATH)
        except Exception as e:
            print(f"❌ Cannot read CSV at {CSV_PATH}: {e}")
            self.is_running = False
            return

        df["DateTime"] = pd.to_datetime(df["DateTime"])
        df = df.sort_values("DateTime")

        print(f"📈 Loaded {len(df)} rows → publishing to topic '{TOPIC_INPUT}' every {STREAM_DELAY}s")

        for _, row in df.iterrows():
            if not self.is_running:
                print("🛑 Simulation stopped.")
                break

            data = row.to_dict()
            data["DateTime"] = data["DateTime"].strftime("%Y-%m-%d %H:%M:%S")
            for k, v in list(data.items()):
                if pd.isna(v):
                    data[k] = None

            try:
                self.producer.send(TOPIC_INPUT, value=data)
                print(f"✅ Published: DateTime={data['DateTime']}, Junction={data['Junction']}, Vehicles={data['Vehicles']}")
            except Exception as e:
                print(f"⚠️ Send failed: {e}")

            await asyncio.sleep(STREAM_DELAY)

        self.is_running = False
        print("🏁 Simulation loop terminated.")

simulator = TrafficSimulator()

@app.post("/start")
async def start_simulation(background_tasks: BackgroundTasks):
    if simulator.is_running:
        return {"status": "already running"}
    background_tasks.add_task(simulator.run)
    return {"status": "started"}

@app.post("/stop")
async def stop_simulation():
    simulator.is_running = False
    return {"status": "stopped"}

@app.get("/status")
async def get_status():
    return {"is_running": simulator.is_running}

@app.on_event("startup")
async def auto_start_simulation():
    """Auto-start the simulation when the container boots (one-command deploy)."""
    asyncio.create_task(simulator.run())

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8001)
