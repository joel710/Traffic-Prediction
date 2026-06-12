"""
Spark Structured Streaming job: Kafka → GNN inference → Kafka.

Consumes traffic data from Kafka with pre-computed features,
runs TrafficGNN inference (4 junctions, 24-step windows),
and publishes predictions to the output topic.

Features (ALL raw — no standardisation, pre-computed in source data):
  hour_sin, hour_cos, dow_sin, dow_cos, month_sin, month_cos,
  is_weekend,
  veh_lag_1, veh_lag_2, veh_lag_3, veh_lag_24,
  veh_ma_6, veh_ma_24,
  veh_diff_1
"""

import os
import sys
import time
import json
import ssl
import torch
import numpy as np
import joblib
from collections import deque, defaultdict
from pathlib import Path
from pyspark.sql import SparkSession
from pyspark.sql.functions import col, from_json
from pyspark.sql.types import (
    StructType, StructField, StringType, IntegerType, FloatType,
)
from kafka import KafkaProducer
from kafka.errors import NoBrokersAvailable
from datetime import datetime, timezone

from traffic_gnn import TrafficGNN

# ─── Config ───────────────────────────────────────────────────────
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
TOPIC_INPUT = os.getenv("KAFKA_TOPIC_INPUT", "flux_data")
TOPIC_OUTPUT = os.getenv("KAFKA_TOPIC_OUTPUT", "traffic_predictions")
MODEL_PATH = os.getenv("MODEL_PATH", "models/gnn_model.pth")
SCALER_Y_PATH = os.getenv("SCALER_Y_PATH", "models/scaler_y.pkl")
BOOTSTRAP_SERVER = f"{KAFKA_HOST}:{KAFKA_PORT}"

NUM_NODES = 4
SEQ_LEN = 24
NUM_FEATURES = 14

FEATURE_COLS = [
    "hour_sin", "hour_cos",
    "dow_sin", "dow_cos",
    "month_sin", "month_cos",
    "is_weekend",
    "veh_lag_1", "veh_lag_2", "veh_lag_3", "veh_lag_24",
    "veh_ma_6", "veh_ma_24",
    "veh_diff_1",
]

# ─── State ────────────────────────────────────────────────────────
feat_window: dict[int, deque] = defaultdict(lambda: deque(maxlen=SEQ_LEN))
latest_row: dict[int, dict] = {}


def build_kafka_producer() -> KafkaProducer:
    opts = {
        "bootstrap_servers": [BOOTSTRAP_SERVER],
        "value_serializer": lambda x: json.dumps(x).encode("utf-8"),
        "acks": "all",
        "retries": 5,
        "api_version": (2, 8, 0),
    }
    if KAFKA_SSL_CA and KAFKA_SSL_CERT and KAFKA_SSL_KEY \
       and Path(KAFKA_SSL_CA).exists() and Path(KAFKA_SSL_CERT).exists() and Path(KAFKA_SSL_KEY).exists():
        
        context = ssl.create_default_context(cafile=KAFKA_SSL_CA)
        context.load_cert_chain(certfile=KAFKA_SSL_CERT, keyfile=KAFKA_SSL_KEY)
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE

        opts.update(security_protocol="SSL", ssl_context=context)
    elif KAFKA_USERNAME and KAFKA_PASSWORD:
        opts.update(security_protocol="SASL_SSL", sasl_mechanism="PLAIN",
                    sasl_plain_username=KAFKA_USERNAME, sasl_plain_password=KAFKA_PASSWORD)
        if KAFKA_SSL_CA and Path(KAFKA_SSL_CA).exists():
            opts["ssl_cafile"] = KAFKA_SSL_CA
    return KafkaProducer(**opts)


# ─── Load GNN ─────────────────────────────────────────────────────
device = torch.device("cpu")
model = TrafficGNN(num_nodes=NUM_NODES, in_features=NUM_FEATURES)
model.load_pretrained(MODEL_PATH, map_location=device)
model.eval()

# Load scaler for denormalization
try:
    scaler_y = joblib.load(SCALER_Y_PATH)
    mean_y = scaler_y.mean_[0]
    std_y = scaler_y.scale_[0]
    print(f"✅ Scaler loaded: mean={mean_y:.2f}, std={std_y:.2f}")
except Exception as e:
    print(f"⚠️ Scaler not found, using defaults: {e}")
    mean_y, std_y = 20.09, 17.86  # Pre-calculated from test_gnn.csv


FEATURE_COLS_SET = set(FEATURE_COLS)


