# 🧠 TrafficGNN Documentation du Modèle

## Table des matières

1. [Présentation](#1-présentation)
2. [Architecture du modèle](#2-architecture-du-modèle)
3. [Entrées et sorties](#3-entrées-et-sorties)
4. [Forward pass détaillée](#4-forward-pass-détaillée)
5. [Prétraitement et normalisation](#5-prétraitement-et-normalisation)
6. [Entraînement](#6-entraînement)
7. [Fichiers et poids](#7-fichiers-et-poids)
8. [Utilisation dans Spark](#8-utilisation-dans-spark)
9. [Annexe : L'architecture GCN](#9-annexe--larchitecture-gcn)

---

## 1. Présentation

**TrafficGNN** est un réseau de neurones **spatio-temporel** conçu pour prédire le flux de véhicules sur un réseau de 4 junctions routières. Il combine :

- **LSTM** pour capturer les dépendances temporelles (24 pas d'historique)
- **GCN (Graph Convolutional Network)** pour propager l'information entre junctions voisines
- **Multi-head Self-Attention** pour pondérer dynamiquement l'influence entre junctions
- **MLP** pour la régression finale (prédiction du nombre de véhicules)

```
Architecture résumée :

[14 features × 24 pas]  →  LSTM(14→96)  →  GCN  →  Self-Attention  →  MLP(96→32→1)  →  [1 prédiction]
   (4 junctions)               (séquence)      (spatial)    (inter-junction)        (régression)
```

---

## 2. Architecture du modèle

### 2.1 Code complet

```python
class TrafficGNN(nn.Module):
    def __init__(self, num_nodes=4, in_features=14,
                 hidden_size=96, seq_len=24,
                 num_heads=3, dropout=0.16):
        super().__init__()
        self.num_nodes = num_nodes
        self.hidden_size = hidden_size

        # ─── Encodeur LSTM par nœud ───────────────
        self.node_encoder = nn.LSTM(
            input_size=in_features,    # 14
            hidden_size=hidden_size,   # 96
            num_layers=1,
            batch_first=True,
        )

        # ─── Propagation spatiale GCN ─────────────
        self.gcn_proj = nn.Linear(hidden_size, hidden_size)
        self.gcn_self = nn.Linear(hidden_size, hidden_size)

        # ─── Attention multi-tête ──────────────────
        self.attention = nn.MultiheadAttention(
            embed_dim=hidden_size,     # 96
            num_heads=num_heads,       # 3
            batch_first=True,
            dropout=dropout,
        )

        # ─── MLP decodeur ──────────────────────────
        self.decoder = nn.Sequential(
            nn.Linear(hidden_size, 32),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(32, 1),
        )
```

### 2.2 Blocs constitutifs

| Bloc | Rôle | Détails |
|---|---|---|
| **LSTM encoder** | Extrait les motifs temporels de chaque junction | 1 couche, hidden=96, entrée séquence de 24 pas |
| **GCN** | Propage l'information entre les junctions | Agrégation normalisée du graphe complet + self-loop via `gcn_self` |
| **Multi-head Attention** | Pondère l'influence inter-junctions | 3 têtes, permet à une junction d'« écouter » les autres |
| **MLP decoder** | Produit la prédiction scalaire finale | 96 → 32 → 1 avec ReLU et Dropout |

---

## 3. Entrées et sorties

### 3.1 Dimensions des tenseurs

| Tenseur | Forme | Description |
|---|---|---|
| Input | `(batch, 4, 24, 14)` | 4 junctions, 24 pas temporels, 14 features |
| Hidden LSTM | `(batch, 4, 96)` | Embedding de chaque junction après LSTM |
| GCN out | `(batch, 4, 96)` | Embedding après propagation spatiale |
| Attention out | `(batch, 4, 96)` | Embedding après pondération inter-junctions |
| **Output** | `(batch, 4, 1)` | **Prédiction finale : 1 valeur par junction** |

### 3.2 Les 14 features d'entrée

Le modèle reçoit 14 variables pré-calculées pour chaque pas de temps :

```python
FEATURE_COLS = [
    # Encodages cycliques (6)
    "hour_sin", "hour_cos",           # Heure (0-23) → cercle trigonométrique
    "dow_sin", "dow_cos",             # Jour de la semaine (0-6) → cercle
    "month_sin", "month_cos",         # Mois (1-12) → cercle

    # Binaires (1)
    "is_weekend",                      # 1 si samedi/dimanche

    # Statistiques dérivées des véhicules (7)
    "veh_lag_1", "veh_lag_2",         # Valeur il y a 1h et 2h
    "veh_lag_3", "veh_lag_24",        # Valeur il y a 3h et 24h
    "veh_ma_6", "veh_ma_24",          # Moyenne mobile sur 6h et 24h
    "veh_diff_1",                      # Différence avec le pas précédent
]
```

**Pourquoi 14 features ?** L'analyse des données a montré que ces 14 variables capturent le maximum d'information pour la prédiction : saisonnalité quotidienne (`hour_sin/cos`), hebdomadaire (`dow_sin/cos`), annuelle (`month_sin/cos`), pattern week-end, et historique récent.

### 3.3 Exemple de prédiction

```python
# Forward pass
x = torch.randn(1, 4, 24, 14)   # batch=1, 4 junctions, 24 pas, 14 features
out = model(x)                    # (1, 4, 1)

# Résultat dénormalisé
# J1: 38.5 véhicules
# J2: 12.3 véhicules
# J3: 25.7 véhicules
# J4: 8.1 véhicules
```

---

## 4. Forward pass détaillée

### Étape 1 : Encodage LSTM par nœud

Chaque junction est traitée indépendamment par un LSTM.

```python
# x shape: (B, N, T, F) = (batch, 4, 24, 14)
B, N, T, F = x.shape

# Reformater : (B*N, T, F) → chaque séquence traitée individuellement
x_lstm = x.view(B * N, T, F)           # (B*4, 24, 14)
lstm_out, (h_n, _) = self.node_encoder(x_lstm)

# On prend l'état caché final comme embedding du nœud
node_emb = h_n[-1]                      # (B*4, 96)
node_emb = node_emb.view(B, N, -1)     # (B, 4, 96)
```

### Étape 2 : GCN Propagation spatiale

Les embeddings sont propagés entre les junctions via le graphe routier.

```python
# Adjacence normalisée (4×4) : graphe complet sans self-loops
# A_hat = D^(-1/2) @ A @ D^(-1/2)
adj = self._build_adjacency(N, device=x.device)

# Agrégation des voisins : A @ node_emb
agg = torch.matmul(adj.unsqueeze(0), node_emb)   # (B, 4, 96)

# Projection + self-loop séparé (comme GCNConv)
gcn_out = torch.relu(
    self.gcn_proj(agg) + self.gcn_self(node_emb)  # (B, 4, 96)
)

# Connexion résiduelle
node_emb = node_emb + gcn_out
```

**Pourquoi self-loop séparé ?** Dans l'architecture, `gcn_self` joue le rôle des self-loops dans GCNConv, mais avec une projection linéaire apprise distincte. Cela permet au modèle de pondérer différemment l'information de la junction elle-même vs celle de ses voisines.

### Étape 3 : Multi-head Self-Attention

Les junctions « communiquent » entre elles via un mécanisme d'attention.

```python
# Query, Key, Value = same node_emb (self-attention)
attn_out, _ = self.attention(node_emb, node_emb, node_emb)  # (B, 4, 96)
attn_out = node_emb + attn_out   # résiduelle
```

Avec 3 têtes d'attention, chaque junction peut apprendre à :
- S'ignorer si les autres junctions n'apportent pas d'info
- Se concentrer sur une junction voisine en particulier
- Pondérer différemment selon le moment de la journée

### Étape 4 : MLP Decoder

Prédiction scalaire finale pour chaque junction.

```python
pred = self.decoder(attn_out)   # (B, 4, 96) → (B, 4, 1)
return pred
```

---

## 5. Prétraitement et normalisation

### 5.1 Fenêtrage temporel

Dans le pipeline Spark, les données sont bufferisées par junction :

```python
from collections import deque

feat_window = defaultdict(lambda: deque(maxlen=24))
```

Chaque ligne Kafka qui arrive est convertie en vecteur 14D et ajoutée au buffer de sa junction. La prédiction n'est déclenchée que quand les 4 junctions ont 24 pas dans leur buffer.

### 5.2 Normalisation

Seules les features liées aux véhicules (indices 7 à 13) sont normalisées :

```python
# indices 7:14 = veh_lag_1, veh_lag_2, veh_lag_3, veh_lag_24,
#                veh_ma_6, veh_ma_24, veh_diff_1
sequences[:, :, 7:14] = (sequences[:, :, 7:14] - mean_y) / std_y
```

Les features cycliques (`hour_sin/cos`, etc.) sont déjà normalisées par construction (entre -1 et 1).

**Pourquoi normaliser seulement les features véhicules ?** Les encodages cycliques (sin/cos) sont déjà dans [-1, 1]. Les lags et moyennes mobiles sont dans la même échelle que `Vehicles` (0-200), donc un seul scaler (`scaler_y`) suffit.

### 5.3 Dénormalisation des prédictions

```python
unscaled = raw_val * std_y + mean_y
pred = max(0.0, round(unscaled, 2))
```

Le `max(0.0, ...)` garantit qu'on ne prédit jamais un nombre négatif de véhicules.

---

## 6. Entraînement

### 6.1 Configuration

| Hyperparamètre | Valeur |
|---|---|
| Sequence length | 24 pas |
| Feature dimension | 14 |
| Hidden size | 96 |
| Attention heads | 3 |
| Dropout | 0.16 |
| Optimizer | Adam |
| Learning rate | 0.001 (défaut Adam) |
| Loss | MSELoss (erreur quadratique) |
| Batch size | 32 |
| Early stopping | Patience de 10 epochs |

### 6.2 Données d'entraînement

| Jeu | Lignes | Source |
|---|---|---|
| **Entraînement** | ~38 000 | `data/train.csv` (4 junctions mélangées) |
| **Test** | ~10 000 | `data/test_gnn.csv` (rejoué par le Simulateur) |
| **Split** | 80/20 par junction | Séparation temporelle (pas aléatoire) |

### 6.3 Augmentation des données

Les données originales contiennent les colonnes brutes (`hour`, `dayofweek`, `month`, `Vehicles`). Les 14 features sont pré-calculées dans le CSV :

```python
# Exemple de calcul dans le notebook
df["hour_sin"] = np.sin(2 * np.pi * df["hour"] / 24)
df["hour_cos"] = np.cos(2 * np.pi * df["hour"] / 24)
df["dow_sin"] = np.sin(2 * np.pi * df["dayofweek"] / 7)
df["dow_cos"] = np.cos(2 * np.pi * df["dayofweek"] / 7)
df["month_sin"] = np.sin(2 * np.pi * (df["month"] - 1) / 12)
df["month_cos"] = np.cos(2 * np.pi * (df["month"] - 1) / 12)
df["veh_lag_1"] = df.groupby("Junction")["Vehicles"].shift(1)
df["veh_lag_2"] = df.groupby("Junction")["Vehicles"].shift(2)
# ... etc
```

### 6.4 Matrice d'adjacence

Le graphe utilisé pendant l'entraînement est un **graphe complet** (fully-connected) sans self-loops :

```python
A = [[0, 1, 1, 1],
     [1, 0, 1, 1],
     [1, 1, 0, 1],
     [1, 1, 1, 0]]
```

Normalisé symétriquement : `A_hat = D^(-1/2) @ A @ D^(-1/2)`

Le choix du graphe complet permet au modèle d'apprendre lui-même quelles relations entre junctions sont importantes via l'attention multi-tête, plutôt que d'imposer une topologie fixe.

---

## 7. Fichiers et poids

### 7.1 Modèle entraîné

| Fichier | Description | Taille |
|---|---|---|
| `models/gnn_model.pth` | Poids du TrafficGNN entraîné | ~400 Ko |
| `models/scaler_y.pkl` | StandardScaler pour la cible (mean=20.1, std=17.86) | ~1 Ko |

L'ancien modèle LSTM (`global_model.pt`, 850 Ko) est conservé mais n'est plus utilisé.

### 7.2 Comptage des paramètres

```
TrafficGNN(
  102,017 paramètres
)
```

Répartition :
- LSTM encoder : `4 × (input_size×hidden + hidden² + hidden×2)` = ~78 000
- GCN projections (proj + self) : `2 × 96 × 96` = 18 432
- Attention : `3 × (96² + 96²)` = ~55 000 (mais partiellement partagé avec les projections)
- MLP decoder : `96×32 + 32 + 32×1 + 1` = 3 137

### 7.3 Chargement

```python
from traffic_gnn import TrafficGNN

model = TrafficGNN(num_nodes=4, in_features=14)
model.load_pretrained("models/gnn_model.pth")
model.eval()
```

---

## 8. Utilisation dans Spark

### 8.1 Pipeline complet

```python
# 1. Chargement du modèle (au démarrage du job Spark)
device = torch.device("cpu")
model = TrafficGNN(num_nodes=4, in_features=14)
model.load_pretrained(MODEL_PATH, map_location=device)

# 2. Chargement du scaler (pour dénormalisation)
scaler_y = joblib.load(SCALER_Y_PATH)
mean_y = scaler_y.mean_[0]
std_y = scaler_y.scale_[0]

# 3. Dans le callback foreachBatch :
def process_microbatch(batch_df, batch_id):
    rows = batch_df.collect()
    for row in rows:
        row_dict = row.asDict()
        jid = row_dict.get("Junction")
        # Bufferisation
        feat_window[jid].append(extract_14_features(row_dict))
        latest_row[jid] = row_dict

    # Inférence quand 24 pas sont disponibles
    predictions = predict_all_junctions()
    if predictions:
        for jid, pred in predictions.items():
            producer.send(TOPIC_OUTPUT, value=payload)
```

### 8.2 Gestion des cas limites

| Cas | Action |
|---|---|
| Junction inconnue (`Junction > 4`) | Ignorée (continue) |
| Buffer pas assez rempli (< 24 pas) | `predict_all_junctions()` retourne `None` |
| Prédiction négative | Clamp à 0.0 via `max(0.0, ...)` |
| Scaler manquant | Utilise les valeurs par défaut (mean=20.09, std=17.86) |
| Kafka injoignable | Boucle de retry dans `build_kafka_producer()` |

---

## 9. Annexe : L'architecture GCN

### 9.1 Principe du GCN (Graph Convolutional Network)

Un GCN propage l'information entre les nœuds d'un graphe en agrégeant les caractéristiques des voisins :

```
h_i^(l+1) = σ( W * (1/d_i) * Σ_j∈N(i) h_j^l + b )
```

Où :
- `h_i^l` : embedding du nœud i à la couche l
- `N(i)` : voisins du nœud i
- `d_i` : degré du nœud i (normalisation)
- `W`, `b` : poids appris

### 9.2 Dans TrafficGNN

Notre GCN est simplifié mais équivalent :

```python
# Agrégation normalisée
agg = A_hat @ node_emb   # A_hat = D^(-1/2) A D^(-1/2)

# Projection + activation
gcn_out = ReLU(W_proj @ agg + W_self @ node_emb + b)
```

La différence avec GCNConv standard est la séparation explicite entre `W_proj` (voisins) et `W_self` (self-loop), ce qui donne plus de flexibilité au modèle.

### 9.3 Pourquoi GNN plutôt que LSTM seul ?

| Approche | Avantage | Limite |
|---|---|---|
| **LSTM seul** | Capture bien les séquences temporelles | Ignore les relations spatiales entre junctions |
| **GNN seul** | Modélise les dépendances spatiales | Ignore la temporalité |
| **TrafficGNN (LSTM + GCN + Attn)** | Combine temporalité ET spatialité, pondération dynamique | Plus de paramètres |

En pratique, le GNN permet à J1 de bénéficier de l'information de trafic de J2, J3, J4 — ce qu'un LSTM par junction ne peut pas faire.

---

## Performances

| Junction | MAE (véhicules) |
|---|---|
| **J1** | 3.73 |
| **J2** | 1.98 |
| **J3** | 2.61 |
| **J4** | 2.13 |

Le modèle global (un seul modèle pour toutes les junctions) surpasse les modèles spécifiques grâce au partage d'information entre junctions via le GCN et l'attention.
