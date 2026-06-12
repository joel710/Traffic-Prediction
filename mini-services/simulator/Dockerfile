FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y gcc \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Data is mounted at /app/data via docker-compose volume
# Kafka host is injected via KAFKA_HOST env var (default: "kafka" in Docker network)

CMD ["python", "simulator.py"]
