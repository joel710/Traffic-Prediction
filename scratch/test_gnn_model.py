import os
import sys
import torch
import numpy as np
import pandas as pd
import joblib

sys.path.append("mini-services/spark")
from traffic_gnn import TrafficGNN

# Load model and scaler
device = torch.device("cpu")
model = TrafficGNN(num_nodes=4, in_features=14)
model.load_pretrained("models/gnn_model.pth", map_location=device)
model.eval()

scaler_y = joblib.load("models/scaler_y.pkl")

# Load data
df = pd.read_csv("data/test_gnn.csv")

FEATURE_COLS = [
    "hour_sin", "hour_cos",
    "dow_sin", "dow_cos",
    "month_sin", "month_cos",
    "is_weekend",
    "veh_lag_1", "veh_lag_2", "veh_lag_3", "veh_lag_24",
    "veh_ma_6", "veh_ma_24",
    "veh_diff_1",
]

# Get a sequence of 24 steps for each junction
feat_window = {j: [] for j in range(1, 5)}
actual_vehicles = {j: [] for j in range(1, 5)}

count = 0
for idx, row in df.iterrows():
    j = int(row["Junction"])
    if j < 1 or j > 4:
        continue
    
    features = [float(row[c]) for c in FEATURE_COLS]
    feat_window[j].append(features)
    actual_vehicles[j].append(row["Vehicles"])
    
    if len(feat_window[1]) >= 24 and len(feat_window[2]) >= 24 and len(feat_window[3]) >= 24 and len(feat_window[4]) >= 24:
        break

# Format input tensor
sequences = []
for j in range(1, 5):
    # Take the first 24 steps
    sequences.append(np.array(feat_window[j][:24], dtype=np.float32))

sequences = np.stack(sequences, axis=0) # (4, 24, 14)

# Test with and without scaling
mean_y = scaler_y.mean_[0]
std_y = scaler_y.scale_[0]

print(f"\n--- Testing WITH input scaling (like in spark_processor.py) ---")
sequences_scaled = sequences.copy()
sequences_scaled[:, :, 7:14] = (sequences_scaled[:, :, 7:14] - mean_y) / std_y
x_scaled = torch.tensor(sequences_scaled, dtype=torch.float32).unsqueeze(0)

with torch.no_grad():
    out_scaled = model(x_scaled).squeeze(0)

for i, jid in enumerate(range(1, 5)):
    pred_raw = float(out_scaled[i, 0])
    pred_unscaled = pred_raw * std_y + mean_y
    print(f"Junction {jid}: Raw={pred_raw:.4f}, Unscaled={pred_unscaled:.2f}")

print(f"\n--- Testing WITHOUT input scaling ---")
x_raw = torch.tensor(sequences, dtype=torch.float32).unsqueeze(0)
with torch.no_grad():
    out_raw = model(x_raw).squeeze(0)

for i, jid in enumerate(range(1, 5)):
    pred_raw = float(out_raw[i, 0])
    pred_unscaled = pred_raw * std_y + mean_y
    print(f"Junction {jid}: Raw={pred_raw:.4f}, Unscaled={pred_unscaled:.2f}")
