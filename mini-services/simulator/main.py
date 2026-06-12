import pandas as pd
import os
import json
import time
import ssl
from pathlib import Path
from kafka import KafkaProducer
from dotenv import load_dotenv

load_dotenv()

# ─── Configuration ────────────────────────────────────────────────
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
KAFKA_TOPIC_INPUT = os.getenv("KAFKA_TOPIC_INPUT", "flux_data")
DATA_PATH = os.getenv("CSV_PATH", "../data/test.csv")
STREAM_DELAY = float(os.getenv("STREAM_DELAY", "1.0"))
BOOTSTRAP_SERVER = f"{KAFKA_HOST}:{KAFKA_PORT}"


def build_kafka_producer() -> KafkaProducer:
    """KafkaProducer with SSL client certs (Aiven mTLS) or plaintext fallback."""
    opts = {
        "bootstrap_servers": [BOOTSTRAP_SERVER],
        "value_serializer": lambda x: json.dumps(x).encode("utf-8"),
        "acks": "all",
        "retries": 5,
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
    return KafkaProducer(**opts)


def run_simulation():
    print(f"🚀 Simulation Kafka démarrée. Lecture de {DATA_PATH}...")
    print(f"📡 Connexion à Kafka: {BOOTSTRAP_SERVER}")
    
    try:
        df = pd.read_csv(DATA_PATH)
    except FileNotFoundError:
        print(f"❌ Erreur : {DATA_PATH} introuvable.")
        return

    try:
        producer = build_kafka_producer()
        print(f"✅ Connecté à Kafka. Envoi vers topic '{KAFKA_TOPIC_INPUT}'...")
    except Exception as e:
        print(f"❌ Erreur de connexion Kafka : {e}")
        return

    for index, row in df.iterrows():
        payload = row.to_dict()
        # Conversion des types
        if 'DateTime' in payload:
            payload['DateTime'] = str(payload['DateTime'])
        if 'Junction' in payload:
            payload['Junction'] = int(payload['Junction'])
        
        try:
            producer.send(KAFKA_TOPIC_INPUT, value=payload)
            junction = payload.get('Junction', '?')
            vehicles = payload.get('Vehicles', '?')
            print(f"✅ [T={index+1}/{len(df)}] Junction {junction}: {vehicles} vehicles")
        except Exception as e:
            print(f"⚠️ Erreur d'envoi Kafka : {e}")
        
        time.sleep(STREAM_DELAY)

    producer.flush()
    producer.close()
    print("✅ Simulation terminée !")


if __name__ == "__main__":
    run_simulation()
