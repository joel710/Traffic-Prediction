FROM python:3.11-slim

# Install Java (required for PySpark)
RUN apt-get update && apt-get install -y \
    openjdk-21-jre wget \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies (includes pyspark + torch)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

ENV PYSPARK_PYTHON=python3
ENV PYSPARK_DRIVER_PYTHON=python3

# Pre-download spark-sql-kafka jar (avoids runtime DNS issues)
RUN mkdir -p /app/jars && \
    wget -q -O /app/jars/spark-sql-kafka-0-10_2.12-3.5.4.jar \
    "https://repo1.maven.org/maven2/org/apache/spark/spark-sql-kafka-0-10_2.12/3.5.4/spark-sql-kafka-0-10_2.12-3.5.4.jar" && \
    wget -q -O /app/jars/kafka-clients-3.5.1.jar \
    "https://repo1.maven.org/maven2/org/apache/kafka/kafka-clients/3.5.1/kafka-clients-3.5.1.jar" && \
    wget -q -O /app/jars/spark-token-provider-kafka-0-10_2.12-3.5.4.jar \
    "https://repo1.maven.org/maven2/org/apache/spark/spark-token-provider-kafka-0-10_2.12/3.5.4/spark-token-provider-kafka-0-10_2.12-3.5.4.jar" && \
    wget -q -O /app/jars/commons-pool2-2.11.1.jar \
    "https://repo1.maven.org/maven2/org/apache/commons/commons-pool2/2.11.1/commons-pool2-2.11.1.jar" && \
    echo "✅ Spark Kafka jars downloaded"

WORKDIR /app
COPY spark_processor.py traffic_gnn.py ./

ENTRYPOINT []
CMD ["spark-submit", "--master", "local[*]", \
     "--jars", "/app/jars/*", \
     "spark_processor.py"]
