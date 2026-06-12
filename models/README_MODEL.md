
# 🚦 Traffic Flow Prediction - Multi-Paradigm LSTM

Ce dépôt contient des modèles de Deep Learning (PyTorch) conçus pour la prédiction du flux de trafic routier. 
Le projet compare deux approches : un **Modèle Global** (entraîné sur toutes les jonctions) et des **Modèles Spécifiques** (un par jonction).

## 🏗️ Architecture du Modèle
Le modèle utilise une architecture **LSTM (Long Short-Term Memory)** optimisée :
- **Input Layer**: 9 features (temporelles + historiques).
- **LSTM Layers**: 2 couches superposées avec un `hidden_size` de 128.
- **Regularization**: Dropout (0.3) et **Batch Normalization** après le LSTM pour stabiliser l'apprentissage.
- **Output Layer**: Couche dense (Linear) pour la prédiction scalaire du nombre de véhicules.

## 📊 Variables d'Entrée (Input Features)
Le modèle a été entraîné avec un encodage cyclique pour capturer la périodicité du trafic :
1. `hour_sin` / `hour_cos` : Heure de la journée (0-23).
2. `dayofweek` : Jour de la semaine (Lundi-Dimanche).
3. `month` : Mois de l'année.
4. `is_weekend` : Flag binaire (0 ou 1).
5. `veh_lag_1`, `2`, `3`, `24` : Historique du trafic à T-1h, T-2h, T-3h et T-24h.

## 🚀 Utilisation avec FastAPI / Spark Streaming
Le format `.pt` est prêt pour `TorchScript` ou un chargement direct dans un backend Python.

```python
import torch
model = TrafficLSTM(input_size=9) # Classe définie dans l'app
model.load_state_dict(torch.load('global_model.pt'))
model.eval()
```

## 📈 Performances (MAE)
| Jonction | Modèle Global (P1) | Modèle Spécifique (P2) |
|----------|-------------------|------------------------|
| J1       | 3.73 | 5.09 |
| J2       | 1.98 | 2.98 |
| J3       | 2.61 | 3.65 |
| J4       | 2.13 | 2.13 |

**Note :** Le modèle Global surpasse souvent les modèles spécifiques grâce à la généralisation des patterns de trafic entre jonctions.

## 📁 Structure du Repo
- `global_model.pt` : Le modèle principal prêt à l'emploi.
- `specific_junctions/` : Modèles spécialisés pour des comportements atypiques de certaines routes.

---
**Contact**: jojonocode | **Frameworks**: PyTorch, Sklearn, HuggingFace Hub
