"""
TrafficGNN — Spatio-Temporal Graph Neural Network for multi-junction traffic prediction.

Architecture:
  - Per-node LSTM encoder (14 → 96) processes 24-step sequences independently
  - GCN layer (proj + self) propagates information between junctions
  - Multi-head Self-Attention (3 heads) across junctions
  - MLP decoder (96 → 32 → 1) per junction

Input:  (batch, N, T, F) = (batch, 4, 24, 14)
Output: (batch, N, 1)       = (batch, 4, 1)
"""

import torch
import torch.nn as nn


class TrafficGNN(nn.Module):
    """Spatio-temporal GNN for traffic prediction across 4 junctions."""

    def __init__(self, num_nodes: int = 4, in_features: int = 14,
                 hidden_size: int = 96, seq_len: int = 24,
                 num_heads: int = 3, dropout: float = 0.16):
        super().__init__()
        self.num_nodes = num_nodes
        self.in_features = in_features
        self.hidden_size = hidden_size
        self.seq_len = seq_len

        # ─── Per-node LSTM encoder ────────────────────────────────
        self.node_encoder = nn.LSTM(
            input_size=in_features,
            hidden_size=hidden_size,
            num_layers=1,
            batch_first=True,
        )

        # ─── GCN layers (spatial propagation) ─────────────────────
        self.gcn_proj = nn.Linear(hidden_size, hidden_size)
        self.gcn_self = nn.Linear(hidden_size, hidden_size)

        # ─── Multi-head Self-Attention ────────────────────────────
        self.attention = nn.MultiheadAttention(
            embed_dim=hidden_size,
            num_heads=num_heads,
            batch_first=True,
            dropout=dropout,
        )

        # ─── MLP decoder ──────────────────────────────────────────
        self.decoder = nn.Sequential(
            nn.Linear(hidden_size, 32),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(32, 1),
        )

    def forward(self, x: torch.Tensor, adj: torch.Tensor | None = None) -> torch.Tensor:
        """
        Args:
            x:   (batch, num_nodes, seq_len, in_features) = (B, 4, 24, 14)
            adj: (num_nodes, num_nodes) normalized adjacency, or None for full graph

        Returns:
            (batch, num_nodes, 1) predictions
        """
        B, N, T, F = x.shape

        # ─── 1. Per-node LSTM ─────────────────────────────────────
        # Reshape: (B*N, T, F) → process all node sequences independently
        x_lstm = x.view(B * N, T, F)
        lstm_out, (h_n, _) = self.node_encoder(x_lstm)
        # Use final hidden state as node embedding: (B*N, H)
        node_emb = h_n[-1]  # take last layer's hidden state
        node_emb = node_emb.view(B, N, self.hidden_size)  # (B, N, H)

        # ─── 2. GCN spatial propagation ───────────────────────────
        if adj is None:
            # Default: fully connected graph with self-loops normalized
            adj = self._build_adjacency(N, device=x.device)

        # Aggregate neighbors: A @ node_emb  →  (B, N, H)
        agg = torch.matmul(adj.unsqueeze(0), node_emb)  # (B, N, H)
        gcn_out = torch.relu(
            self.gcn_proj(agg) + self.gcn_self(node_emb)  # (B, N, H)
        )

        # Residual connection
        node_emb = node_emb + gcn_out  # (B, N, H)

        # ─── 3. Multi-head Self-Attention ─────────────────────────
        attn_out, _ = self.attention(node_emb, node_emb, node_emb)  # (B, N, H)
        attn_out = node_emb + attn_out

        # ─── 4. MLP decoder ───────────────────────────────────────
        # Per-node prediction: (B, N, H) → (B, N, 1)
        pred = self.decoder(attn_out)  # (B, N, 1)

        return pred

    @staticmethod
    def _build_adjacency(num_nodes: int, device: torch.device) -> torch.Tensor:
        """
        Build normalized adjacency matrix for a fully-connected graph
        WITHOUT self-loops (self handled by gcn_self layer).

        Returns:
            A_hat = D^(-1/2) A D^(-1/2), shape (num_nodes, num_nodes)
        """
        # Adjacency: complete graph, no self-loops
        A = torch.ones(num_nodes, num_nodes, device=device)
        A.fill_diagonal_(0)
        # Symmetric normalisation: D^(-1/2) A D^(-1/2)
        deg = torch.full((num_nodes,), num_nodes - 1, dtype=torch.float32, device=device)
        D_inv_sqrt = torch.diag(deg.pow(-0.5))
        return D_inv_sqrt @ A @ D_inv_sqrt

    def load_pretrained(self, path: str, map_location: str = "cpu") -> None:
        """Load pretrained weights from HuggingFace checkpoint."""
        state_dict = torch.load(path, map_location=map_location, weights_only=True)
        self.load_state_dict(state_dict)
        self.eval()
        print(f"✅ TrafficGNN loaded from {path}")
        print(f"   Parameters: {sum(p.numel() for p in self.parameters()):,}")


if __name__ == "__main__":
    import os
    os.chdir(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
    model = TrafficGNN()
    model.load_pretrained("models/gnn_model.pth")
    dummy = torch.randn(2, 4, 24, 14)
    out = model(dummy)
    print(f"Input:  {dummy.shape}")
    print(f"Output: {out.shape}  (expected: [2, 4, 1])")
    print("✅ Model forward pass OK")
