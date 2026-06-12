from diagrams import Diagram, Cluster, Edge
from diagrams.onprem.analytics import Spark
from diagrams.onprem.queue import Kafka
from diagrams.onprem.compute import Server
from diagrams.programming.language import Python
from diagrams.generic.storage import Storage
from diagrams.generic.network import Firewall

# Configuration du schéma pour un rendu académique et détaillé
graph_attrs = {
    "fontsize": "16",
    "bgcolor": "white",
    "splines": "curved",
    "nodesep": "0.7",
    "ranksep": "1.0",
}

with Diagram("Architecture Profonde du Backend Road Flow", filename="backend_deep_dive", show=False, graph_attr=graph_attrs, direction="LR"):

    # --- COUCHE D'INGESTION ---
    with Cluster("Ingestion & Simulation"):
        csv_file = Storage("Historique Trafic\n(test.csv)")

        with Cluster("Simulateur (Python)"):
            parser = Python("CSV Parser")
            producer = Python("Kafka Producer")

            csv_file >> Edge(label="Lecture ligne par ligne") >> parser
            parser >> Edge(label="Conversion JSON") >> producer

    # --- COUCHE DE STREAMING (KAFKA) ---
    with Cluster("Bus de Données (Apache Kafka)"):
        with Cluster("Broker Kafka"):
            topic_input = Kafka("Topic: flux_data\n(Données Brutes)")
            topic_output = Kafka("Topic: traffic_predictions\n(Prédictions ML)")
            zookeeper = Server("Zookeeper\n(Coordination)")

            zookeeper - Edge(color="grey", style="dotted") - topic_input
            zookeeper - Edge(color="grey", style="dotted") - topic_output

    # --- COUCHE DE CALCUL (SPARK) ---
    with Cluster("Moteur de Traitement Spark"):
        with Cluster("Pipeline PySpark"):
            streaming_input = Python("Structured Streaming\n(Consommation)")
            windowing = Python("Fenêtrage Temporel\n(Sliding Window)")
            inference_engine = Python("Inférence PyTorch\n(LSTM Model)")

            streaming_input >> Edge(label="Agrégation") >> windowing
            windowing >> Edge(label="Vecteur d'entrée") >> inference_engine

        model_files = Storage("Modèles ML\n(.pt, .pkl)")
        model_files >> Edge(color="darkred", label="Chargement") >> inference_engine

    # --- COUCHE DE SERVICE (API GATEWAY) ---
    with Cluster("Passerelle API (FastAPI)"):
        with Cluster("Gestionnaire d'État"):
            listener = Python("Background Listener\n(Kafka Consumer)")
            ram_cache = Storage("État en RAM\n(Dict / Deque)")

            listener >> Edge(label="Mise à jour") >> ram_cache

        websocket_mgr = Python("WebSocket Manager\n(Push Temps Réel)")
        rest_api = Python("REST Endpoints\n(Historique/État)")

        ram_cache >> Edge(color="blue") >> websocket_mgr
        ram_cache >> Edge(color="blue") >> rest_api

    # --- CONNEXIONS INTER-COUCHES (FLUX DE DONNÉES) ---

    # Simulation -> Kafka
    producer >> Edge(color="blue", style="bold", label="Saisie") >> topic_input

    # Kafka -> Spark
    topic_input >> Edge(color="blue", style="bold") >> streaming_input

    # Spark -> Kafka
    inference_engine >> Edge(color="orange", style="bold", label="Prédiction") >> topic_output

    # Kafka -> API
    topic_output >> Edge(color="orange", style="bold") >> listener

    # API -> Utilisateur Final (conceptuel)
    websocket_mgr >> Edge(color="purple", style="bold", label="Push JSON") >> Server("Frontend Dashboard")

print("\n✅ Le schéma d'architecture profonde du backend a été généré : 'backend_deep_dive.png'")
