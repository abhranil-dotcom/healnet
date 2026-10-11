import type { LinkId, NodeId } from '../../../shared/types.js';

export interface LinkDef {
  id: LinkId;
  a: NodeId;
  b: NodeId;
  latencyMs: number;
}

export interface TopologyDef {
  nodes: NodeId[];
  links: LinkDef[];
}

export function linkId(a: NodeId, b: NodeId): LinkId {
  return [a, b].sort().join('-');
}

function link(a: NodeId, b: NodeId, latencyMs: number): LinkDef {
  return { id: linkId(a, b), a, b, latencyMs };
}

/**
 * HEALNET project topology:
 *
 *        B
 *      /   \
 *    A       C        primary : A → B → C
 *      \   /          backup  : A → D → C
 *        D
 *
 * Latencies are simulated values; the backup path is slightly slower so the
 * change in end-to-end delay after recovery is visible in the metrics.
 */
export function defaultTopology(): TopologyDef {
  return {
    nodes: ['A', 'B', 'C', 'D'],
    links: [link('A', 'B', 300), link('B', 'C', 300), link('A', 'D', 400), link('D', 'C', 400)],
  };
}

/** One usable direction of an (undirected) link. `weight` is the link latency in ms. */
export interface Edge {
  to: NodeId;
  linkId: LinkId;
  weight: number;
}

/**
 * Weighted adjacency list: node → outgoing edges, sorted by neighbour id (then
 * link id). The fixed order makes BFS and Dijkstra fully deterministic.
 * BFS ignores `weight`; Dijkstra uses it as the path cost.
 */
export type Graph = Map<NodeId, Edge[]>;

const compareIds = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Build the graph the router is allowed to use.
 * Excluded nodes are removed together with every link touching them.
 */
export function buildGraph(
  topo: TopologyDef,
  excludedNodes: ReadonlySet<NodeId> = new Set(),
  excludedLinks: ReadonlySet<LinkId> = new Set(),
): Graph {
  const graph: Graph = new Map();
  for (const n of topo.nodes) if (!excludedNodes.has(n)) graph.set(n, []);
  for (const l of topo.links) {
    if (excludedLinks.has(l.id) || excludedNodes.has(l.a) || excludedNodes.has(l.b)) continue;
    graph.get(l.a)!.push({ to: l.b, linkId: l.id, weight: l.latencyMs });
    graph.get(l.b)!.push({ to: l.a, linkId: l.id, weight: l.latencyMs });
  }
  for (const edges of graph.values()) edges.sort((x, y) => compareIds(x.to, y.to) || compareIds(x.linkId, y.linkId));
  return graph;
}

/** Sum of edge weights along a path (cheapest parallel edge per hop), or null if a hop is missing. */
export function pathCost(graph: Graph, path: NodeId[]): number | null {
  let cost = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const edges = (graph.get(path[i]) ?? []).filter((e) => e.to === path[i + 1]);
    if (edges.length === 0) return null;
    cost += Math.min(...edges.map((e) => e.weight));
  }
  return cost;
}
