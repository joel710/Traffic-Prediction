import os
import ssl
from pathlib import Path
from kafka import KafkaConsumer
from kafka.errors import KafkaError

# Configuration manuelle pour le test direct
host = "kafka-4238954-kafka-2c1f.h.aivencloud.com"
port = 17498
bootstrap_server = f"{host}:{port}"
ca = "certs/ca.pem"
cert = "certs/service.cert"
key = "certs/service.key"

print(f"🔐 Test direct mTLS vers {bootstrap_server}")

opts = {
    "bootstrap_servers": [bootstrap_server],
    "value_deserializer": lambda v: v.decode('utf-8'),
    "request_timeout_ms": 10000,
    "api_version": (2, 8, 0),
}

if Path(ca).exists() and Path(cert).exists() and Path(key).exists():
    print("✓ Certificats trouvés, configuration du contexte SSL...")
    context = ssl.create_default_context(cafile=ca)
    context.load_cert_chain(certfile=cert, keyfile=key)
    context.check_hostname = False
    context.verify_mode = ssl.CERT_NONE
    
    opts.update({
        "security_protocol": "SSL",
        "ssl_context": context,
    })
    
    try:
        consumer = KafkaConsumer(**opts)
        topics = consumer.topics()
        print(f"✅ CONNECTÉ! Topics: {topics}")
    except Exception as e:
        print(f"❌ ÉCHEC: {e}")
else:
    print("❌ Certificats manquants.")
