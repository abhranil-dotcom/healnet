import { performance } from 'node:perf_hooks';
import type { NodeId, RouteTrace, RoutingAlgorithm } from '../../../shared/types.js';
import { bfs } from './bfs.js';
import { dijkstra } from './dijkstra.js';
import { pathCost, type Graph } from './topology.js';

export const ROUTING_ALGORITHMS: readonly RoutingAlgorithm[] = ['BFS', 'DIJKSTRA'];
export const ALGORITHM_LABEL: Record<RoutingAlgorithm, string> = { BFS: 'BFS', DIJKSTRA: 'Dijkstra' };

export function isRoutingAlgorithm(x: unknown): x is RoutingAlgorithm {
  return typeof x === 'string' && (ROUTING_ALGORITHMS as readonly string[]).includes(x);
}

/** Result of `computeRoute`: everything in RouteTrace except engine context (time, exclusions). */
export type RouteResult = Omit<RouteTrace, 'at' | 'excludedNodes' | 'excludedLinks'>;

const arrow = (p: NodeId[]) => p.join(' → ');

/**
 * Algorithm-neutral route computation. Runs the selected algorithm on the
 * given (already filtered) graph and returns the path together with its hop
 * count, total latency and an explanation built from the actual run.
 */
export function computeRoute(algorithm: RoutingAlgorithm, graph: Graph, source: NodeId, destination: NodeId): RouteResult {
  if (algorithm === 'DIJKSTRA') {
    const t0 = performance.now();
    const r = dijkstra(graph, source, destination);
    const computeMicros = micros(t0);
    const settled = r.steps.map((s) => `${s.node}(${s.cost})`).join(', ');
    const explanation = r.path
      ? `Dijkstra settled nodes in order of total latency — ${settled} — and chose ${arrow(r.path)}: ` +
        `${r.cost} ms over ${r.path.length - 1} hop(s), the minimum total link latency.` +
        (r.tieBreaks.length ? ` ${r.tieBreaks.length} tie(s) resolved: equal cost → fewer hops → alphabetical.` : '')
      : `Dijkstra settled ${settled || 'no nodes'} but never reached ${destination}: no usable path from ${source}.`;
    return {
      algorithm, source, destination,
      path: r.path,
      hops: r.path ? r.path.length - 1 : null,
      cost: r.cost,
      visitOrder: r.visitOrder,
      dijkstraSteps: r.steps,
      dijkstraTable: r.table,
      tieBreaks: r.tieBreaks,
      explanation,
      computeMicros,
    };
  }

  const t0 = performance.now();
  const r = bfs(graph, source, destination);
  const computeMicros = micros(t0);
  const cost = r.path ? pathCost(graph, r.path) : null;
  const byLevel = new Map<number, NodeId[]>();
  for (const n of r.visitOrder) byLevel.set(r.levels[n], [...(byLevel.get(r.levels[n]) ?? []), n]);
  const levels = [...byLevel.entries()].map(([lvl, ns]) => `L${lvl}: ${ns.join(', ')}`).join('; ');
  const explanation = r.path
    ? `BFS explored level by level (${levels}) and returned the first path to reach ${destination}: ${arrow(r.path)} — ` +
      `${r.path.length - 1} hop(s), ${cost} ms total latency. BFS minimises hops and ignores link latency; equal-hop ties go to the alphabetically first neighbour.`
    : `BFS visited ${r.visitOrder.join(', ') || 'no nodes'} but never reached ${destination}: no usable path from ${source}.`;
  return {
    algorithm, source, destination,
    path: r.path,
    hops: r.path ? r.path.length - 1 : null,
    cost,
    visitOrder: r.visitOrder,
    bfsLevels: r.levels,
    tieBreaks: [],
    explanation,
    computeMicros,
  };
}

function micros(t0: number): number {
  return Math.round((performance.now() - t0) * 1000 * 10) / 10;
}
