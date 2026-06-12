#!/bin/bash

# Diagnostic complet du setup

PROJECT_ROOT="/home/jojo/road-traffic-pred"
SPARK_HOME="/home/jojo/tools/spark"
VENV_PATH="$PROJECT_ROOT/backend_venv"

# Couleurs
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║          🔍 Diagnostic Complet du Projet          ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════╝${NC}"
echo ""

check_command() {
    local cmd=$1
    local name=$2
    if command -v "$cmd" &> /dev/null; then
        echo -e "${GREEN}✅ $name${NC}"
        return 0
    else
        echo -e "${RED}❌ $name${NC}"
        return 1
    fi
}

check_file() {
    local file=$1
    local name=$2
    if [ -f "$file" ]; then
        echo -e "${GREEN}✅ $name${NC}"
        return 0
    else
        echo -e "${RED}❌ $name${NC}"
        return 1
    fi
}

check_dir() {
    local dir=$1
    local name=$2
    if [ -d "$dir" ]; then
        echo -e "${GREEN}✅ $name${NC}"
        return 0
    else
        echo -e "${RED}❌ $name${NC}"
        return 1
    fi
}

echo -e "${YELLOW}📦 Vérification des outils système:${NC}"
check_command "java" "Java"
check_command "python3" "Python 3"
check_command "pip" "PIP"
echo ""

echo -e "${YELLOW}📁 Vérification des répertoires:${NC}"
check_dir "$VENV_PATH" "Virtual Environment"
check_dir "$SPARK_HOME" "Apache Spark"
check_dir "$PROJECT_ROOT/models" "Models Directory"
check_dir "$PROJECT_ROOT/data" "Data Directory"
check_dir "$PROJECT_ROOT/certs" "Certs Directory"
echo ""

echo -e "${YELLOW}📄 Vérification des fichiers critiques:${NC}"
check_file "$PROJECT_ROOT/.env" ".env Configuration"
check_file "$PROJECT_ROOT/.env.example" ".env.example Template"
check_file "$PROJECT_ROOT/models/global_model.pt" "PyTorch Model"
check_file "$PROJECT_ROOT/data/test.csv" "Test Data CSV"
check_file "$PROJECT_ROOT/mini-services/api/main.py" "API Main Script"
check_file "$PROJECT_ROOT/mini-services/simulator/main.py" "Simulator Script"
check_file "$PROJECT_ROOT/mini-services/spark/spark_processor.py" "Spark Processor"
echo ""

echo -e "${YELLOW}🐍 Vérification Python Packages:${NC}"
if [ -f "$VENV_PATH/bin/python" ]; then
    source "$VENV_PATH/bin/activate"
    
    # FastAPI
    "$VENV_PATH/bin/python" -c "import fastapi; print(f'✅ FastAPI {fastapi.__version__}')" 2>/dev/null || echo -e "${RED}❌ FastAPI${NC}"
    
    # Kafka
    "$VENV_PATH/bin/python" -c "import kafka; print('✅ kafka-python')" 2>/dev/null || echo -e "${RED}❌ kafka-python${NC}"
    
    # Pydantic
    "$VENV_PATH/bin/python" -c "import pydantic; print(f'✅ Pydantic {pydantic.__version__}')" 2>/dev/null || echo -e "${RED}❌ Pydantic${NC}"
    
    deactivate
else
    echo -e "${RED}❌ Virtual Environment not found${NC}"
fi
echo ""

echo -e "${YELLOW}🔍 Vérification Configuration .env:${NC}"
if [ -f "$PROJECT_ROOT/.env" ]; then
    if grep -q "KAFKA_HOST=" "$PROJECT_ROOT/.env"; then
        echo -e "${GREEN}✅ KAFKA_HOST configuré${NC}"
    else
        echo -e "${RED}❌ KAFKA_HOST manquant${NC}"
    fi
    
    if grep -q "KAFKA_USERNAME=" "$PROJECT_ROOT/.env"; then
        echo -e "${GREEN}✅ KAFKA_USERNAME configuré${NC}"
    else
        echo -e "${RED}❌ KAFKA_USERNAME manquant${NC}"
    fi
else
    echo -e "${RED}❌ .env non trouvé${NC}"
fi
echo ""

echo -e "${BLUE}╔════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║              🎯 Prochaines Étapes                 ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${YELLOW}1. Configurez .env avec vos credentials Aiven:${NC}"
echo "   nano .env"
echo ""
echo -e "${YELLOW}2. Téléchargez le certificate ca.pem depuis Aiven:${NC}"
echo "   cp ~/Downloads/ca.pem certs/ca.pem"
echo ""
echo -e "${YELLOW}3. Testez la connexion Kafka:${NC}"
echo "   ./test-kafka.sh"
echo ""
echo -e "${YELLOW}4. Lancez les services (3 terminaux):${NC}"
echo "   ./start-all.sh"
echo ""
