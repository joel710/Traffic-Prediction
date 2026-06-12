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
mean_y = scaler_y.mean_[0]
std_y = scaler_y.scale_[0]

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

# Group by Junction
junction_groups = {}
for j in range(1, 5):
    junction_groups[j] = df[df["Junction"] == j].sort_values("DateTime")

n_steps = len(junction_groups[1])
num_samples = min(200, n_steps - 24)

# Grid search scaling options
scaling_configs = [
    ("No scaling", lambda f: f),
    ("StandardScale target scaler on veh columns only", lambda f: StandardScaleVehicles(f, mean_y, std_y)),
    ("StandardScale target scaler on all columns", lambda f: StandardScaleAll(f, mean_y, std_y)),
    ("MinMax by 162.0 on veh columns only", lambda f: MinMaxVehicles(f, 162.0)),
    ("MinMax by 150.0 on veh columns only", lambda f: MinMaxVehicles(f, 150.0)),
    ("StandardScale test set mean/std on veh columns only", lambda f: StandardScaleVehicles(f, 29.74, 27.97)),
]

def StandardScaleVehicles(f, mean, std):
    f_new = f.copy()
    f_new[:, 7:13] = (f_new[:, 7:13] - mean) / std
    f_new[:, 13] = f_new[:, 13] / std # diff scaled by std only
    return f_new

def StandardScaleAll(f, mean, std):
    f_new = f.copy()
    f_new[:, 7:14] = (f_new[:, 7:14] - mean) / std
    return f_new

def MinMaxVehicles(f, max_val):
    f_new = f.copy()
    f_new[:, 7:13] = f_new[:, 7:13] / max_val
    f_new[:, 13] = f_new[:, 13] / max_val
    return f_new

for name, scale_fn in scaling_configs:
    total_ae = 0.0
    count = 0
    for i in range(num_samples):
        seqs = []
        actuals = []
        for j in range(1, 5):
            j_df = junction_groups[j].iloc[i : i + 24]
            features = j_df[FEATURE_COLS].values.copy()
            features = scale_fn(features)
            seqs.append(features)
            actuals.append(j_df.iloc[-1]["Vehicles"])
            
        x = torch.tensor(np.stack(seqs, axis=0), dtype=torch.float32).unsqueeze(0)
        with torch.no_grad():
            out = model(x).squeeze(0)
            
        for j_idx in range(4):
            pred_raw = float(out[j_idx, 0])
            pred_unscaled = max(0.0, float(scaler_y.inverse_transform([[pred_raw]])[0, 0]))
            total_ae += abs(pred_unscaled - actuals[j_idx])
            count += 1
            
    mae = total_ae / count
    print(f"{name:55} | MAE = {mae:.4f}")
