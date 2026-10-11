import { describe, expect, it } from 'vitest';
import { bfs } from '../src/sim/bfs.js';
import { dijkstra } from '../src/sim/dijkstra.js';
import { buildGraph, defaultTopology, linkId, type TopologyDef } from '../src/sim/topology.js';

/** Build a topology from [a, b, latency] triples. */
function topo(links: [string, string, number][]): TopologyDef {
  const nodes = [...new Set(links.flatMap(([a, b]) => [a, b]))];
  return { nodes, links: links.map(([a, b, latencyMs]) => ({ id: linkId(a, b), a, b, latencyMs })) };
}

describe('Dijkstra', () => {
  it('finds the minimum-latency path on a textbook graph and reports the settle order', () => {
    // Classic 6-node example: shortest N1 → N5 is N1-N3-N6-N5 with cost 20.
    const g = buildGraph(topo([
      ['N1', 'N2', 7], ['N1', 'N3', 9], ['N1', 'N6', 14], ['N2', 'N3', 10], ['N2', 'N4', 15],
      ['N3', 'N4', 11], ['N3', 'N6', 2], ['N4', 'N5', 6], ['N5', 'N6', 9],
    ]));
    const r = dijkstra(g, 'N1', 'N5');
    expect(r.path).toEqual(['N1', 'N3', 'N6', 'N5']);
    expect(r.cost).toBe(20);
    // N4 and N5 both cost 20; N4 has fewer hops so it is settled first.
    expect(r.steps).toEqual([
      { node: 'N1', cost: 0, hops: 0, via: null },
      { node: 'N2', cost: 7, hops: 1, via: 'N1' },
      { node: 'N3', cost: 9, hops: 1, via: 'N1' },
      { node: 'N6', cost: 11, hops: 2, via: 'N3' },
      { node: 'N4', cost: 20, hops: 2, via: 'N3' },
      { node: 'N5', cost: 20, hops: 3, via: 'N6' },
    ]);
    expect(r.visitOrder).toEqual(['N1', 'N2', 'N3', 'N6', 'N4', 'N5']);
    expect(r.table.find((t) => t.node === 'N5')).toEqual({ node: 'N5', cost: 20, hops: 3, via: 'N6', settled: true });
  });

  it('prefers the primary route on the Classic topology (600 ms vs 800 ms)', () => {
    const r = dijkstra(buildGraph(defaultTopology()), 'A', 'C');
    expect(r.path).toEqual(['A', 'B', 'C']);
    expect(r.cost).toBe(600);
  });

  describe('zero-weight edges', () => {
    it('uses a zero-cost multi-hop path when it is the cheapest', () => {
      const r = dijkstra(buildGraph(topo([['A', 'B', 0], ['B', 'C', 0], ['A', 'C', 5]])), 'A', 'C');
      expect(r.path).toEqual(['A', 'B', 'C']);
      expect(r.cost).toBe(0);
    });

    it('breaks an all-zero tie by fewer hops and records the tie', () => {
      const r = dijkstra(buildGraph(topo([['A', 'B', 0], ['B', 'C', 0], ['A', 'C', 0]])), 'A', 'C');
      expect(r.path).toEqual(['A', 'C']);
      expect(r.cost).toBe(0);
      expect(r.tieBreaks).toHaveLength(1);
      expect(r.tieBreaks[0]).toContain('fewer hops');
    });

    it('handles a source-to-destination path that is entirely zero-cost', () => {
      const r = dijkstra(buildGraph(topo([['A', 'B', 0], ['B', 'C', 0], ['C', 'D', 0]])), 'A', 'D');
      expect(r.path).toEqual(['A', 'B', 'C', 'D']);
      expect(r.cost).toBe(0);
    });
  });

  describe('unreachable destinations', () => {
    it('returns null path and cost, and marks unreached nodes as ∞ (null)', () => {
      const g = buildGraph(topo([['A', 'B', 1], ['C', 'D', 1]]));
      const r = dijkstra(g, 'A', 'D');
      expect(r.path).toBeNull();
      expect(r.cost).toBeNull();
      expect(r.visitOrder).toEqual(['A', 'B']);
      expect(r.table.find((t) => t.node === 'D')).toEqual({ node: 'D', cost: null, hops: null, via: null, settled: false });
    });

    it('returns null when the source or destination is not in the graph', () => {
      const g = buildGraph(defaultTopology(), new Set(['C']));
      expect(dijkstra(g, 'A', 'C').path).toBeNull();
      expect(dijkstra(g, 'Z', 'A').path).toBeNull();
    });
  });

  describe('excluded nodes and links', () => {
    it('routes around an excluded node', () => {
      const r = dijkstra(buildGraph(defaultTopology(), new Set(['B'])), 'A', 'C');
      expect(r.path).toEqual(['A', 'D', 'C']);
      expect(r.cost).toBe(800);
      expect(r.visitOrder).not.toContain('B');
    });

    it('routes around an excluded link', () => {
      const r = dijkstra(buildGraph(defaultTopology(), new Set(), new Set(['B-C'])), 'A', 'C');
      expect(r.path).toEqual(['A', 'D', 'C']);
    });

    it('reports no path when every route is excluded', () => {
      expect(dijkstra(buildGraph(defaultTopology(), new Set(['B', 'D'])), 'A', 'C').path).toBeNull();
    });
  });

  describe('deterministic tie-breaking', () => {
    const square: [string, string, number][] = [['A', 'B', 1], ['B', 'D', 1], ['A', 'C', 1], ['C', 'D', 1]];

    it('picks the alphabetically smaller of two equal-cost, equal-hop paths', () => {
      const r = dijkstra(buildGraph(topo(square)), 'A', 'D');
      expect(r.path).toEqual(['A', 'B', 'D']);
      expect(r.tieBreaks.some((t) => t.includes('alphabetical'))).toBe(true);
    });

    it('gives the same answer regardless of link declaration order', () => {
      const reversed = [...square].reverse().map(([a, b, w]) => [b, a, w] as [string, string, number]);
      expect(dijkstra(buildGraph(topo(reversed)), 'A', 'D')).toEqual(dijkstra(buildGraph(topo(square)), 'A', 'D'));
    });

    it('prefers fewer hops when costs are equal', () => {
      const r = dijkstra(buildGraph(topo([['A', 'B', 1], ['B', 'D', 1], ['A', 'D', 2]])), 'A', 'D');
      expect(r.path).toEqual(['A', 'D']);
    });

    it('replaces an earlier-found equal path with an alphabetically smaller one found later', () => {
      // S-Z-T is discovered first (Z is settled at cost 1), S-A-T (cost 5+1) is found later.
      const r = dijkstra(buildGraph(topo([['S', 'A', 5], ['A', 'T', 1], ['S', 'Z', 1], ['Z', 'T', 5]])), 'S', 'T');
      expect(r.cost).toBe(6);
      expect(r.path).toEqual(['S', 'A', 'T']);
      expect(r.tieBreaks.some((t) => t.includes('chose S→A→T'))).toBe(true);
    });
  });

  it('chooses a different route from BFS when the fewest-hop path is slower', () => {
    // Two hops at 500 ms each vs three hops at 100 ms each.
    const g = buildGraph(topo([['S', 'X', 500], ['X', 'T', 500], ['S', 'Y', 100], ['Y', 'Z', 100], ['Z', 'T', 100]]));
    expect(bfs(g, 'S', 'T').path).toEqual(['S', 'X', 'T']);
    const d = dijkstra(g, 'S', 'T');
    expect(d.path).toEqual(['S', 'Y', 'Z', 'T']);
    expect(d.cost).toBe(300);
  });
});
