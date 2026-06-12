CREATE TABLE IF NOT EXISTS predictions (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMP NOT NULL,
    junction_id INTEGER NOT NULL,
    actual_vehicles INTEGER,
    predicted_vehicles FLOAT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_junction_timestamp ON predictions (junction_id, timestamp);
