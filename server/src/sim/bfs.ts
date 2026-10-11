import type { NodeId } from '../../../shared/types.js';
import type { Graph } from './topology.js';

export interface BfsResult {
  /** Shortest path (fewest hops) from source to destination, or null if unreachable. */
  path: NodeId[] | null;
  /** Order in which nodes were dequeued — useful for explaining the algorithm. */
  visitOrder: NodeId[];
  /** Hop distance from the source for every node that was discovered. */
  levels: Record<NodeId, number>;
  /** BFS-tree parent of every discovered node (source → null). */
  parents: Record<NodeId, NodeId | null>;
}

/**
 * Breadth-First Search for the minimum-hop route.
 *
 * 1. Put the source in a FIFO queue and mark it visited.
 * 2. Dequeue a node; if it is the destination, stop.
 * 3. Otherwise enqueue every unvisited neighbour, remembering its parent.
 * 4. When the destination is reached, follow parent pointers back to the source.
 *
 * Because BFS explores the graph level by level, the first time it reaches the
 * destination is guaranteed to be via a path with the fewest hops. Link
 * latency (edge weight) is ignored. Ties between equal-hop paths are broken by
 * the graph's sorted neighbour order, i.e. alphabetically.
 */
export function bfs(graph: Graph, source: NodeId, destination: NodeId): BfsResult {
  const visitOrder: NodeId[] = [];
  const levels: Record<NodeId, number> = {};
  const parents: Record<NodeId, NodeId | null> = {};
  if (!graph.has(source) || !graph.has(destination)) return { path: null, visitOrder, levels, parents };

  const parent = new Map<NodeId, NodeId | null>([[source, null]]);
  levels[source] = 0;
  const queue: NodeId[] = [source];

  const result = (path: NodeId[] | null): BfsResult => {
    for (const [n, p] of parent) parents[n] = p;
    return { path, visitOrder, levels, parents };
  };

  while (queue.length > 0) {
    const current = queue.shift()!;
    visitOrder.push(current);

    if (current === destination) {
      const path: NodeId[] = [];
      for (let n: NodeId | null = current; n !== null; n = parent.get(n)!) path.unshift(n);
      return result(path);
    }

    for (const { to: next } of graph.get(current) ?? []) {
      if (!parent.has(next)) {
        parent.set(next, current);
        levels[next] = levels[current] + 1;
        queue.push(next);
      }
    }
  }
  return result(null);
}
