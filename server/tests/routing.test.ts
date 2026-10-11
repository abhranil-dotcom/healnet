import { describe, expect, it } from 'vitest';
import { SimulationEngine } from '../src/sim/engine.js';
import { computeRoute } from '../src/sim/routing.js';
import { buildGraph, defaultTopology, linkId, type TopologyDef } from '../src/sim/topology.js';

/** Fewest hops (A-B-C, 1000 ms) differs from lowest latency (A-D-E-C, 300 ms). */
function trapTopology(): TopologyDef {
  const l = (a: string, b: string, latencyMs: number) => ({ id: linkId(a, b), a, b, latencyMs });
  return {
    nodes: ['A', 'B', 'C', 'D', 'E'],
    links: [l('A', 'B', 500), l('B', 'C', 500), l('A', 'D', 100), l('D', 'E', 100), l('E', 'C', 100)],
  };
}

describe('computeRoute', () => {
  it('BFS: returns path, hops, total latency and level-by-level explanation', () => {
    const r = computeRoute('BFS', buildGraph(defaultTopology()), 'A', 'C');
    expect(r.algorithm).toBe('BFS');
    expect(r.path).toEqual(['A', 'B', 'C']);
    expect(r.hops).toBe(2);
    expect(r.cost).toBe(600);
    expect(r.bfsLevels).toEqual({ A: 0, B: 1, D: 1, C: 2 });
    expect(r.explanation).toContain('L0: A; L1: B, D; L2: C');
    expect(r.computeMicros).toBeGreaterThanOrEqual(0);
  });

  it('Dijkstra: returns path, cost, settle steps and table', () => {
    const r = computeRoute('DIJKSTRA', buildGraph(trapTopology()), 'A', 'C');
    expect(r.algorithm).toBe('DIJKSTRA');
    expect(r.path).toEqual(['A', 'D', 'E', 'C']);
    expect(r.hops).toBe(3);
    expect(r.cost).toBe(300);
    expect(r.dijkstraSteps!.map((s) => s.node)).toEqual(['A', 'D', 'E', 'C']);
    expect(r.dijkstraTable!.find((t) => t.node === 'B')).toMatchObject({ cost: 500, settled: false });
    expect(r.explanation).toContain('300 ms');
  });

  it('BFS reports the real latency of its fewest-hop path, which can be worse', () => {
    const r = computeRoute('BFS', buildGraph(trapTopology()), 'A', 'C');
    expect(r.path).toEqual(['A', 'B', 'C']);
    expect(r.cost).toBe(1000);
  });

  it('both algorithms explain an unreachable destination', () => {
    const g = buildGraph(defaultTopology(), new Set(['B', 'D']));
    for (const alg of ['BFS', 'DIJKSTRA'] as const) {
      const r = computeRoute(alg, g, 'A', 'C');
      expect(r.path).toBeNull();
      expect(r.hops).toBeNull();
      expect(r.cost).toBeNull();
      expect(r.explanation).toContain('no usable path');
    }
  });
});

describe('engine routing integration', () => {
  const quiet = { heartbeatIntervalMs: 1000, missedThreshold: 3, trafficIntervalMs: 0 };

  it('defaults to BFS and exposes the route trace in the snapshot', () => {
    const e = new SimulationEngine(quiet);
    const s = e.snapshot();
    expect(s.config.routingAlgorithm).toBe('BFS');
    expect(s.routing.algorithm).toBe('BFS');
    expect(s.routing.lastResult?.path).toEqual(['A', 'B', 'C']);
    expect(s.routing.activeRouteCost).toBe(600);
    expect(s.lastBfs?.path).toEqual(['A', 'B', 'C']); // legacy field still filled
  });

  it('switching to Dijkstra recomputes immediately and can change the route without a failure', () => {
    const e = new SimulationEngine(quiet, trapTopology());
    expect(e.activeRoute).toEqual(['A', 'B', 'C']);
    expect(e.setConfig({ routingAlgorithm: 'DIJKSTRA' }).ok).toBe(true);
    expect(e.activeRoute).toEqual(['A', 'D', 'E', 'C']);
    expect(e.events.some((ev) => ev.kind === 'DIJKSTRA')).toBe(true);
    expect(e.events.at(-1)?.kind).toBe('ROUTE_CHANGED');
    expect(e.recoveries).toHaveLength(0); // an algorithm change is not a recovery
    expect(e.snapshot().routing.activeRouteCost).toBe(300);
  });

  it('delivers packets over the Dijkstra route with the matching end-to-end delay', () => {
    const e = new SimulationEngine({ ...quiet, routingAlgorithm: 'DIJKSTRA' }, trapTopology());
    e.start();
    e.sendPacket('TEST');
    e.advance(1000);
    expect(e.packets[0]).toMatchObject({ state: 'DELIVERED', path: ['A', 'D', 'E', 'C'], delayMs: 300 });
  });

  it('recovers from a node failure with Dijkstra and labels the recovery correctly', () => {
    const e = new SimulationEngine({ ...quiet, routingAlgorithm: 'DIJKSTRA' });
    e.start();
    e.advance(500);
    e.failNode('B');
    e.advance(2500);
    expect(e.activeRoute).toEqual(['A', 'D', 'C']);
    const rec = e.getMetrics().lastRecovery!;
    expect(rec).toMatchObject({ cause: 'Node B', algorithm: 'DIJKSTRA', recoveryMs: 2500, detectionMs: 2500 });
    expect(rec.bfsMicros).toBe(rec.computeMicros);
    expect(e.events.find((ev) => ev.kind === 'RECOVERY')?.message).toContain('Dijkstra');
  });

  it('rejects an unknown routing algorithm', () => {
    const e = new SimulationEngine(quiet);
    expect(e.setConfig({ routingAlgorithm: 'A_STAR' as never }).ok).toBe(false);
    expect(e.config.routingAlgorithm).toBe('BFS');
  });

  it('the Classic demo always runs with BFS and restores the user algorithm afterwards', () => {
    const e = new SimulationEngine({ routingAlgorithm: 'DIJKSTRA' });
    e.runDemo();
    expect(e.config.routingAlgorithm).toBe('BFS');
    for (let i = 0; i < 2000 && e.demo!.running; i++) e.advance(50);
    const m = e.getMetrics();
    expect(m.lastRecovery).toMatchObject({ algorithm: 'BFS', recoveryMs: 2400 });
    expect([m.delivered, m.sent]).toEqual([11, 16]);
    expect(e.config.routingAlgorithm).toBe('DIJKSTRA');
  });
});
