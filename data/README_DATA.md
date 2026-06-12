---
language: fr
license: cc-by-4.0
task_categories:
- time-series-forecasting
tags:
- smart-city
- transport
- traffic-flow
- deep-learning
- lstm
pretty_name: Traffic Prediction Engineered Dataset
---

# 🚦 Prédiction du Trafic Urbain : Dataset Card

Bienvenue ! Ce dataset n'est pas qu'une simple suite de chiffres ; c'est une vue numérique du pouls de notre ville. Il a été conçu pour entraîner des modèles capables de comprendre le rythme des déplacements urbains sur 4 jonctions clés.

## 💡 Pourquoi ce Dataset est unique ?

Passer des données brutes à l'intelligence nécessite du soin. Nous avons transformé les colonnes classiques en **features intelligentes** pour aider les réseaux de neurones (LSTM) à mieux "voir" le temps.

### 🧠 Le Feature Engineering : Le secret de la précision

#### 1. La perception du temps cyclique (Sin/Cos)
Les machines voient souvent l'heure 23 et l'heure 0 comme les deux points les plus éloignés. Pour un humain, c'est presque le même moment (minuit). 
**Notre solution :** Nous projetons l'heure sur un cercle trigonométrique.
```python
# Donner au modèle la notion de cycle
df['hour_sin'] = np.sin(2 * np.pi * df['hour']/24.0)
df['hour_cos'] = np.cos(2 * np.pi * df['hour']/24.0)
```

#### 2. L'effet miroir du passé (Lags)
- `veh_lag_1, 2, 3` : Capturent la tendance immédiate.
- `veh_lag_24` : Capture la routine quotidienne.

## 📂 Contenu du coffret

| Fichier | Utilité |
| :--- | :--- |
| `traffic_original.csv` | La source brute. |
| `traffic_engineered_full.csv` | La version prête pour l'IA. |
| `splits/train.csv` | 80% des données pour l'apprentissage. |
| `splits/test.csv` | 20% des données pour la validation. |


