import type { NodeId } from '../../../shared/types.js';
import type { Graph } from './topology.js';

/** One row of Dijkstra's working table. */
export interface DijkstraEntry {
  node: NodeId;
  /** Best known total latency from the source (null = not reached, i.e. ∞). */
  cost: number | null;
  /** Hop count of that best path. */
  hops: number | null;
  /** Predecessor on that best path. */
  via: NodeId | null;
  settled: boolean;
}

export interface DijkstraResult {
  /** Minimum-cost path from source to destination, or null if unreachable. */
  path: NodeId[] | null;
  /** Total cost (sum of link latencies) of `path`. */
  cost: number | null;
  /** Nodes in the order they were settled (finalised). */
  visitOrder: NodeId[];
  /** The settle steps, with the final cost of each settled node. */
  steps: { node: NodeId; cost: number; hops: number; via: NodeId | null }[];
  /** Final table for every node in the graph. */
  table: DijkstraEntry[];
  /** Human-readable notes for every tie that the tie-breaking rule had to resolve. */
  tieBreaks: string[];
}

/** Compare two equal-length paths alphabetically, element by element. */
function comparePaths(a: NodeId[], b: NodeId[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return a.length - b.length;
}

/**
 * Dijkstra's algorithm for the minimum-latency route (edge weights must be ≥ 0).
 *
 * Textbook O(V²) version, chosen because every step is easy to follow:
 *   1. cost[source] = 0, every other node = ∞.
 *   2. Repeatedly pick the unsettled node with the smallest cost and settle it
 *      (its cost can no longer improve, because weights are non-negative).
 *   3. "Relax" each edge u→v of the settled node: if cost[u] + w(u,v) beats
 *      cost[v], record the new cost and set via[v] = u.
 *   4. Stop when the destination is settled (or nothing reachable is left).
 *
 * Deterministic tie-breaking, applied in this order when two candidate paths
 * to the same node have equal cost:
 *   a. fewer hops wins;
 *   b. otherwise the alphabetically smaller path wins (compared node by node).
 * Nodes with equal cost are settled in (cost, hops, id) order. With
 * non-negative weights every optimal predecessor is settled before the node
 * itself, so the chosen path is the alphabetically smallest among all
 * minimum-cost, minimum-hop paths.
 */
export function dijkstra(graph: Graph, source: NodeId, destination: NodeId): DijkstraResult {
  const empty: DijkstraResult = { path: null, cost: null, visitOrder: [], steps: [], table: [], tieBreaks: [] };
  if (!graph.has(source) || !graph.has(destination)) {
    empty.table = [...graph.keys()].sort().map((node) => ({ node, cost: null, hops: null, via: null, settled: false }));
    return empty;
  }

  const cost = new Map<NodeId, number>([[source, 0]]);
  const hops = new Map<NodeId, number>([[source, 0]]);
  const via = new Map<NodeId, NodeId | null>([[source, null]]);
  const settled = new Set<NodeId>();
  const steps: DijkstraResult['steps'] = [];
  const tieBreaks: string[] = [];

  const pathTo = (n: NodeId): NodeId[] => {
    const p: NodeId[] = [];
    for (let x: NodeId | null = n; x !== null; x = via.get(x) ?? null) p.unshift(x);
    return p;
  };

  for (;;) {
    // Select the unsettled node with the smallest (cost, hops, id).
    let u: NodeId | null = null;
    for (const [n, c] of cost) {
      if (settled.has(n)) continue;
      if (u === null) { u = n; continue; }
      const cu = cost.get(u)!;
      if (c < cu || (c === cu && (hops.get(n)! < hops.get(u)! || (hops.get(n) === hops.get(u) && n < u)))) u = n;
    }
    if (u === null) break; // every reachable node is settled

    settled.add(u);
    steps.push({ node: u, cost: cost.get(u)!, hops: hops.get(u)!, via: via.get(u)! });
    if (u === destination) break;

    // Relax every edge leaving u.
    for (const { to: v, weight } of graph.get(u)!) {
      if (settled.has(v)) continue;
      const newCost = cost.get(u)! + weight;
      const newHops = hops.get(u)! + 1;
      const oldCost = cost.get(v);

      if (oldCost === undefined || newCost < oldCost) {
        cost.set(v, newCost);
        hops.set(v, newHops);
        via.set(v, u);
      } else if (newCost === oldCost) {
        const current = pathTo(v);
        const candidate = [...pathTo(u), v];
        const oldHops = hops.get(v)!;
        if (newHops < oldHops) {
          cost.set(v, newCost); hops.set(v, newHops); via.set(v, u);
          tieBreaks.push(`${v}: ${candidate.join('→')} and ${current.join('→')} both cost ${newCost} ms — chose ${candidate.join('→')} (fewer hops)`);
        } else if (newHops > oldHops) {
          tieBreaks.push(`${v}: ${current.join('→')} and ${candidate.join('→')} both cost ${newCost} ms — kept ${current.join('→')} (fewer hops)`);
        } else if (comparePaths(candidate, current) < 0) {
          via.set(v, u);
          tieBreaks.push(`${v}: ${candidate.join('→')} and ${current.join('→')} both cost ${newCost} ms with ${newHops} hops — chose ${candidate.join('→')} (alphabetical)`);
        } else {
          tieBreaks.push(`${v}: ${current.join('→')} and ${candidate.join('→')} both cost ${newCost} ms with ${newHops} hops — kept ${current.join('→')} (alphabetical)`);
        }
      }
    }
  }

  const table: DijkstraEntry[] = [...graph.keys()].sort().map((node) => ({
    node,
    cost: cost.get(node) ?? null,
    hops: hops.get(node) ?? null,
    via: via.get(node) ?? null,
    settled: settled.has(node),
  }));
  const reached = settled.has(destination);
  return {
    path: reached ? pathTo(destination) : null,
    cost: reached ? cost.get(destination)! : null,
    visitOrder: steps.map((s) => s.node),
    steps,
    table,
    tieBreaks,
  };
}
