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

print(f"Scaler Y: mean={mean_y}, std={std_y}")

# Load test data
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

# We need to construct sequences of 24 time steps.
# The dataset has rows ordered by DateTime, and for each time step, all 4 junctions.
# Let's group by Junction, sort by DateTime, and extract sequences.
junction_groups = {}
for j in range(1, 5):
    j_df = df[df["Junction"] == j].sort_values("DateTime")
    junction_groups[j] = j_df

# Let's find the overlapping indices so we can construct matching sequences
n_steps = len(junction_groups[1])
print(f"Total steps per junction: {n_steps}")

# We will evaluate different scaling options on 200 samples
num_samples = min(200, n_steps - 24)

def run_evaluation(scale_inputs_mode):
    # scale_inputs_mode:
    # 0: no input scaling
    # 1: scale veh_lag_* and veh_ma_* using target scaler
    # 2: scale all features (except sin/cos/weekend) by target scaler
    # 3: scale veh_lag_* and veh_ma_* using target scaler, and veh_diff_1 divided by std_y
    
    total_ae = 0.0
    count = 0
    
    for i in range(num_samples):
        # Build sequence (4, 24, 14)
        seqs = []
        actuals = []
        for j in range(1, 5):
            j_df = junction_groups[j].iloc[i : i + 24]
            features = j_df[FEATURE_COLS].values.copy() # (24, 14)
            
            # Apply scaling according to mode
            if scale_inputs_mode == 1:
                # Features 7 to 12 (veh_lag_1, 2, 3, 24, veh_ma_6, veh_ma_24) are at indices 7,8,9,10,11,12
                features[:, 7:13] = (features[:, 7:13] - mean_y) / std_y
            elif scale_inputs_mode == 2:
                # Scale all features except sin/cos/weekend (features 7 to 13)
                features[:, 7:14] = (features[:, 7:14] - mean_y) / std_y
            elif scale_inputs_mode == 3:
                # Scale lag/ma using target scaler, and diff divided by std_y
                features[:, 7:13] = (features[:, 7:13] - mean_y) / std_y
                features[:, 13] = features[:, 13] / std_y
                
            seqs.append(features)
            actuals.append(j_df.iloc[-1]["Vehicles"])
            
        x = torch.tensor(np.stack(seqs, axis=0), dtype=torch.float32).unsqueeze(0) # (1, 4, 24, 14)
        
        with torch.no_grad():
            out = model(x).squeeze(0) # (4, 1)
            
        for j_idx in range(4):
            pred_raw = float(out[j_idx, 0])
            pred_unscaled = max(0.0, float(scaler_y.inverse_transform([[pred_raw]])[0, 0]))
            total_ae += abs(pred_unscaled - actuals[j_idx])
            count += 1
            
    return total_ae / count

print("Evaluating MAE for different scaling modes:")
for mode in [0, 1, 2, 3]:
    mae = run_evaluation(mode)
    print(f"Mode {mode}: MAE = {mae:.4f}")
