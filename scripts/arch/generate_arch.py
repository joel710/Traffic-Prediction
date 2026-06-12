from diagrams import Diagram, Cluster, Edge
from diagrams.onprem.analytics import Spark
from diagrams.onprem.queue import Kafka
from diagrams.onprem.compute import Server
from diagrams.onprem.container import Docker
from diagrams.programming.language import Python
from diagrams.generic.storage import Storage
from diagrams.generic.device import Tablet

# Configuration du schéma
graph_attrs = {
    "fontsize": "20",
    "bgcolor": "white",
    "splines": "curved",
}

with Diagram("Architecture Système Road Flow", filename="road_flow_architecture", show=False, graph_attr=graph_attrs, direction="LR"):

    # --- Source de Données ---
    with Cluster("Couche d'Ingestion"):
        source_data = Storage("Fichiers CSV\n(Historiques)")
        simulator = Python("Simulateur\n(Produit JSON)")

        source_data >> Edge(color="darkgreen", style="dashed") >> simulator

    # --- Infrastructure de Streaming ---
    with Cluster("Infrastructure Kafka (Streaming)"):
        with Cluster("Cluster Kafka"):
            kafka_broker = Kafka("Broker Kafka")
            zookeeper = Server("Zookeeper\n(Coordination)")

            # Zookeeper gère Kafka
            zookeeper - Edge(color="grey", style="dotted") - kafka_broker

            # Topics logiques représentés par des flux
            flux_data = Edge(label="topic: flux_data", color="blue")
            traffic_preds = Edge(label="topic: traffic_predictions", color="orange")

    # --- Calcul et Inférence ---
    with Cluster("Traitement Big Data"):
        spark_processor = Spark("Spark Processor\n(PySpark + LSTM)")
        pytorch_model = Storage("Modèle PyTorch\n(.pt / .pkl)")

        # Le modèle est utilisé par Spark
        pytorch_model >> Edge(color="darkred") >> spark_processor

    # --- Services Backend ---
    with Cluster("Passerelle API"):
        api_gateway = Python("FastAPI Gateway\n(WebSockets/REST)")
        memory_state = Storage("État RAM\n(Current State)")

        api_gateway >> Edge(color="blue") >> memory_state

    # --- Interface Utilisateur ---
    with Cluster("Frontend Visualization"):
        frontend = Tablet("Dashboard Next.js\n(Three.js / MapLibre)")

    # --- Connexions Globales (Flux de données) ---

    # Simulator -> Kafka
    simulator >> flux_data >> kafka_broker

    # Kafka -> Spark
    kafka_broker >> flux_data >> spark_processor

    # Spark -> Kafka
    spark_processor >> traffic_preds >> kafka_broker

    # Kafka -> API
    kafka_broker >> traffic_preds >> api_gateway

    # API -> Frontend
    api_gateway >> Edge(label="WebSocket / JSON", color="purple", style="bold") >> frontend

print("\n✅ Le schéma a été généré avec succès : 'road_flow_architecture.png'")
