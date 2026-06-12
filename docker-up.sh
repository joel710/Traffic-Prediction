#!/bin/bash
# Road Flow — One-command Docker launch
# Usage: ./docker-up.sh           # Frontend + API only
#        ./docker-up.sh --full    # Full stack (incl. Spark + Simulator)

set -e

# ─── Env Setup ──────────────────────────────────────────────────
if [ ! -f .env ]; then
  echo "📝 .env file not found. Creating from .env.example..."
  cp .env.example .env
  echo "✅ .env created. You can edit it if you want to use Aiven Kafka."
fi

# Determine network mode for building (Fix for DNS issues on Linux)
BUILD_NETWORK=""
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
  BUILD_NETWORK="--network=host"
fi

# Pre-build images to ensure dependencies are installed correctly
# This bypasses some DNS issues by using the host network during build
echo "🛠️  Building images..."

# Define services to build: "image_name:context"
SERVICES=(
  "road-traffic-pred-frontend:."
  "road-traffic-pred-backend:./mini-services/api"
)

if [ "$1" = "--full" ]; then
  SERVICES+=(
    "road-traffic-pred-simulator:./mini-services/simulator"
    "road-traffic-pred-spark-processor:./mini-services/spark"
  )
fi

for service in "${SERVICES[@]}"; do
  IMAGE="${service%%:*}"
  CONTEXT="${service#*:}"
  echo "  📦 Building $IMAGE from $CONTEXT..."
  docker build $BUILD_NETWORK -t "$IMAGE" "$CONTEXT"
done

COMPOSE_ARGS="up -d"

if [ "$1" = "--full" ]; then
  echo "🚀 Launching FULL stack: Frontend + API + Spark + Simulator"
  docker compose --profile full $COMPOSE_ARGS
else
  echo "🚀 Launching: Frontend + API (use --full for Spark + Simulator)"
  docker compose $COMPOSE_ARGS
fi

echo ""
echo "✅ Services:"
echo "   Frontend:  http://localhost:3000"
echo "   API:       http://localhost:8000"
echo "   API Docs:  http://localhost:8000/docs"

if [ "$1" = "--full" ]; then
  echo "   Simulator: http://localhost:8001"
  echo "   Spark UI:  http://localhost:4040"
fi

echo ""
echo "📋 docker compose logs -f     # Follow all logs"
echo "   docker compose down        # Stop all services"
