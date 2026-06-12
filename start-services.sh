#!/bin/bash
# 🚀 Script de démarrage complet - Road Flow

set -e

PROJECT_DIR="/home/jojo/road-traffic-pred"
SPARK_HOME="/home/jojo/tools/spark"
COLORS_GREEN='\033[0;32m'
COLORS_BLUE='\033[0;34m'
COLORS_YELLOW='\033[1;33m'
COLORS_RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${COLORS_BLUE}════════════════════════════════════════════════════════════════${NC}"
echo -e "${COLORS_BLUE}   🚦 Road Flow - Real-Time Traffic Prediction System${NC}"
echo -e "${COLORS_BLUE}════════════════════════════════════════════════════════════════${NC}"
echo ""

# Vérifier prérequis
echo -e "${COLORS_YELLOW}📋 Checking prerequisites...${NC}"
echo ""

# Vérifier Java
if ! command -v java &> /dev/null; then
    echo -e "${COLORS_RED}❌ Java not found! Install with: sudo apt-get install default-jdk${NC}"
    exit 1
fi
echo -e "${COLORS_GREEN}✓ Java installed: $(java -version 2>&1 | head -n1)${NC}"

# Vérifier Spark
if [ ! -f "$SPARK_HOME/bin/spark-submit" ]; then
    echo -e "${COLORS_RED}❌ Spark not found at $SPARK_HOME${NC}"
    exit 1
fi
echo -e "${COLORS_GREEN}✓ Spark installed${NC}"

# Vérifier .env
if [ ! -f "$PROJECT_DIR/.env" ]; then
    echo -e "${COLORS_RED}❌ .env file not found!${NC}"
    exit 1
fi
echo -e "${COLORS_GREEN}✓ .env file found${NC}"

# Load .env variables
export $(grep -v '^#' "$PROJECT_DIR/.env" | xargs)

# Vérifier venv
if [ ! -d "$PROJECT_DIR/backend_venv" ]; then
    echo -e "${COLORS_RED}❌ backend_venv not found!${NC}"
    exit 1
fi
echo -e "${COLORS_GREEN}✓ Python venv ready${NC}"

echo ""
echo -e "${COLORS_BLUE}════════════════════════════════════════════════════════════════${NC}"
echo -e "${COLORS_YELLOW}🚀 Starting services...${NC}"
echo -e "${COLORS_BLUE}════════════════════════════════════════════════════════════════${NC}"
echo ""

# Terminal 1: API Backend
echo -e "${COLORS_YELLOW}[1/3] Starting FastAPI Backend on port 8000...${NC}"
(
  cd "$PROJECT_DIR"
  export PYTHONPATH="$PROJECT_DIR:$PYTHONPATH"
  exec "$PROJECT_DIR/venv/bin/uvicorn" main:app --app-dir mini-services/api --host 0.0.0.0 --port 8000 --reload
) &
API_PID=$!
echo -e "${COLORS_GREEN}✓ API started (PID: $API_PID)${NC}"
sleep 3

# Terminal 2: Simulator (optional)
if [ "$1" == "--with-simulator" ]; then
  echo -e "${COLORS_YELLOW}[2/3] Starting Simulator...${NC}"
  (
    cd "$PROJECT_DIR"
    export PYTHONPATH="$PROJECT_DIR:$PYTHONPATH"
    exec "$PROJECT_DIR/venv/bin/python" mini-services/simulator/main.py
  ) &
  SIM_PID=$!
  echo -e "${COLORS_GREEN}✓ Simulator started (PID: $SIM_PID)${NC}"
  sleep 2
fi

# Terminal 3: Spark Processor
echo -e "${COLORS_YELLOW}[3/3] Starting Spark Processor...${NC}"
(
  export SPARK_HOME="$SPARK_HOME"
  export PATH="$PATH:$SPARK_HOME/bin"
  export PYTHONPATH="$PROJECT_DIR:$PYTHONPATH"
  
  cd "$PROJECT_DIR"
  source venv/bin/activate
  
  export PYSPARK_PYTHON="$PROJECT_DIR/venv/bin/python"
  export PYSPARK_DRIVER_PYTHON="$PROJECT_DIR/venv/bin/python"
  
  exec $SPARK_HOME/bin/spark-submit \
    --master "local[*]" \
    --packages org.apache.spark:spark-sql-kafka-0-10_2.12:3.5.0 \
    --driver-memory 1g \
    --executor-memory 1g \
    --total-executor-cores 2 \
    mini-services/spark/spark_processor.py
) &
SPARK_PID=$!
echo -e "${COLORS_GREEN}✓ Spark Processor started (PID: $SPARK_PID)${NC}"

echo ""
echo -e "${COLORS_BLUE}════════════════════════════════════════════════════════════════${NC}"
echo -e "${COLORS_GREEN}✓ All services running!${NC}"
echo -e "${COLORS_BLUE}════════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${COLORS_YELLOW}📍 Service URLs:${NC}"
echo -e "   API:        ${COLORS_GREEN}http://localhost:8000${NC}"
echo -e "   WebSocket:  ${COLORS_GREEN}ws://localhost:8000/ws/traffic${NC}"
echo -e "   Frontend:   ${COLORS_GREEN}http://localhost:3000${NC}"
echo ""
echo -e "${COLORS_YELLOW}🔥 To stop all services, press Ctrl+C${NC}"
echo ""

# Garder le script actif
trap "kill $API_PID $SIM_PID $SPARK_PID 2>/dev/null; exit" EXIT INT TERM

wait
