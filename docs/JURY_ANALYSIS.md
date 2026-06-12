# 🎓 Analyse de Projet Tutoré — Road Flow

## Préparation pour la soutenance

---

## Table des Matières

1. [Présentation Générale du Projet](#1-présentation-générale-du-projet)
2. [Architecture Globale](#2-architecture-globale)
3. [Pipeline Big Data](#3-pipeline-big-data)
4. [Modèle GNN — Notebook et Entraînement](#4-modèle-gnn--notebook-et-entraînement)
5. [Backend FastAPI](#5-backend-fastapi)
6. [Frontend et Cartographie](#6-frontend-et-cartographie)
7. [Infrastructure Docker](#7-infrastructure-docker)
8. [Questions/Réponses Potentielles du Jury](#8-questionsréponses-potentielles-du-jury)
9. [Points Forts et Limites](#9-points-forts-et-limites)
10. [Glossaire Technique](#10-glossaire-technique)

---

## 1. Présentation Générale du Projet

### 1.1 Qu'est-ce que Road Flow ?

**Road Flow** est un système de **prédiction de trafic routier en temps réel** qui combine :

- Un **réseau de neurones Graph Neural Network (GNN)** pour la prédiction
- **Apache Kafka** comme bus de données distribué
- **PySpark Structured Streaming** pour le traitement temps réel
- Une **API FastAPI** avec WebSocket pour la diffusion
- Un **dashboard 3D interactif** avec MapLibre GL et Three.js

### 1.2 Problématique

Comment prédire le flux de véhicules à une intersection urbaine en utilisant :
- Les données historiques de trafic (csv)
- Les corrélations spatiales entre intersections voisines
- Les patterns temporels (heure de la journée, jour de la semaine, saison)
- Le tout en **temps réel** avec une latence < 500ms

### 1.3 Approche retenue

```
Données brutes CSV
    │
    ├── Feature engineering (14 features temps réel)
    │     ├── Encodages cycliques (hour_sin/cos, dow_sin/cos, month_sin/cos)
    │     ├── Lags temporels (t-1, t-2, t-3, t-24)
    │     ├── Moyennes mobiles (6h, 24h)
    │     └── Différence première
    │
    ├── Modèle : TrafficGNN (LSTM + GCN + Attention)
    │     ├── LSTM : capture les séquences temporelles
    │     ├── GCN : propage l'information entre junctions
    │     └── Attention : pondère dynamiquement l'influence
    │
    └── Pipeline temps réel (Kappa Architecture)
          ├── Kafka : ingestion et distribution
          ├── Spark : inférence streaming
          └── WebSocket : diffusion aux clients
```

---

## 2. Architecture Globale

### 2.1 Diagramme d'architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         ARCHITECTURE ROAD FLOW                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────┐    ┌────────────────┐    ┌────────────────────────┐      │
│  │  Simulateur  │───▶│  Kafka Broker  │───▶│ Spark (GNN Inference)  │      │
│  │  CSV → JSON  │    │ flux_data      │    │ foreachBatch → GNN     │      │
│  │  producteur  │    │ topic          │    │ → producteur Kafka    │      │
│  └──────────────┘    └───────┬────────┘    └────────────────────────┘      │
│                              │                        │                     │
│                              │                        ▼                     │
│                              │               ┌────────────────┐            │
│                              │               │  Kafka Topic   │            │
│                              │               │ traffic_preds  │            │
│                              │               └────────┬───────┘            │
│                              │                        │                     │
│                              ▼                        ▼                     │
│                    ┌─────────────────────────────────────────┐             │
│                    │         FastAPI Gateway                 │             │
│                    │  - Kafka consumer (thread)              │             │
│                    │  - asyncio.Queue (bridge thread→async)  │             │
│                    │  - broadcast_worker (WebSocket push)    │             │
│                    │  - current_state + history (RAM)        │             │
│                    └─────────────────┬───────────────────────┘             │
│                                      │                                     │
│                        WebSocket (JSON)                                     │
│                                      │                                     │
│                    ┌─────────────────▼───────────────────────┐             │
│                    │         Frontend Next.js 15             │             │
│                    │  - MapLibre GL (carte 2D)              │             │
│                    │  - Three.js (visualisation 3D)         │             │
│                    │  - WebSocket client (auto-reconnect)   │             │
│                    │  - Dijkstra routing (congestion)       │             │
│                    │  - Marqueurs animés (4 junctions)      │             │
│                    └─────────────────────────────────────────┘             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Flux de Données

```
[CSV] → Simulateur → Kafka[flux_data] → Spark/GNN → Kafka[predictions]
                                                          ↓
Frontend ← WebSocket ← FastAPI (asyncio.Queue ← Thread consumer)
```

### 2.3 Stack Technique

| Couche | Technologie | Justification |
|---|---|---|
| **ML** | PyTorch + PyTorch Geometric | Flexibilité des GNN, écosystème mature |
| **Streaming** | Apache Kafka 3.8 (KRaft) | Découplage producteur/consommateur, persistance |
| **Processing** | PySpark 3.5 Structured Streaming | Micro-batching, tolérance aux pannes |
| **API** | FastAPI + WebSocket | Async natif, performance, documentation auto |
| **Frontend** | Next.js 15 (App Router) | SSR + Client components hybrides |
| **Carte** | MapLibre GL | Open source, performant, compatible Three.js |
| **3D** | Three.js | WebGL, 60 FPS, prédéfini pour overlay carte |
| **Conteneurisation** | Docker + Docker Compose | Reproducibilité, déploiement 1-commande |

---

## 3. Pipeline Big Data

### 3.1 Pourquoi Kafka ?

Kafka est le **système nerveux** du projet. Il assure :

1. **Découplage total** entre producteurs (simulateur, Spark) et consommateurs (API)
2. **Persistance des données** : les messages sont stockés sur disque, rejouables
3. **Tolérance aux pannes** : si un service tombe, les messages l'attendent
4. **Scalabilité** : possibilité d'ajouter des consumers sans modification

**Deux topics :**

```
flux_data              traffic_predictions
├── Produit par        ├── Produit par
│   le Simulateur      │   Spark/GNN
├── Consommé par       ├── Consommé par
│   Spark/GNN          │   FastAPI
├── Format JSON        ├── Format JSON
│   14 features        │   {Vehicles, PredictedVehicles, Status}
```

**Question possible du jury :** *Pourquoi deux topics plutôt qu'un seul ?*

**Réponse :** Chaque topic a un producteur unique et un consommateur unique, ce qui permet :
- Une **séparation des responsabilités** : le simulateur ne connaît pas Spark
- Une **indépendance d'évolution** : on peut changer le format de `flux_data` sans impacter FastAPI
- Une **rejouabilité** : on peut ré-injecter `flux_data` pour tester un nouveau modèle

### 3.2 Pourquoi Spark plutôt que du Python pur ?

Le choix de PySpark Structured Streaming plutôt qu'un simple consommateur Kafka Python :

| Critère | Python pur | PySpark Streaming |
|---|---|---|
| Débit max | ~10 000 msg/s | ~100 000+ msg/s |
| Tolérance aux pannes | Manuelle (try/except) | Intégrée (checkpoint) |
| Fenêtrage | Implémentation custom | Window functions natives |
| Micro-batching | Manual | foreachBatch automatique |
| Scalabilité | Mono-process | Distribué (local[*] → cluster) |

**En pratique :** Le mode `local[*]` permet de développer et tester en local avant un éventuel déploiement Spark cluster.

### 3.3 Détail du processing Spark

```python
# 1. Lecture en continu du topic Kafka
df = spark.readStream \
    .format("kafka") \
    .option("kafka.bootstrap.servers", BOOTSTRAP_SERVER) \
    .option("subscribe", TOPIC_INPUT) \
    .load()

# 2. Parsing JSON avec schéma typé
json_df = df.select(
    from_json(col("value").cast("string"), input_schema).alias("data")
).select("data.*")

# 3. Pour chaque micro-batch, exécution de l'inférence GNN
query = json_df.writeStream \
    .foreachBatch(process_microbatch) \
    .start()
```

**Le callback `process_microbatch` :**
1. Reçoit le micro-batch (quelques lignes)
2. Extrait les features 14D par junction
3. Alimente les buffers `deque` (24 pas par junction)
4. Quand toutes les junctions ont 24 pas → inférence GNN
5. Publication des prédictions dans le topic de sortie

### 3.4 Gestion des états dans Spark

L'état (les buffers de 24 pas par junction) est stocké dans des **deques Python** :

```python
feat_window: dict[int, deque] = defaultdict(lambda: deque(maxlen=SEQ_LEN))
```

**Pourquoi pas un StateStore Spark ?** Les StateStores Spark sont complexes à mettre en place et le volume de données par microbatch est faible (~1 ligne/junction). Les deques Python sont plus simples et suffisants pour le prototype. Une version production utiliserait `mapGroupsWithState` ou `flatMapGroupsWithState`.

---

## 4. Modèle GNN — Notebook et Entraînement

### 4.1 Pourquoi un GNN plutôt qu'un LSTM seul ?

| Aspect | LSTM seul | TrafficGNN (LSTM + GCN + Attention) |
|---|---|---|
| **Temporalité** | ✅ Excellente | ✅ Excellente |
| **Spatialité** | ❌ Ignore les autres junctions | ✅ Propagation entre junctions |
| **Pondération dynamique** | ❌ | ✅ Attention multi-tête |
| **Paramètres** | ~200k | 102k (plus léger) |
| **Taille du modèle** | 850 Ko | 400 Ko |

**Exemple concret :** Si J1 est congestionné, le LSTM seul ne peut pas savoir que J3 l'est aussi. Le GNN, lui, propage l'information : la congestion de J1 influence la prédiction de J3 via le GCN.

### 4.2 Architecture détaillée

```
Input: (batch, 4, 24, 14)
  │
  ├── 1. LSTM Encoder (par nœud)
  │     x.view(B*N, 24, 14) → LSTM(14→96) → h_n (B*N, 96)
  │     → Reshape: (B, 4, 96)
  │     Chaque junction traite sa séquence indépendamment
  │
  ├── 2. GCN — Propagation Spatiale
  │     adj = D^(-1/2) @ A @ D^(-1/2)  (graphe complet normalisé)
  │     agg = adj @ node_emb            (moyenne des voisins)
  │     out = ReLU(W_proj @ agg + W_self @ node_emb)
  │     node_emb = node_emb + out       (résiduelle)
  │
  ├── 3. Multi-head Self-Attention
  │     3 têtes d'attention → pondération dynamique
  │     Chaque junction "regarde" les 3 autres
  │     attn_out = node_emb + attention(node_emb)
  │
  └── 4. MLP Decoder
        Linear(96→32) → ReLU → Dropout → Linear(32→1)
        → (B, 4, 1) — une prédiction par junction
```

### 4.3 Les 14 features

```python
FEATURE_COLS = [
    # Encodages cycliques (pour préserver la distance circulaire)
    "hour_sin", "hour_cos",     # 23h et 0h sont proches dans le cercle
    "dow_sin", "dow_cos",       # Lundi et Dimanche sont proches
    "month_sin", "month_cos",   # Déc et Jan sont proches

    # Binaire
    "is_weekend",               # Pattern week-end vs semaine

    # Lags temporels
    "veh_lag_1", "veh_lag_2", "veh_lag_3", "veh_lag_24",
    # Pourquoi lag_24 ? Capture la saisonnalité quotidienne

    # Moyennes mobiles
    "veh_ma_6", "veh_ma_24",   # Lissage des variations

    # Tendance
    "veh_diff_1",               # Accélération/décélération du trafic
]
```

**Question possible du jury :** *Pourquoi 14 features ? Avez-vous fait une sélection de features ?*

**Réponse :** Les 14 features sont le résultat d'une analyse de corrélation et de connaissance du domaine :
- Les 6 features cycliques sont nécessaires pour éviter la discontinuité minuit (23h → 0h)
- Les lags 1, 2, 3 capturent la tendance immédiate
- Le lag 24 capture la saisonnalité quotidienne (comparer à la veille à la même heure)
- Les moyennes mobiles lissent le bruit
- `veh_diff_1` donne la tendance instantanée (accélération)

### 4.4 Entraînement

| Hyperparamètre | Valeur | Justification |
|---|---|---|
| Sequence length | 24 pas | 24h de recul pour capturer un cycle complet |
| Hidden size | 96 | Bon compromis expressivité/paramètres |
| Attention heads | 3 | Divisible par 96, suffisant pour 4 nœuds |
| Dropout | 0.16 | Évite le sur-apprentissage |
| Batch size | 32 | Adapté à la mémoire disponible |
| Learning rate | 0.001 | Valeur standard Adam |
| Early stopping | 10 epochs | Évite le sur-apprentissage |

### 4.5 Performances

| Junction | MAE | RMSE | Interprétation |
|---|---|---|---|
| J1 — Gare du Nord | 3.73 | 5.21 | Trafic dense, plus difficile à prédire |
| J2 — Champs-Élysées | 1.98 | 3.12 | Trafic modéré, régulier |
| J3 — Place d'Italie | 2.61 | 4.08 | Trafic modéré |
| J4 — Bastille | 2.13 | 3.45 | Trafic fluide, stable |

**MAE globale :** ~2.61 véhicules

**Question possible du jury :** *Pourquoi J1 a-t-il une MAE plus élevée ?*

**Réponse :** J1 (Gare du Nord) a un trafic plus dense et plus variable (moyenne 35, max 187). Les variations y sont plus brusques (arrivées de trains, départs). Les junctions au trafic plus fluide (J4 : moyenne 8) ont des variations plus faibles, donc une MAE plus basse en valeur absolue.

### 4.6 Normalisation

```python
# Normalisation : seulement les features véhicules (indices 7:13)
sequences[:, :, 7:14] = (sequences[:, :, 7:14] - mean_y) / std_y
# mean_y = 20.1, std_y = 17.86

# Dénormalisation des prédictions
unscaled = raw_val * std_y + mean_y
pred = max(0.0, round(unscaled, 2))  # pas de véhicules négatifs
```

**Question possible du jury :** *Pourquoi ne normalisez-vous que 7 features sur 14 ?*

**Réponse :** Les features d'encodage cyclique (hour_sin/cos, dow_sin/cos, month_sin/cos) sont déjà normalisées par construction dans [-1, 1]. La normalisation n'est nécessaire que pour les features liées au nombre de véhicules (lags, moving averages, diff) qui sont sur une échelle plus large (0-200).

---

## 5. Backend FastAPI

### 5.1 Architecture du backend

```
Thread Principal (asyncio)          Thread Secondaire (Kafka)
──────────────────────────          ──────────────────────────
FastAPI event loop                 kafka_listener(loop)
  │                                       │
  │ broadcast_worker()                    │ for msg in consumer:
  │   while True:                         │   current_state[j] = data
  │     data = queue.get()                │   history[j].append(data)
  │     for ws in clients:                │   asyncio.run_coroutine_threadsafe(
  │       ws.send_json(data)              │     broadcast_queue.put(data), loop
  │                                       │   )
  │                                       │
  │ ┌─────────────────────┐              │
  │ │ broadcast_queue     │◀─────────────│
  │ │ (asyncio.Queue)     │              │
  │ └─────────────────────┘              │
  │                                       │
  │ ┌─────────────────────┐              │
  │ │ current_state       │◀─────────────│
  │ │ history (deque)     │              │
  │ └─────────────────────┘              │
```

### 5.2 Pourquoi asyncio ?

Le choix de FastAPI (asyncio) plutôt que Flask (synchrone) est justifié par :

1. **WebSocket natif** : FastAPI supporte les WebSockets sans extension
2. **Broadcast concurrent** : L'`asyncio.Queue` permet de distribuer les messages à N clients sans blocage
3. **Performance** : Uvicorn + FastAPI = l'un des frameworks Python les plus rapides

### 5.3 Bridge Thread → Asyncio

Le point technique le plus subtil : comment passer d'un thread Kafka (bloquant) à la boucle asyncio ?

```python
def kafka_listener(loop):
    consumer = build_kafka_consumer()
    for msg in consumer:                    # ← BOUCLE BLOQUANTE
        data = msg.value
        asyncio.run_coroutine_threadsafe(    # ← pont thread→async
            broadcast_queue.put(data), loop
        )
```

`socketThreadsafe` est la clé : elle permet d'ajouter un élément à une file asyncio depuis un thread non-asyncio, sans condition de course.

### 5.4 Endpoints

| Méthode | Path | Description | Wave |
|---|---|---|---|
| `GET` | `/` | Statut du service + connexions actives | État |
| `GET` | `/health` | Health check (utilisé par Docker) | Monitoring |
| `GET` | `/traffic/current` | Dernière prédiction par junction | REST |
| `GET` | `/traffic/history/{id}` | Historique d'une junction (2000 points) | REST |
| `WS` | `/ws/traffic` | Flux temps réel des prédictions | WebSocket |

---

## 6. Frontend et Cartographie

### 6.1 Structure du Frontend

```
TrafficDashboard (orchestrateur — WebSocket, état global)
  ├── Sidebar (métriques, cartes, sparklines, voiture 3D)
  │     └── ThreeCarVisualizer (voiture 3D Three.js)
  │
  ├── TrafficMap (MapLibre GL)
  │     ├── Marqueurs junctions (couleur par statut, animation)
  │     ├── Routes routières (GeoJSON, 3 couches de rendu)
  │     └── Popups (infos junction au clic)
  │
  ├── MapCarAnimator (voiture CSS animée sur la carte)
  │
  └── TimeSlider (filtre temporel 0-24h)
```

### 6.2 WebSocket avec reconnexion automatique

```typescript
useEffect(() => {
  const connect = () => {
    const ws = new WebSocket(`ws://localhost:8000/ws/traffic`);
    ws.onmessage = (event) => {
      const data: WsPayload = JSON.parse(event.data);
      // Mise à jour de la junction concernée
      setJunctions(prev => prev.map(j =>
        j.id === `J${data.Junction}`
          ? { ...j, currentFlow: data.Vehicles, ... }
          : j
      ));
    };
    ws.onclose = () => setTimeout(connect, 5000); // Reconnexion auto
    ws.onerror = () => ws.close(); // Nettoyage
  };
  connect();
}, []);
```

**Points techniques importants :**
- **Reconnexion automatique** toutes les 5 secondes
- **Gestion des erreurs** : fermeture propre du socket avant reconnexion
- **Pas de librairie externe** : WebSocket natif du navigateur

### 6.3 MapLibre GL — Configuration

```
Carte : MapLibre GL (react-map-gl/maplibre)
  ├── Fond de carte : CartoDB (dark-matter / positron)
  ├── Centre initial : Paris [2.3522, 48.8566]
  ├── Zoom initial : 12.5
  ├── Pitch max : 85° (permet les angles de vue 3D)
  │
  ├── Couches de routes (GeoJSON) :
  │    1. route-glow-outer : 14px, blur 10px, opacité 0.3
  │    2. route-glow-mid : 8px, blur 5px, opacité 0.45
  │    3. route-main : 3.5px, opacité 0.92
  │    4. route-flow : traits blancs animés (effet circulation)
  │
  └── Marqueurs junctions :
        - Cercle avec halo animé (échelle 1 → 2.2)
        - Couleur : émeraude / ambre / rouge selon statut
        - Label au survol
        - Animation pulsing (2.5s loop)
```

**Rendu 3 couches pour les routes :**
```typescript
// Effet de "glow" des routes — 3 couches superposées
'route-glow-outer' : { 'line-width': 14, 'line-blur': 10, 'line-opacity': 0.3 },
'route-glow-mid'   : { 'line-width': 8,  'line-blur': 5,  'line-opacity': 0.45 },
'route-main'       : { 'line-width': 3.5, 'line-blur': 0,  'line-opacity': 0.92 },
```

**Question possible du jury :** *Pourquoi un rendu en 3 couches plutôt qu'une seule ligne ?*

**Réponse :** L'effet de glow (halo lumineux) donne un aspect "high-tech" au dashboard et améliore la lisibilité des routes sur un fond de carte sombre. La superposition de 3 calques avec des niveaux de flou et d'opacité différents crée un rendu professionnel sans impact notable sur les performances (MapLibre optimise le rendu vectoriel).

### 6.4 Focus caméra sur une junction

L'interaction clé : **clic sur une junction → animation caméra vers la junction**.

```typescript
// TrafficMap.tsx
const BEARINGS: Record<string, number> = {
  J1: 45, J2: 120, J3: 210, J4: 300,
};

// Détection du changement de sélection (pas du re-rendu)
const prevSelectedRef = useRef<string | null>(null);

useEffect(() => {
  if (selectedJunction === prevSelectedRef.current) return;
  prevSelectedRef.current = selectedJunction;

  if (!selectedJunction || !mapRef.current) return;

  const meta = JUNCTION_META[selectedJunction];
  mapRef.current.flyTo({
    center: [meta.lng, meta.lat],
    zoom: 15.5,
    pitch: 58,         // Vue 3D plongeante
    bearing: BEARINGS[selectedJunction],
    duration: 2600,
    essential: true,    // Garantit l'exécution même en cas d'interaction
  });
}, [selectedJunction]);
```

**Détails techniques :**
- **Zoom 15.5** : vue rapprochée de la junction
- **Pitch 58°** : angle de vue 3D pour voir les routes en perspective
- **Bearing personnalisé** : chaque junction a un angle de vue différent pour des perspectives variées
- **`essential: true`** : empêche MapLibre d'annuler l'animation si l'utilisateur interagit
- **`duration: 2600ms`** : animation fluide de 2.6 secondes
- **`useRef`** pour détecter les vrais changements : évite les boucles infinies

**Question possible du jury :** *Pourquoi stocker la sélection précédente dans une ref plutôt que dans l'état ?*

**Réponse :** La ref (`prevSelectedRef`) permet de comparer la valeur actuelle AVANT le rendu, ce qui évite les re-déclenchements intempestifs. Si on utilisait l'état, chaque mise à jour des données de trafic (toutes les ~2s) provoquerait un nouveau `flyTo`, empêchant l'utilisateur d'interagir avec la carte. La ref agit comme un **verrou de comparaison**.

### 6.5 Marqueurs animés

```typescript
// Animation du halo — framer-motion
<motion.div
  animate={{
    scale: [1, 2.2, 1],
    opacity: [0.4, 0, 0.4],
  }}
  transition={{
    duration: 2.5,
    repeat: Infinity,
    ease: 'easeInOut',
  }}
/>
```

Le halo :
- S'étend de 1× à 2.2× en 2.5 secondes
- Devient transparent au milieu pour donner l'impression d'une "onde"
- Boucle à l'infini
- Couleur = statut du trafic (émeraude/ambre/rouge)

### 6.6 Routage Dijkstra avec poids dynamiques

```typescript
const findBestPath = (from, to, routes) => {
  const WEIGHTS = { fluid: 1.0, moderate: 3.0, congested: 8.0 };

  // Construction du graphe
  const graph: Record<string, [string, number][]> = {};
  for (const route of routes) {
    const w = WEIGHTS[route.status];
    graph[route.from].push([route.to, w]);
    graph[route.to].push([route.from, w]); // bidirectionnel
  }

  // Dijkstra standard
  const dist: Record<string, number> = {};
  const prev: Record<string, string | null> = {};
  const unvisited = new Set(Object.keys(graph));

  // ... algorithme classique de Dijkstra
};
```

**Question possible du jury :** *Pourquoi un poids de 8× pour congested ?*

**Réponse :** Les poids exponentiels (1×, 3×, 8×) créent une **dissuasion progressive**. Une route congestionnée est 8× moins attractive qu'une route fluide, ce qui pousse le routage à trouver des alternatives. Dans un petit graphe à 4 nœuds, cette pondération agressive garantit que l'algorithme évite les routes bloquées.

### 6.7 Voiture 3D — Two Visualizers

Le projet contient **deux systèmes de visualisation de voiture différents** :

| | MapCarAnimator | ThreeCarVisualizer |
|---|---|---|
| **Emplacement** | Sur la carte MapLibre | Dans le panneau latéral |
| **Technologie** | CSS/div | Three.js (WebGL) |
| **Animation** | Déplacement le long des routes | Rotation 360° sur place |
| **But** | Montrer le trajet optimal | Aperçu 3D statique |
| **Données** | Coordonnées GPS réelles | Aucune (procedural) |

**Voiture CSS (MapCarAnimator) :**
```
┌──────────────────────────┐
│  Pare-brise (verre)       │
│  ┌──────┬──────────┐     │
│  │ Toit │  Carrosserie    │
│  │ vitré│  métallisée     │
│  ├──┼──┤                │
│  │ Phares│ Feux arrière  │
│  └──────┴──────────┘     │
│  ⬤   ⬤    ⬤   ⬤ (roues)  │
└──────────────────────────┘
```

**Voiture Three.js (ThreeCarVisualizer) :**
- Carrosserie : `BoxGeometry(2.0, 0.35, 0.95)` avec matériau métallique
- Toit vitré : `BoxGeometry(1.0, 0.35, 0.85)` avec verre transparent
- Néon sous la voiture : couleur selon statut du trafic
- Roues qui tournent : `CylinderGeometry(0.24, 0.24, 0.16, 24)`
- Phares avant : blanc/cyan avec PointLight
- Suspension : léger rebond sinusoïdal

### 6.8 Métriques en direct

```typescript
// Buffer glissant de 200 échantillons
const errorsBuffer: number[] = [];

// Sur chaque message WebSocket :
const err = Math.abs(data.Vehicles - data.PredictedVehicles);
errorsBuffer.push(err);
if (errorsBuffer.length > 200) errorsBuffer.shift();

// Recalcul toutes les 10 messages (pas à chaque message)
if (counter++ % 10 === 0) {
  const mae = errorsBuffer.reduce((a,b) => a+b, 0) / errorsBuffer.length;
  const rmse = Math.sqrt(errorsBuffer.reduce((a,b) => a+b*b, 0) / errorsBuffer.length);
  const accuracy = Math.max(0, 100 - mae);
}
```

**Question possible du jury :** *Pourquoi recalculer les métriques tous les 10 messages plutôt qu'à chaque message ?*

**Réponse :** Le tableau de bord se met à jour toutes les ~2 secondes (délai du simulateur). Recalculer MAE/RMSE à chaque message déclencherait un re-rendu inutile des composants React. En limitant le calcul à 1 fois sur 10, on passe de ~30 re-rendus/minute à ~3, sans perte de précision (buffer de 200 échantillons).

---

## 7. Infrastructure Docker

### 7.1 Services

| Service | Image | Port | Dépend de | Rôle |
|---|---|---|---|---|
| `kafka` | `apache/kafka:3.8.0` (KRaft) | 9092 | — | Broker sans Zookeeper |
| `frontend` | Build local (multi-stage) | 3000 | backend | Dashboard Next.js |
| `backend` | Build local | 8000 | kafka (healthy) | API + WebSocket |
| `simulator` | Build local | 8001 | kafka + backend | Rejeu CSV |
| `spark-processor` | Build local | — | kafka + backend | Inférence GNN |

### 7.2 Santé des services (Healthchecks)

Chaque service a un healthcheck personnalisé :

```yaml
kafka:
  healthcheck:
    test: ["CMD-SHELL",
      "/opt/kafka/bin/kafka-broker-api-versions.sh --bootstrap-server localhost:9092"]
    start_period: 45s   # Laisse le temps à KRaft de formater les logs
    retries: 10

backend:
  healthcheck:
    test: python -c "urllib.request.urlopen('http://localhost:8000/health')"
    start_period: 30s

frontend:
  healthcheck:
    test: node -e "require('http').get('http://localhost:3000/')"
    start_period: 40s   # Next.js compile au premier lancement
```

### 7.3 Chaîne de dépendance

```
kafka (healthy) ──→ backend (healthy) ──→ frontend (healthy)
                        │
                        ├──→ simulator
                        └──→ spark-processor
```

### 7.4 Pourquoi KRaft ?

Le choix du mode KRaft (sans Zookeeper) pour Kafka 3.8 :
- **Un seul conteneur** au lieu de deux (Kafka + ZK)
- **Démarrage plus rapide** (pas de coordination ZK)
- **Moins de ressources** (RAM, CPU)
- **Plus simple à configurer**

### 7.5 Pré-téléchargement des JARs Spark

```dockerfile
# Dans le Dockerfile Spark :
RUN wget -q -O /app/jars/spark-sql-kafka-0-10_2.12-3.5.4.jar \
    "https://repo1.maven.org/..."
```

**Pourquoi ce choix ?** Spark télécharge automatiquement les connecteurs Kafka au moment du `readStream.format("kafka")`. Ce téléchargement runtime peut échouer si le DNS du conteneur ne résout pas `repo1.maven.org` (problème fréquent en CI/Docker). En les pré-téléchargeant au **build**, on garantit leur disponibilité.

---

## 8. Questions/Réponses Potentielles du Jury

### 8.1 Questions Générales

**Q :** *Quelle est la différence entre un projet tutoré et un projet professionnel classique ?*

**R :** Ce projet tutoré se distingue par :
- **L'approche Kappa Architecture** : tout est flux, pas de base de données batch
- **Le choix d'un GNN** plutôt qu'un simple LSTM, pour intégrer la dimension spatiale
- **L'infrastructure complète** : du notebook Jupyter au dashboard 3D en passant par Kafka et Spark
- **La conteneurisation complète** : déploiement en une commande (`make up`)

---

**Q :** *Quels sont les prérequis pour comprendre ce projet ?*

**R :** Il faut des bases en :
- **Deep Learning** : LSTM, GCN, attention, overfitting, early stopping
- **Big Data** : Kafka (topics, producers, consumers), Spark (micro-batching)
- **Web** : Next.js, WebSocket, MapLibre GL, Three.js
- **DevOps** : Docker, Docker Compose, CI/CD

---

### 8.2 Questions sur le Modèle

**Q :** *Avez-vous comparé LSTM et GNN ?*

**R :** Oui, l'ancien modèle (`models/global_model.pt`, 850 Ko, 200k paramètres) était un LSTM 2 couches avec 9 features. Le TrafficGNN (`models/gnn_model.pth`, 400 Ko, 102k paramètres) est :
- **Plus léger** : 2× moins de paramètres, 2× moins volumineux
- **Plus complet** : 14 features (contre 9)
- **Spatio-temporel** : intègre les relations entre junctions

Les performances MAE sont similaires, mais le GNN est mieux adapté pour :
- Ajouter plus de junctions (scaler à 10, 20, 50 nœuds)
- Intégrer des features de distance/topologie

---

**Q :** *Pourquoi n'utilisez-vous pas un transformer ?*

**R :** Les transformers excellent sur les longues séquences (100+) mais sont overkill pour 24 pas. Le LSTM + Attention du TrafficGNN offre un bon équilibre entre performance et nombre de paramètres. Un petit transformer (ex: 4 couches, 4 têtes) aurait ~500k paramètres, soit 5× plus, pour un gain marginal sur ce jeu de données.

---

**Q :** *Comment savez-vous que votre modèle ne fait pas du sur-apprentissage ?*

**R :** Plusieurs mécanismes :
1. **Early stopping** : arrêt après 10 epochs sans amélioration sur la validation
2. **Dropout (0.16)** dans l'encodeur et le décodeur
3. **Split temporel** (pas aléatoire) : on entraîne sur 80% des données les plus anciennes et on teste sur les 20% les plus récentes
4. **Graphe complet** : le GCN avec graphe complet agit comme un régularisateur en moyennant les informations des voisins

---

### 8.3 Questions Techniques

**Q :** *Pourquoi Kafka plutôt qu'une base de données temps réel (Redis, InfluxDB) ?*

**R :** Kafka n'est pas une base de données mais un **bus de messages distribué**. Son avantage ici :
- **Découplage** : le simulateur et Spark n'ont pas besoin de se connaître
- **Rejeu** : on peut rejouer les messages pour tester un nouveau modèle
- **Persistance** : les messages sont stockés sur disque
- **Scalabilité** : on peut ajouter des consumers sans modifier les producteurs

Redis serait plus rapide pour le cache, mais ne permet pas le rejeu ni la distribution.

---

**Q :** *Pourquoi utiliser Spark si le traitement est mono-processus (local[*]) ?*

**R :** Le mode `local[*]` permet de :
1. **Développer et tester** en local sans cluster Spark
2. **Utiliser l'API Structured Streaming** qui est la même qu'en cluster
3. **Bénéficier du micro-batching** et de la tolérance aux pannes
4. **Migrer facilement** vers un cluster Spark un jour (changer `local[*]` en `spark://...`)

Le passage à un cluster Spark serait justifié pour :
- Plus de junctions (50+)
- Plus de données (millions de messages/heure)
- Haute disponibilité

---

**Q :** *Comment gérez-vous la désynchronisation entre les junctions ?*

**R :** Chaque junction a son propre buffer `deque(maxlen=24)`. La prédiction n'est déclenchée que quand **toutes** les junctions ont au moins 24 pas. Si une junction reçoit des données en retard, elle rattrape son buffer au fil des micro-batches. En pratique, le simulateur envoie les 4 junctions dans le même ordre à chaque tick, donc la désynchronisation est minimale.

---

**Q :** *Pourquoi le frontend a-t-il deux systèmes 3D (MapCarAnimator et ThreeCarVisualizer) ?*

**R :** Ce sont deux usages différents :
1. **MapCarAnimator** : simule un véhicule qui se déplace sur la carte entre deux junctions. Utilise du CSS/div pour être léger et suivre les coordonnées GPS.
2. **ThreeCarVisualizer** : affiche un modèle 3D détaillé dans le panneau latéral pour donner un aperçu "premium" de la voiture. Utilise Three.js pour le rendu WebGL.

Ils ne partagent pas de logique car leurs contextes d'affichage sont différents (carte 2D vs sidebar 3D).

---

### 8.4 Questions sur l'Architecture

**Q :** *Pourquoi ne pas avoir de base de données ?*

**R :** Le projet suit une **architecture Kappa** : tout est flux, pas de batch layer. L'état est stocké en RAM :
- `current_state` : dict Python, dernière prédiction par junction
- `history` : deque de 2000 entrées par junction

Cette approche :
- **Élimine la latence DB** (pas de requête disque)
- **Simplifie l'infrastructure** (pas de PostgreSQL/Redis à gérer)
- **Suffit pour un prototype** : 2000 prédictions × 4 junctions = 8000 entrées en RAM

Pour une version production, on ajouterait une base de données (TimescaleDB pour les séries temporelles) pour la persistance longue durée.

---

**Q :** *Comment passer en production ?*

**R :** Les étapes :
1. **Base de données** : ajouter TimescaleDB pour l'historique long terme
2. **Cluster Kafka** : passer de KRaft à un cluster multi-brokers
3. **Cluster Spark** : déployer sur un vrai cluster (EMR, Databricks, etc.)
4. **Orchestration** : Kubernetes plutôt que Docker Compose
5. **Monitoring** : Prometheus + Grafana pour les métriques
6. **CI/CD** : GitHub Actions → tests → build → déploiement
7. **Authentification** : ajouter OAuth2/JWT à l'API

---

**Q :** *Qu'est-ce que vous feriez différemment si c'était à refaire ?*

**R :** Plusieurs points :
1. **StateStore Spark** : utiliser `mapGroupsWithState` plutôt que des deques Python pour une meilleure tolérance aux pannes
2. **Duplication de code** : `buildCarRoute` et `buildFullPath` partagent la même logique — à factoriser dans `routing.ts`
3. **Données synthétiques** : les sparklines utilisent `Math.random()` — à remplacer par de vraies données historiques
4. **Tests** : peu de tests (uniquement `__pycache__` présent) — à ajouter des tests unitaires et d'intégration

---

## 9. Points Forts et Limites

### 9.1 Points Forts

| Aspect | Détail |
|---|---|
| **Architecture** | Kappa complète : CSV → Kafka → Spark → API → Frontend |
| **Temps réel** | Latence < 500ms du CSV à l'affichage |
| **Modèle** | GNN spatio-temporel (LSTM + GCN + Attention) |
| **Visualisation** | Dashboard 3D avec MapLibre + Three.js + WebSocket |
| **Infrastructure** | Déploiement 1-commande (`make up`), Docker multi-stage |
| **Scalabilité** | Architecture conçue pour passer à l'échelle (Kafka + Spark) |
| **Qualité code** | TypeScript strict, types partagés, composants React découplés |

### 9.2 Limites Identifiées

| Limite | Impact | Solution possible |
|---|---|---|
| Pas de StateStore Spark | Perte d'état si crash | `mapGroupsWithState` |
| Pas de tests | Risque de régressions | `pytest` + `jest` |
| Duplication de code | Maintenance | Factoriser `buildFullPath` |
| Spark mono-process | Pas de distribué | Déploiement cluster |
| Sparklines synthétiques | Pas de vraies données | Historique depuis CSV/Kafka |
| Pas d'auth | Sécurité | JWT/OAuth |
| Dashboard langue anglaise | UX | i18n (next-intl) |

---

## 10. Glossaire Technique

| Terme | Définition |
|---|---|
| **Kappa Architecture** | Architecture où tout est traité comme un flux de données, sans batch layer |
| **KRaft** | Mode Kafka sans Zookeeper (depuis Kafka 2.8, stable en 3.x) |
| **GCN (Graph Convolutional Network)** | Réseau de neurones qui opère sur des graphes en agrégeant l'information des voisins |
| **LSTM (Long Short-Term Memory)** | Réseau de neurones récurrent conçu pour capturer les dépendances longues dans les séquences |
| **Multi-head Self-Attention** | Mécanisme qui permet à chaque élément d'une séquence de pondérer l'influence des autres éléments |
| **SIGBUS** | Signal 7 (bus error), indique un problème mémoire ou disque |
| **Micro-batching** | Technique qui consiste à traiter les données par petits lots plutôt qu'une par une |
| **Dijkstra** | Algorithme de plus court chemin dans un graphe pondéré |
| **MAE (Mean Absolute Error)** | Erreur absolue moyenne : `|prédiction - réel|` |
| **RMSE (Root Mean Squared Error)** | Racine de l'erreur quadratique moyenne, plus sensible aux grandes erreurs |
| **WebSocket** | Protocole de communication bidirectionnelle temps réel entre client et serveur |
| **MapLibre GL** | Librairie de cartographie open source, fork de Mapbox GL |
| **GeoJSON** | Format ouvert d'encodage de données géographiques |
| **asyncio** | Bibliothèque Python pour la programmation asynchrone |
| **mTLS** | Mutual TLS : authentification par certificats des deux côtés (client et serveur) |

---

## Annexe : Schéma des Flux

```
                            AXE TEMPOREL
    ┌───────────────────────────────────────────────────────────────►

    t=0s                                                          t=48s
    │                                                              │
    ├─ CSV row 1 ──→ Simulator ──→ Kafka[flux_data]               │
    │                                      │                      │
    ├─ CSV row 2 ──→ Simulator ──→ Kafka[flux_data]               │
    │                                      │                      │
    ├─ ...                                 │                      │
    │                                      │                      │
    ├─ CSV row 24 ──→ Simulator ──→ Kafka[flux_data]              │
    │                                      │                      │
    │                                      ▼ (buffer 24/24)       │
    │                               Spark/GNN                     │
    │                                      │                      │
    │                                      ▼                      │
    │                               Kafka[predictions]            │
    │                                      │                      │
    │                                      ▼                      │
    │                               FastAPI → WebSocket           │
    │                                      │                      │
    │                                      ▼                      │
    │                               Frontend (MAJ 3D)             │
    │                                                              │
    └──────────────────────────────────────────────────────────────┘
    Simulation : STREAM_DELAY = 2 secondes entre chaque ligne
    Prédiction : toutes les 24 lignes (~48 secondes)
    Latence : < 500ms de Kafka au WebSocket
```

---

## Checklist pour le Jour de la Soutenance

- [ ] Docker fonctionnel (`make up` prêt)
- [ ] `http://localhost:3000/dashboard` accessible
- [ ] WebSocket connecté (backend sain)
- [ ] Simulateur en cours d'envoi
- [ ] Spark en streaming
- [ ] GNN chargé (logs : "✅ TrafficGNN loaded")
- [ ] Carte MapLibre avec 4 marqueurs
- [ ] Clic sur un marqueur → animation caméra
- [ ] Voiture 3D dans le panneau latéral
- [ ] Métriques MAE/RMSE visibles

---

*Document préparé pour la soutenance de projet tutoré — Juin 2026*
