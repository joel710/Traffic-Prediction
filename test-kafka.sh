#!/bin/bash

# Script de test de la connexion Kafka

PROJECT_ROOT="/home/jojo/road-traffic-pred"
VENV_PATH="$PROJECT_ROOT/backend_venv"

echo "🧪 Test Kafka Connection..."
echo ""

source "$VENV_PATH/bin/activate"
cd "$PROJECT_ROOT"

python3 << 'EOF'
import os
from pathlib import Path
from dotenv import load_dotenv
from kafka import KafkaProducer, KafkaConsumer
import json
import time

load_dotenv()

KAFKA_HOST = os.getenv("KAFKA_HOST", "localhost")
KAFKA_PORT = int(os.getenv("KAFKA_PORT", "9092"))
KAFKA_USERNAME = os.getenv("KAFKA_USERNAME", "")
KAFKA_PASSWORD = os.getenv("KAFKA_PASSWORD", "")
KAFKA_SSL_CA = os.getenv("KAFKA_SSL_CA", "")
KAFKA_TOPIC_INPUT = os.getenv("KAFKA_TOPIC_INPUT", "flux_data")
BOOTSTRAP_SERVER = f"{KAFKA_HOST}:{KAFKA_PORT}"

print(f"🔍 Configuration:")
print(f"   Host: {KAFKA_HOST}:{KAFKA_PORT}")
print(f"   Topic: {KAFKA_TOPIC_INPUT}")
print(f"   SSL: {'Activé' if KAFKA_USERNAME else 'Désactivé'}")
print("")

# Test de connexion
opts = {
    "bootstrap_servers": [BOOTSTRAP_SERVER],
    "value_serializer": lambda x: json.dumps(x).encode("utf-8"),
}

if KAFKA_USERNAME and KAFKA_PASSWORD:
    opts.update(
        security_protocol="SASL_SSL",
        sasl_mechanism="PLAIN",
        sasl_plain_username=KAFKA_USERNAME,
        sasl_plain_password=KAFKA_PASSWORD,
    )
    if KAFKA_SSL_CA and Path(KAFKA_SSL_CA).exists():
        opts["ssl_cafile"] = KAFKA_SSL_CA

try:
    print("📡 Test 1: Création KafkaProducer...")
    producer = KafkaProducer(**opts, request_timeout_ms=5000)
    print("✅ Connecté (Producer)")
    
    # Test d'envoi
    print("📡 Test 2: Envoi message test...")
    test_msg = {"Junction": 1, "Vehicles": 25, "test": True}
    producer.send(KAFKA_TOPIC_INPUT, value=test_msg).get(timeout=10)
    print(f"✅ Message envoyé: {test_msg}")
    
    producer.close()
    print("✅ Producer fermé")
    
except Exception as e:
    print(f"❌ Erreur: {type(e).__name__}: {e}")
    import traceback
    traceback.print_exc()
    exit(1)

print("")
print("🎉 Test Kafka complété avec succès!")
EOF
