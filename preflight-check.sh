#!/bin/bash
# 🔍 Pre-Flight Checklist - Road Flow v1.0
# Exécutez ce script pour vérifier que tout est prêt

set +e

PROJECT_DIR="/home/jojo/road-traffic-pred"
SPARK_HOME="/home/jojo/tools/spark"

# Couleurs
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}   🔍 Road Flow - PRE-FLIGHT CHECKLIST${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
echo ""

# Counter
TOTAL=0
PASSED=0

# Function to check
check() {
  local exit_status=$?
  TOTAL=$((TOTAL + 1))
  if [ $exit_status -eq 0 ]; then
    echo -e "${GREEN}✓ $1${NC}"
    PASSED=$((PASSED + 1))
  else
    echo -e "${RED}✗ $1${NC}"
  fi
}

# 1. System Requirements
echo -e "${YELLOW}📋 System Requirements:${NC}"

java -version > /dev/null 2>&1
check "Java installed"

command -v python3 > /dev/null 2>&1
check "Python3 installed"

command -v npm > /dev/null 2>&1 || command -v bun > /dev/null 2>&1
check "Node package manager (npm/bun)"

# 2. Project Structure
echo ""
echo -e "${YELLOW}📁 Project Structure:${NC}"

cd "$PROJECT_DIR" 2>/dev/null
check "Project directory accessible"

[ -f "$PROJECT_DIR/.env" ]
check ".env file exists"

[ -d "$PROJECT_DIR/backend_venv" ]
check "Python venv exists"

[ -d "$PROJECT_DIR/certs" ]
check "Certificates directory exists"

[ -f "$PROJECT_DIR/models/global_model.pt" ]
check "LSTM model exists"

[ -f "$PROJECT_DIR/data/test.csv" ]
check "Test data exists"

# 3. Spark Installation
echo ""
echo -e "${YELLOW}⚡ Spark Installation:${NC}"

[ -f "$SPARK_HOME/bin/spark-submit" ]
check "Spark binary exists"

"$SPARK_HOME/bin/spark-submit" --version > /dev/null 2>&1
check "Spark runs successfully"

# 4. Certificates
echo ""
echo -e "${YELLOW}🔐 Aiven Certificates:${NC}"

[ -f "$PROJECT_DIR/certs/ca.pem" ]
check "ca.pem certificate"

[ -f "$PROJECT_DIR/certs/service.cert" ]
check "service.cert certificate"

[ -f "$PROJECT_DIR/certs/service.key" ]
check "service.key certificate"

# 5. Python Dependencies
echo ""
echo -e "${YELLOW}📦 Python Dependencies:${NC}"

source "$PROJECT_DIR/backend_venv/bin/activate" 2>/dev/null
check "Python venv activation"

python -c "import fastapi" 2>/dev/null
check "FastAPI installed"

python -c "import kafka" 2>/dev/null
check "Kafka-python installed"

python -c "import torch" 2>/dev/null
check "PyTorch installed"

python -c "import pyspark" 2>/dev/null
check "PySpark installed"

python -c "import pandas" 2>/dev/null
check "Pandas installed"

# 6. Configuration
echo ""
echo -e "${YELLOW}⚙️  Configuration:${NC}"

grep "KAFKA_HOST=" "$PROJECT_DIR/.env" > /dev/null 2>&1
check ".env has KAFKA_HOST"

[ -n "$(grep 'KAFKA_PASSWORD' "$PROJECT_DIR/.env" | grep -v '^#' | grep -v 'YOUR_PASSWORD')" ] 2>/dev/null
check ".env has KAFKA_PASSWORD set"

grep "SPARK_HOME=" "$PROJECT_DIR/.env" > /dev/null 2>&1
check ".env has SPARK_HOME"

# 7. Frontend Files
echo ""
echo -e "${YELLOW}🎨 Frontend Assets:${NC}"

[ -f "$PROJECT_DIR/public/favicon.svg" ]
check "Favicon SVG created"

[ -f "$PROJECT_DIR/src/components/traffic/Launchpad.tsx" ]
check "Launchpad component"

[ -f "$PROJECT_DIR/src/components/traffic/TrafficDashboard.tsx" ]
check "TrafficDashboard component"

[ -f "$PROJECT_DIR/src/app/dashboard/page.tsx" ]
check "Dashboard page"

# 8. Scripts
echo ""
echo -e "${YELLOW}🚀 Scripts:${NC}"

[ -f "$PROJECT_DIR/start-services.sh" ] && [ -x "$PROJECT_DIR/start-services.sh" ]
check "start-services.sh (executable)"

[ -f "$PROJECT_DIR/test_kafka.sh" ] && [ -x "$PROJECT_DIR/test_kafka.sh" ]
check "test_kafka.sh (executable)"

# 9. Documentation
echo ""
echo -e "${YELLOW}📚 Documentation:${NC}"

[ -f "$PROJECT_DIR/QUICK_START.md" ]
check "QUICK_START.md guide"

[ -f "$PROJECT_DIR/RESUME_MODIFICATIONS.md" ]
check "RESUME_MODIFICATIONS.md"

[ -f "$PROJECT_DIR/README.md" ]
check "README.md"

# 10. Ports Available
echo ""
echo -e "${YELLOW}🔌 Network Ports:${NC}"

! lsof -i :3000 > /dev/null 2>&1
check "Port 3000 available (Frontend)"

! lsof -i :8000 > /dev/null 2>&1
check "Port 8000 available (API)"

! lsof -i :8001 > /dev/null 2>&1
check "Port 8001 available (Simulator)"

# Summary
echo ""
echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}   📊 CHECKLIST SUMMARY${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
echo ""

PERCENTAGE=$((PASSED * 100 / TOTAL))

echo -e "Passed: ${GREEN}${PASSED}/${TOTAL}${NC} (${PERCENTAGE}%)"
echo ""

if [ "$PASSED" -eq "$TOTAL" ]; then
  echo -e "${GREEN}🎉 ALL CHECKS PASSED!${NC}"
  echo ""
  echo -e "${YELLOW}Next steps:${NC}"
  echo -e "  1. ${BLUE}nano .env${NC} - Set KAFKA_PASSWORD"
  echo -e "  2. ${BLUE}./test_kafka.sh${NC} - Test connection"
  echo -e "  3. ${BLUE}./start-services.sh${NC} - Start services"
  echo -e "  4. ${BLUE}http://localhost:3000${NC} - Open app"
  exit 0
else
  echo -e "${RED}❌ SOME CHECKS FAILED${NC}"
  echo ""
  echo -e "${YELLOW}Issues to fix:${NC}"
  echo "  - Check if all dependencies are installed"
  echo "  - Verify .env configuration"
  echo "  - Ensure ports are not blocked"
  echo "  - Check file permissions"
  exit 1
fi
