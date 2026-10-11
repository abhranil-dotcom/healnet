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

/** Adjacency list: node → sorted neighbours. Sorting makes BFS deterministic. */
export type Graph = Map<NodeId, NodeId[]>;

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
    graph.get(l.a)!.push(l.b);
    graph.get(l.b)!.push(l.a);
  }
  for (const list of graph.values()) list.sort();
  return graph;
}
