.PHONY: up up-core down logs ps rebuild

# Detect Linux for --network=host build (DNS workaround)
UNAME_S := $(shell uname -s)
BUILD_NET := $(if $(filter Linux,$(UNAME_S)),--network=host,)

# ─── 🚀 Full stack (Frontend + Backend + Kafka + Simulator + Spark) ───
up:
	@echo "  🛠️  Building Docker images..."
	set -e; \
	pids=""; \
	echo "    Building frontend..."; \
	docker build $(BUILD_NET) -t road-traffic-pred-frontend . & pids="$$! $${pids}"; \
	echo "    Building backend API..."; \
	docker build $(BUILD_NET) -t road-traffic-pred-backend ./mini-services/api & pids="$$! $${pids}"; \
	echo "    Building simulator..."; \
	docker build $(BUILD_NET) -t road-traffic-pred-simulator ./mini-services/simulator & pids="$$! $${pids}"; \
	echo "    Building Spark processor..."; \
	docker build $(BUILD_NET) -t road-traffic-pred-spark-processor ./mini-services/spark & pids="$$! $${pids}"; \
	status=0; \
	for pid in $${pids}; do \
		wait $$pid || status=1; \
	done; \
	if [ $$status -ne 0 ]; then \
		echo "  ❌ Build failed (see errors above)."; \
		exit 1; \
	fi
	@echo "  ✅ Build complete. Launching stack..."
	docker compose --profile full up -d
	@echo ""
	@echo "  ✅ Stack launched!"
	@echo "  🌐 Frontend : http://localhost:3000"
	@echo "  🔌 API      : http://localhost:8000"
	@echo "  📡 Simulator: http://localhost:8001"
	@echo "  📊 Status   : make ps"
	@echo "  📋 Logs     : make logs"
	@echo ""

# ─── 🎯 Core only (no simulator / spark) ─────────────────────────
up-core:
	@echo "  🛠️  Building Docker images..."
	set -e; \
	pids=""; \
	echo "    Building frontend..."; \
	docker build $(BUILD_NET) -t road-traffic-pred-frontend . & pids="$$! $${pids}"; \
	echo "    Building backend API..."; \
	docker build $(BUILD_NET) -t road-traffic-pred-backend ./mini-services/api & pids="$$! $${pids}"; \
	status=0; \
	for pid in $${pids}; do \
		wait $$pid || status=1; \
	done; \
	if [ $$status -ne 0 ]; then \
		echo "  ❌ Build failed (see errors above)."; \
		exit 1; \
	fi
	@echo "  ✅ Build complete. Launching core stack..."
	docker compose up -d
	@echo ""
	@echo "  ✅ Core stack launched!"
	@echo "  🌐 Frontend: http://localhost:3000"
	@echo "  🔌 API     : http://localhost:8000"
	@echo ""

# ─── 🛑 Stop everything ──────────────────────────────────────────
down:
	docker compose --profile full down -v 2>/dev/null || true
	docker compose down -v 2>/dev/null || true

# ─── 📋 Live logs ────────────────────────────────────────────────
logs:
	docker compose --profile full logs -f

# ─── 📊 Container status ─────────────────────────────────────────
ps:
	docker compose --profile full ps

# ─── ♻️  Rebuild all images and restart ──────────────────────────
rebuild:
	@echo "  🛠️  Rebuilding all images from scratch..."
	docker compose --profile full down -v 2>/dev/null || true
	docker build $(BUILD_NET) --no-cache -t road-traffic-pred-frontend .
	docker build $(BUILD_NET) --no-cache -t road-traffic-pred-backend ./mini-services/api
	docker build $(BUILD_NET) --no-cache -t road-traffic-pred-simulator ./mini-services/simulator
	docker build $(BUILD_NET) --no-cache -t road-traffic-pred-spark-processor ./mini-services/spark
	docker compose --profile full up -d
	@echo ""
	@echo "  ✅ Rebuild complete. Stack running."
	@echo ""
