#!/bin/bash
# 🚀 Road Flow — Tout lancer en une commande (backend + frontend)
# Usage: ./start-all.sh              # API + Frontend
#        ./start-all.sh --full       # API + Simulator + Spark + Frontend

set -e

PROJECT_DIR="/home/jojo/road-traffic-pred"
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}   🚦 Road Flow — Launching All Services${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
echo ""

# ─── Launch backend services ──────────────────────────────────
echo -e "${GREEN}[1/2] Starting backend services...${NC}"
if [ "$1" = "--full" ]; then
    "$PROJECT_DIR/start-services.sh" --with-simulator &
else
    "$PROJECT_DIR/start-services.sh" &
fi
BACKEND_PID=$!
sleep 3

# ─── Launch frontend ──────────────────────────────────────────
echo -e "${GREEN}[2/2] Starting frontend (Next.js)...${NC}"
cd "$PROJECT_DIR"
npm run dev &
FRONTEND_PID=$!

echo ""
echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✅ All services launching!${NC}"
echo ""
echo -e "  📍 Frontend:   ${GREEN}http://localhost:3000${NC}"
echo -e "  📍 Dashboard:  ${GREEN}http://localhost:3000/dashboard${NC}"
echo -e "  📍 API:        ${GREEN}http://localhost:8000${NC}"
echo -e "  📍 API Docs:   ${GREEN}http://localhost:8000/docs${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
echo ""
echo "  Ctrl+C to stop all services"
echo ""

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" EXIT INT TERM
wait
