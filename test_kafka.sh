#!/bin/bash
# 🔍 Test de connexion Aiven Kafka (Version Corrigée)

set -e
cd /home/jojo/road-traffic-pred

# Charger .env
export $(cat .env | grep -v '^#' | xargs)

echo "🔐 Test connexion Aiven Kafka..."
echo "   Host: $KAFKA_HOST:$KAFKA_PORT"
echo ""

# Vérifier fichiers certs
echo "✓ Vérification des certificats..."
ls -lh certs/ca.pem certs/service.cert certs/service.key || echo "❌ Certificats manquants!"

echo ""
echo "🧪 Test Python Kafka..."
./venv/bin/python3 << 'EOF'
import os
import ssl
from pathlib import Path
from kafka import KafkaConsumer

try:
    host = os.getenv("KAFKA_HOST")
    port = int(os.getenv("KAFKA_PORT", "9092"))
    bootstrap_server = f"{host}:{port}"
    
    ca = "certs/ca.pem"
    cert = "certs/service.cert"
    key = "certs/service.key"
    
    opts = {
        "bootstrap_servers": [bootstrap_server],
        "value_deserializer": lambda v: v.decode('utf-8'),
        "request_timeout_ms": 10000,
        "api_version": (2, 8, 0),
    }

    if Path(ca).exists() and Path(cert).exists() and Path(key).exists():
        print("🔐 Authentification mTLS avec bypass SSL verification...")
        context = ssl.create_default_context(cafile=ca)
        context.load_cert_chain(certfile=cert, keyfile=key)
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
        
        opts.update({
            "security_protocol": "SSL",
            "ssl_context": context,
        })
    
    print(f"📡 Connexion à {bootstrap_server}...")
    consumer = KafkaConsumer(**opts)
    
    topics = consumer.topics()
    print(f"✅ CONNECTÉ! Topics: {topics}")
    
except Exception as e:
    print(f"❌ Erreur: {e}")
EOF
