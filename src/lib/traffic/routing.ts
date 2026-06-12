// Dijkstra-based routing with congestion-aware weights
import { RouteSegment } from '@/types/traffic';

const CONGESTION_WEIGHT: Record<string, number> = {
  fluid: 1.0,
  moderate: 3.0,
  congested: 8.0,
};

export function findBestPath(
  from: string,
  to: string,
  routes: RouteSegment[]
): string[] | null {
  if (from === to) return null;

  // Build adjacency list
  const graph: Record<string, { neighbor: string; weight: number }[]> = {};
  for (const r of routes) {
    if (!graph[r.from]) graph[r.from] = [];
    if (!graph[r.to]) graph[r.to] = [];
    const w = CONGESTION_WEIGHT[r.status] ?? 1.0;
    graph[r.from].push({ neighbor: r.to, weight: w });
    graph[r.to].push({ neighbor: r.from, weight: w });
  }

  // Dijkstra
  const dist: Record<string, number> = {};
  const prev: Record<string, string | null> = {};
  const unvisited = new Set<string>();

  for (const node of Object.keys(graph)) {
    dist[node] = Infinity;
    prev[node] = null;
    unvisited.add(node);
  }
  dist[from] = 0;

  while (unvisited.size > 0) {
    let current: string | null = null;
    let minDist = Infinity;
    for (const n of unvisited) {
      if (dist[n] < minDist) {
        minDist = dist[n];
        current = n;
      }
    }
    if (!current || current === to) break;
    unvisited.delete(current);

    for (const { neighbor, weight } of graph[current] ?? []) {
      if (!unvisited.has(neighbor)) continue;
      const alt = dist[current] + weight;
      if (alt < dist[neighbor]) {
        dist[neighbor] = alt;
        prev[neighbor] = current;
      }
    }
  }

  // Reconstruct path
  const path: string[] = [];
  let node: string | null = to;
  while (node) {
    path.unshift(node);
    node = prev[node];
  }

  if (path[0] !== from) return null; // No path found
  return path;
}