def extract_14_features(row_dict: dict) -> np.ndarray:
    """Extract the 14 pre-computed feature values from a row dict."""
    return np.array([float(row_dict.get(c) if row_dict.get(c) is not None else 0) for c in FEATURE_COLS], dtype=np.float32)


@torch.no_grad()
def predict_all_junctions() -> dict[int, float] | None:
    """Run GNN on all 4 junctions. Returns {jid: pred} or None if warming up."""
    for j in range(1, NUM_NODES + 1):
        if len(feat_window[j]) < SEQ_LEN:
            return None

    sequences = np.stack([
        np.array(list(feat_window[j])) for j in range(1, NUM_NODES + 1)
    ], axis=0)  # (4, 24, 14)

    # Scale the vehicle-related inputs (features 7 to 13 inclusive)
    # This is required as per our MAE analysis (StandardScaler on vehicles/lags)
    sequences[:, :, 7:14] = (sequences[:, :, 7:14] - mean_y) / std_y

    x = torch.tensor(sequences, dtype=torch.float32).unsqueeze(0)  # (1, 4, 24, 14)
    out = model(x).squeeze(0)  # (4, 1)

    # Denormalize predictions using scaler_y parameters
    preds = {}
    for i, jid in enumerate(range(1, NUM_NODES + 1)):
        raw_val = float(out[i, 0])
        unscaled = raw_val * std_y + mean_y
        preds[jid] = max(0.0, round(unscaled, 2))
    return preds


# ─── Spark ────────────────────────────────────────────────────────
spark = SparkSession.builder \
    .appName("TrafficGNNStreaming") \
    .config("spark.sql.streaming.checkpointLocation", "/tmp/spark-checkpoints") \
    .getOrCreate()

spark.sparkContext.setLogLevel("WARN")

# Schema matching the refined dataset (all columns in test_gnn.csv)
input_schema = StructType([
    StructField("DateTime", StringType(), True),
    StructField("Junction", IntegerType(), True),
    StructField("Vehicles", FloatType(), True),
    StructField("ID", StringType(), True),
    StructField("is_weekend", IntegerType(), True),
    StructField("hour", IntegerType(), True),
    StructField("dayofweek", IntegerType(), True),
    StructField("month", IntegerType(), True),
    StructField("hour_sin", FloatType(), True),
    StructField("hour_cos", FloatType(), True),
    StructField("dow_sin", FloatType(), True),
    StructField("dow_cos", FloatType(), True),
    StructField("month_sin", FloatType(), True),
    StructField("month_cos", FloatType(), True),
    StructField("veh_lag_1", FloatType(), True),
    StructField("veh_lag_2", FloatType(), True),
    StructField("veh_lag_3", FloatType(), True),
    StructField("veh_lag_24", FloatType(), True),
    StructField("veh_ma_6", FloatType(), True),
    StructField("veh_ma_24", FloatType(), True),
    StructField("veh_diff_1", FloatType(), True),
])

producer: KafkaProducer = None


def process_microbatch(batch_df, batch_id):
    """Handle each micro-batch of traffic data."""
    global producer
    if producer is None:
        try:
            producer = build_kafka_producer()
        except Exception as e:
            print(f"❌ Kafka Producer error: {e}")
            return

    rows = batch_df.collect()
    for row in rows:
        row_dict = row.asDict()
        jid = row_dict.get("Junction")
        if jid is None or jid > NUM_NODES:
            continue

        # Add to sequence window
        feat_window[jid].append(extract_14_features(row_dict))
        latest_row[jid] = row_dict

    # Check if we have enough data to predict for all junctions
    predictions = predict_all_junctions()
    if predictions:
        for jid, pred in predictions.items():
            # Merge prediction into original row metadata
            original = latest_row.get(jid, {})
            payload = {
                **original,
                "PredictedVehicles": float(pred),
                "timestamp": datetime.now(timezone.utc).isoformat()
            }
            producer.send(TOPIC_OUTPUT, value=payload)
        print(f"✅ Sent {len(predictions)} GNN predictions to {TOPIC_OUTPUT}")


# Read from Kafka
df = spark.readStream \
    .format("kafka") \
    .option("kafka.bootstrap.servers", BOOTSTRAP_SERVER) \
    .option("subscribe", TOPIC_INPUT) \
    .load()

# Convert binary value to JSON
json_df = df.select(from_json(col("value").cast("string"), input_schema).alias("data")) \
    .select("data.*")

query = json_df.writeStream \
    .foreachBatch(process_microbatch) \
    .start()

print("🚀 Spark Streaming (GNN) — Kafka → GNN → Kafka")
query.awaitTermination()
