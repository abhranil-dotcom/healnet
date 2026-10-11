import { describe, expect, it } from 'vitest';
import { bfs } from '../src/sim/bfs.js';
import { buildGraph, defaultTopology } from '../src/sim/topology.js';

const topo = defaultTopology();

describe('BFS routing', () => {
  it('finds the primary route A → B → C on the full topology', () => {
    const r = bfs(buildGraph(topo), 'A', 'C');
    expect(r.path).toEqual(['A', 'B', 'C']);
    expect(r.visitOrder[0]).toBe('A');
  });

  it('finds the backup route A → D → C when B is excluded', () => {
    const r = bfs(buildGraph(topo, new Set(['B'])), 'A', 'C');
    expect(r.path).toEqual(['A', 'D', 'C']);
    expect(r.visitOrder).not.toContain('B');
  });

  it('finds the backup route when only link B-C is excluded', () => {
    expect(bfs(buildGraph(topo, new Set(), new Set(['B-C'])), 'A', 'C').path).toEqual(['A', 'D', 'C']);
  });

  it('returns null when the destination is unreachable', () => {
    expect(bfs(buildGraph(topo, new Set(['B', 'D'])), 'A', 'C').path).toBeNull();
    expect(bfs(buildGraph(topo, new Set(), new Set(['A-B', 'A-D'])), 'A', 'C').path).toBeNull();
  });

  it('returns null when the destination itself is excluded', () => {
    expect(bfs(buildGraph(topo, new Set(['C'])), 'A', 'C').path).toBeNull();
  });

  it('returns the minimum-hop path on a longer graph', () => {
    const graph = buildGraph({
      nodes: ['S', 'X', 'Y', 'Z', 'T'],
      links: [
        { id: 'S-X', a: 'S', b: 'X', latencyMs: 1 },
        { id: 'X-Y', a: 'X', b: 'Y', latencyMs: 1 },
        { id: 'T-Y', a: 'Y', b: 'T', latencyMs: 1 },
        { id: 'S-Z', a: 'S', b: 'Z', latencyMs: 1 },
        { id: 'T-Z', a: 'Z', b: 'T', latencyMs: 1 },
      ],
    });
    expect(bfs(graph, 'S', 'T').path).toEqual(['S', 'Z', 'T']);
  });
});
