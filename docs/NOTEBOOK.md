# 📓 Notebook d'Entraînement — TrafficGNN

## Table des matières

1. [Présentation](#1-présentation)
2. [Structure du notebook](#2-structure-du-notebook)
3. [Préparation des données](#3-préparation-des-données)
4. [Feature engineering](#4-feature-engineering)
5. [Architecture et entraînement](#5-architecture-et-entraînement)
6. [Évaluation](#6-évaluation)
7. [Export du modèle](#7-export-du-modèle)
8. [Comment ré-entraîner](#8-comment-ré-entraîner)

---

## 1. Présentation

Le notebook `models/model_projet_tutoré(3).ipynb` contient le pipeline complet d'entraînement du **TrafficGNN**, le modèle de prédiction de flux de véhicules. Il a été exécuté sur un dataset de ~48 000 lignes provenant de capteurs routiers, couvrant 4 junctions sur plusieurs années.

**Objectif :** À partir d'une fenêtre de 24 pas de temps historiques (14 features chacun), prédire le nombre de véhicules au pas suivant pour chaque junction.

**Fichier source :** Le notebook original se trouve dans `models/model_projet_tutoré(3).ipynb`.

---

## 2. Structure du notebook

Le notebook est organisé en 7 sections principales :

```
Section 1 : Import des bibliothèques
Section 2 : Chargement et exploration des données
Section 3 : Feature engineering temporel
Section 4 : Création des séquences (sliding window)
Section 5 : Définition du modèle TrafficGNN
Section 6 : Entraînement (boucle d'optimisation)
Section 7 : Évaluation et sauvegarde
```

### Bibliothèques utilisées

```python
import pandas as pd
import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import mean_absolute_error, mean_squared_error
import matplotlib.pyplot as plt
import joblib
```

---

## 3. Préparation des données

### 3.1 Chargement

```python
# Chargement des fichiers CSV
train_df = pd.read_csv("data/train.csv")
test_df  = pd.read_csv("data/test_gnn.csv")

# Aperçu des colonnes
print(train_df.columns.tolist())
# ['DateTime', 'Junction', 'Vehicles', 'ID', 'hour', 'dayofweek',
#  'month', 'is_weekend', 'hour_sin', 'hour_cos', 'dow_sin', 'dow_cos',
#  'month_sin', 'month_cos', 'veh_lag_1', 'veh_lag_2', 'veh_lag_3',
#  'veh_lag_24', 'veh_ma_6', 'veh_ma_24', 'veh_diff_1']
```

### 3.2 Statistiques descriptives

| Junction | Nb lignes | Min | Max | Moyenne | Écart-type |
|---|---|---|---|---|---|
| J1 | ~12 000 | 0 | 187 | 35.2 | 22.1 |
| J2 | ~12 000 | 0 | 98 | 12.8 | 10.5 |
| J3 | ~12 000 | 0 | 145 | 22.5 | 18.3 |
| J4 | ~12 000 | 0 | 67 | 8.4 | 7.2 |

### 3.3 Tri temporel

Les données sont triées par `DateTime` et groupées par `Junction` pour respecter l'ordre temporel :

```python
train_df["DateTime"] = pd.to_datetime(train_df["DateTime"])
train_df = train_df.sort_values(["Junction", "DateTime"]).reset_index(drop=True)
```

**Important :** Le split entraînement/test est temporel (pas aléatoire). On prend les 80% les plus anciens pour l'entraînement, les 20% les plus récents pour le test. Cela évite le *data leakage*.

---

## 4. Feature engineering

### 4.1 Encodages cycliques

Les variables temporelles (`hour`, `dayofweek`, `month`) sont cycliques. Un encodage sin/cos préserve la distance circulaire :

```python
# Exemple : 23h et 0h sont proches, mais en valeur brute |23-0| = 23
# Avec sin/cos : distance euclidienne = sqrt((sin23-sin0)² + (cos23-cos0)²) ≈ 0.26

df["hour_sin"] = np.sin(2 * np.pi * df["hour"] / 24)
df["hour_cos"] = np.cos(2 * np.pi * df["hour"] / 24)

df["dow_sin"] = np.sin(2 * np.pi * df["dayofweek"] / 7)
df["dow_cos"] = np.cos(2 * np.pi * df["dayofweek"] / 7)

df["month_sin"] = np.sin(2 * np.pi * (df["month"] - 1) / 12)
df["month_cos"] = np.cos(2 * np.pi * (df["month"] - 1) / 12)
```

```
hour_sin = sin(2π × hour/24)    → 0..23 ↦ [-1, 1]
hour_cos = cos(2π × hour/24)    → 0..23 ↦ [-1, 1]
dow_sin  = sin(2π × day/7)      → 0..6  ↦ [-1, 1]
dow_cos  = cos(2π × day/7)      → 0..6  ↦ [-1, 1]
month_sin = sin(2π × (month-1)/12) → 1..12 ↦ [-1, 1]
month_cos = cos(2π × (month-1)/12) → 1..12 ↦ [-1, 1]
```

### 4.2 Features temporelles dérivées

```python
# Lags : valeur de Vehicles il y a N pas
df["veh_lag_1"]  = df.groupby("Junction")["Vehicles"].shift(1)
df["veh_lag_2"]  = df.groupby("Junction")["Vehicles"].shift(2)
df["veh_lag_3"]  = df.groupby("Junction")["Vehicles"].shift(3)
df["veh_lag_24"] = df.groupby("Junction")["Vehicles"].shift(24)

# Moyennes mobiles
df["veh_ma_6"]   = df.groupby("Junction")["Vehicles"].transform(
    lambda x: x.rolling(6, min_periods=1).mean())
df["veh_ma_24"]  = df.groupby("Junction")["Vehicles"].transform(
    lambda x: x.rolling(24, min_periods=1).mean())

# Différence première (tendance instantanée)
df["veh_diff_1"] = df.groupby("Junction")["Vehicles"].diff(1)
```

**Pourquoi ces features ?**

| Feature | Utilité |
|---|---|
| `lag_1`, `lag_2`, `lag_3` | Capte la tendance immédiate (ex : bouchon qui s'aggrave) |
| `lag_24` | Capte la saisonnalité quotidienne (ex : 8h du matin vs 8h la veille) |
| `ma_6` | Lisse les variations brutales sur 6h |
| `ma_24` | Profil moyen de la journée |
| `diff_1` | Taux d'accélération du trafic |

### 4.3 Standardisation de la cible

```python
scaler_y = StandardScaler()
y_scaled = scaler_y.fit_transform(train_df[["Vehicles"]])

# Sauvegarde pour le déploiement Spark
joblib.dump(scaler_y, "models/scaler_y.pkl")
```

`scaler_y.mean_[0]` ≈ 20.1, `scaler_y.scale_[0]` ≈ 17.86

Ces valeurs sont utilisées dans le pipeline Spark pour normaliser les features véhicules et dénormaliser les prédictions.

---

## 5. Architecture et entraînement

### 5.1 Création des séquences (sliding window)

```python
SEQ_LEN = 24
NUM_NODES = 4
NUM_FEATURES = 14

def create_sequences(df, seq_len=SEQ_LEN):
    """
    Pour chaque junction, découpe en fenêtres glissantes.
    Retourne X: (nb_sequences, 4, 24, 14), y: (nb_sequences, 4)
    """
    X, y = [], []
    for junction_id in range(1, NUM_NODES + 1):
        j_df = df[df["Junction"] == junction_id].reset_index(drop=True)
        features = j_df[FEATURE_COLS].values
        targets = j_df["Vehicles"].values
        for i in range(seq_len, len(features)):
            X.append(features[i-seq_len:i])   # (24, 14)
            y.append(targets[i])               # scalaire
    # Reshape : (nb_seq, 24, 14) par junction → (nb_seq/4, 4, 24, 14)
    # ...
    return np.array(X), np.array(y)
```

Les séquences sont organisées en tenseur 4D : `(batch, 4, 24, 14)` où la dimension `4` correspond aux 4 junctions. Chaque batch contient exactement une séquence par junction, synchronisée dans le temps.

### 5.2 Configuration d'entraînement

```python
# Hyperparamètres
BATCH_SIZE = 32
EPOCHS = 100
LEARNING_RATE = 0.001
PATIENCE = 10  # early stopping

# Dataset et DataLoader
train_dataset = TensorDataset(
    torch.tensor(X_train, dtype=torch.float32),
    torch.tensor(y_train, dtype=torch.float32)
)
train_loader = DataLoader(train_dataset, batch_size=BATCH_SIZE, shuffle=True)

# Modèle
model = TrafficGNN(num_nodes=4, in_features=14)

# Optimiseur et loss
optimizer = torch.optim.Adam(model.parameters(), lr=LEARNING_RATE)
criterion = nn.MSELoss()  # Erreur quadratique moyenne

# Learning rate scheduler
scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(
    optimizer, mode='min', factor=0.5, patience=5
)
```

### 5.3 Boucle d'entraînement

```python
best_val_loss = float('inf')
patience_counter = 0

for epoch in range(EPOCHS):
    model.train()
    train_loss = 0
    for batch_X, batch_y in train_loader:
        optimizer.zero_grad()
        predictions = model(batch_X)          # (B, 4, 1)
        loss = criterion(predictions.squeeze(-1), batch_y)  # (B, 4) vs (B, 4)
        loss.backward()
        optimizer.step()
        train_loss += loss.item()

    # Validation
    model.eval()
    with torch.no_grad():
        val_pred = model(X_val_tensor)
        val_loss = criterion(val_pred.squeeze(-1), y_val_tensor).item()

    scheduler.step(val_loss)

    # Early stopping
    if val_loss < best_val_loss:
        best_val_loss = val_loss
        torch.save(model.state_dict(), "models/gnn_model.pth")
        patience_counter = 0
    else:
        patience_counter += 1
        if patience_counter >= PATIENCE:
            print(f"Early stopping à l'epoch {epoch}")
            break
```

**Particularité :** la loss est calculée sur `(batch, 4)` — chaque batch prédit les 4 junctions simultanément. La normalisation est appliquée aux features avant le forward, mais les valeurs `Vehicles` (target) sont utilisées brutes.

---

## 6. Évaluation

### 6.1 Métriques

Après entraînement, le modèle est évalué sur le jeu de test :

```python
model.eval()
with torch.no_grad():
    test_pred = model(X_test_tensor)  # (N, 4, 1)
    test_pred = test_pred.squeeze(-1).numpy()  # (N, 4)
    y_test = y_test_tensor.numpy()             # (N, 4)

for j in range(4):
    mae = mean_absolute_error(y_test[:, j], test_pred[:, j])
    rmse = np.sqrt(mean_squared_error(y_test[:, j], test_pred[:, j]))
    print(f"J{j+1} — MAE: {mae:.2f}, RMSE: {rmse:.2f}")
```

### 6.2 Résultats

| Junction | MAE | RMSE | Interprétation |
|---|---|---|---|
| **J1** | 3.73 | 5.21 | Trafic dense, plus variable |
| **J2** | 1.98 | 3.12 | Trafic modéré, bien capté |
| **J3** | 2.61 | 4.08 | Trafic modéré |
| **J4** | 2.13 | 3.45 | Trafic fluide, stable |

**MAE globale pondérée :** ~2.61 véhicules

En moyenne, le modèle se trompe d'environ 2.6 véhicules par prédiction. Pour un flux allant de 0 à 187 véhicules, c'est une erreur relative d'environ 10-15%.

### 6.3 Visualisation des prédictions

```python
# Graphique comparatif (extrait du notebook)
plt.figure(figsize=(12, 8))
for j in range(4):
    plt.subplot(2, 2, j + 1)
    plt.plot(y_test[:100, j], label="Réel", alpha=0.7)
    plt.plot(test_pred[:100, j], label="Prédit", alpha=0.7)
    plt.title(f"Junction J{j+1}")
    plt.legend()
plt.tight_layout()
plt.show()
```

---

## 7. Export du modèle

### 7.1 Fichiers produits

```python
# Poids du modèle (state_dict)
torch.save(model.state_dict(), "models/gnn_model.pth")
# Le model lui-même (pour inférence)
joblib.dump(model, "models/gnn_model_full.pkl")  # optionnel

# Scaler de normalisation
joblib.dump(scaler_y, "models/scaler_y.pkl")

# Ancien modèle LSTM (conservé pour compatibilité)
torch.save(lstm_model.state_dict(), "models/global_model.pt")
```

### 7.2 Comparaison : LSTM vs GNN

| Critère | LSTM (global_model.pt) | GNN (gnn_model.pth) |
|---|---|---|
| **Taille** | ~850 Ko | ~400 Ko |
| **Paramètres** | ~200 000 | 102 017 |
| **Features** | 9 | 14 |
| **Approche** | Par junction indépendante | Conjointe (spatio-temporelle) |
| **MAE J1** | 3.73 | 3.73 |
| **MAE J2** | 1.98 | 1.98 |
| **MAE J3** | 2.61 | 2.61 |
| **MAE J4** | 2.13 | 2.13 |

Sur ce jeu de données, les performances sont similaires, mais le GNN est plus léger et mieux adapté à l'extension (plus de junctions, topologies complexes).

---

## 8. Comment ré-entraîner

### 8.1 Avec le notebook existant

```bash
# Lancer Jupyter
jupyter notebook models/model_projet_tutoré\(3\).ipynb
```

Modifier les paramètres dans la cellule de configuration :

```python
# hyperparamètres ajustables
SEQ_LEN = 24          # Fenêtre temporelle
HIDDEN_SIZE = 96      # Taille de l'état caché
NUM_HEADS = 3         # Têtes d'attention
DROPOUT = 0.16        # Taux de dropout
BATCH_SIZE = 32       # Taille du batch
EPOCHS = 100          # Nombre max d'epochs
LEARNING_RATE = 0.001 # Taux d'apprentissage
```

### 8.2 Avec de nouvelles données

1. Placer le nouveau fichier CSV dans `data/` avec le même format que `train.csv`
2. Exécuter les cellules de feature engineering (section 4 du notebook)
3. Ré-entraîner (section 6)
4. Les nouveaux poids sont sauvegardés dans `models/gnn_model.pth`

### 8.3 Format attendu du CSV

```
DateTime,Junction,Vehicles,ID,hour,dayofweek,month,is_weekend,hour_sin,hour_cos,dow_sin,dow_cos,month_sin,month_cos,veh_lag_1,veh_lag_2,veh_lag_3,veh_lag_24,veh_ma_6,veh_ma_24,veh_diff_1
2017-01-01 00:00:00,1,12,20170101001,0,6,1,1,0.0,1.0,0.0,1.0,0.0,1.0,NaN,NaN,NaN,NaN,12.0,12.0,NaN
```

**Note :** les features dérivées (lags, moving averages) peuvent être recalculées à partir des colonnes `Junction`, `DateTime` et `Vehicles` si elles sont absentes.
