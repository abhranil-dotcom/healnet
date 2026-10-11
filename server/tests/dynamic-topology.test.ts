import { describe, expect, it } from 'vitest';
import type { TopologySpec } from '../../shared/types.js';
import { SimulationEngine } from '../src/sim/engine.js';

const quiet = { heartbeatIntervalMs: 1000, missedThreshold: 3, trafficIntervalMs: 0 };
const route = (e: SimulationEngine) => e.activeRoute?.join('-') ?? null;

function withPreset(id: Parameters<SimulationEngine['loadPreset']>[0]) {
  const e = new SimulationEngine(quiet);
  expect(e.loadPreset(id)).toEqual({ ok: true });
  e.start();
  return e;
}

describe('dynamic topology', () => {
  it('starts on the Classic preset and reports it in the snapshot', () => {
    const s = new SimulationEngine(quiet).snapshot();
    expect(s.topology).toMatchObject({ name: 'Classic HEALNET', presetId: 'classic' });
    expect(s.topology.positions.B).toEqual({ x: 300, y: 0 });
    expect(s.flow).toEqual({ source: 'A', destination: 'C' });
    expect(s.primaryRoute).toEqual(['A', 'B', 'C']);
  });

  it('Ring: fail → detect → reroute the other way round', () => {
    const e = withPreset('ring');
    expect(route(e)).toBe('A-B-C-D');
    expect(e.snapshot().routing.activeRouteCost).toBe(600);
    e.advance(500);
    e.failNode('B');
    e.advance(2500);
    expect(e.nodes.get('B')!.status).toBe('FAILED');
    expect(route(e)).toBe('A-F-E-D');
    expect(e.recoveries).toHaveLength(1);
    expect(e.recoveries[0]).toMatchObject({ cause: 'Node B', recoveryMs: 2500, oldRoute: ['A', 'B', 'C', 'D'], newRoute: ['A', 'F', 'E', 'D'] });
    e.sendPacket('TEST');
    e.advance(2000);
    expect(e.packets.at(-1)).toMatchObject({ state: 'DELIVERED', delayMs: 900 });
  });

  it('Mesh: fail → detect → reroute, with deterministic choice among equal paths', () => {
    for (const alg of ['BFS', 'DIJKSTRA'] as const) {
      const e = withPreset('mesh');
      e.setConfig({ routingAlgorithm: alg });
      expect(route(e)).toBe('A-B-C-F-I');
      e.advance(500);
      e.disconnectLink('B-C');
      e.advance(2500);
      expect(route(e)).toBe('A-B-E-F-I');
      expect(e.recoveries[0]).toMatchObject({ cause: 'Link B-C', recoveryMs: 2500, algorithm: alg });
    }
  });

  it('Star: losing the hub leaves no route', () => {
    const e = withPreset('star');
    expect(route(e)).toBe('A-H-C');
    e.advance(500);
    e.failNode('H');
    e.advance(2500);
    expect(e.activeRoute).toBeNull();
    expect(e.systemStatus()).toBe('UNAVAILABLE');
    expect(e.recoveries).toHaveLength(0);
  });

  it('Trap: primary route depends on the algorithm', () => {
    const e = withPreset('trap');
    expect(e.primaryRoute).toEqual(['A', 'B', 'C']);
    e.setConfig({ routingAlgorithm: 'DIJKSTRA' });
    expect(e.primaryRoute).toEqual(['A', 'D', 'E', 'C']);
    expect(route(e)).toBe('A-D-E-C');
  });

  it('loading a topology clears packets in flight, metrics and time', () => {
    const e = new SimulationEngine(quiet);
    e.start();
    e.sendPacket('TEST');
    e.advance(100);
    expect(e.inFlightCount).toBe(1);
    expect(e.loadPreset('ring').ok).toBe(true);
    expect(e.inFlightCount).toBe(0);
    expect(e.packets).toEqual([]);
    expect(e.now).toBe(0);
    expect(e.running).toBe(false);
    expect(e.getMetrics()).toMatchObject({ sent: 0, delivered: 0, lost: 0 });
    e.start();
    e.advance(5000); // stale events of the old network must not fire
    expect(e.getMetrics()).toMatchObject({ sent: 0, delivered: 0, lost: 0 });
    expect(e.events.some((ev) => ev.message.startsWith('Topology loaded: Ring'))).toBe(true);
  });

  it('loads a custom topology and lays out nodes without positions', () => {
    const spec: TopologySpec = {
      name: 'Line',
      nodes: [{ id: 'S', x: 0, y: 0 }, { id: 'M' }, { id: 'T' }],
      links: [{ a: 'S', b: 'M', latencyMs: 0 }, { a: 'M', b: 'T', latencyMs: 50 }],
      source: 'S',
      destination: 'T',
    };
    const e = new SimulationEngine(quiet);
    expect(e.loadTopology(spec)).toEqual({ ok: true });
    const s = e.snapshot();
    expect(s.topology).toMatchObject({ name: 'Line', presetId: null });
    expect(s.topology.positions.S).toEqual({ x: 0, y: 0 });
    expect(Object.keys(s.topology.positions).sort()).toEqual(['M', 'S', 'T']);
    expect(s.links.map((l) => l.id)).toEqual(['M-S', 'M-T']);
    // A zero-latency hop delivers correctly.
    e.start();
    e.sendPacket('TEST');
    e.advance(100);
    expect(e.packets[0]).toMatchObject({ state: 'DELIVERED', path: ['S', 'M', 'T'], delayMs: 50 });
  });

  it('rejects an invalid topology and leaves the running simulation untouched', () => {
    const e = new SimulationEngine(quiet);
    e.start();
    e.advance(1500);
    const r = e.loadTopology({ nodes: [{ id: 'A' }], links: [], source: 'A', destination: 'A' });
    expect(r.ok).toBe(false);
    expect(e.now).toBe(1500);
    expect(e.running).toBe(true);
    expect(e.presetId).toBe('classic');
  });

  it('rejects unknown presets', () => {
    expect(new SimulationEngine(quiet).loadPreset('nope').ok).toBe(false);
  });

  it('setFlow changes source/destination with a reset and validates input', () => {
    const e = new SimulationEngine(quiet);
    e.start();
    e.advance(1000);
    expect(e.setFlow('A', 'D')).toEqual({ ok: true });
    expect(e.now).toBe(0);
    expect(route(e)).toBe('A-D');
    expect(e.primaryRoute).toEqual(['A', 'D']);
    expect(e.snapshot().flow).toEqual({ source: 'A', destination: 'D' });
    expect(e.setFlow('A', 'Z').ok).toBe(false);
    expect(e.setFlow('B', 'B').ok).toBe(false);
    expect(e.setFlow(1, 'B').ok).toBe(false);
  });

  it('structural changes are refused while the demo runs', () => {
    const e = new SimulationEngine();
    e.runDemo();
    expect(e.loadPreset('ring').ok).toBe(false);
    expect(e.loadTopology({}).ok).toBe(false);
    expect(e.setFlow('A', 'D').ok).toBe(false);
  });

  it('commands work through execute()', () => {
    const e = new SimulationEngine(quiet);
    expect(e.execute({ type: 'loadPreset', presetId: 'trap' }).ok).toBe(true);
    expect(e.execute({ type: 'setFlow', source: 'B', destination: 'E' }).ok).toBe(true);
    expect(e.execute({ type: 'loadTopology', topology: { nodes: [], links: [], source: 'A', destination: 'B' } }).ok).toBe(false);
  });
});

describe('demo stays pinned to Classic', () => {
  it('reloads Classic before running from another preset and reproduces the baseline', () => {
    const e = new SimulationEngine({ routingAlgorithm: 'DIJKSTRA' });
    e.loadPreset('ring');
    e.runDemo();
    expect(e.presetId).toBe('classic');
    expect(e.events.some((ev) => ev.message === 'Classic HEALNET preset loaded for the demo')).toBe(true);
    for (let i = 0; i < 2000 && e.demo!.running; i++) e.advance(50);
    const m = e.getMetrics();
    expect([m.sent, m.delivered, m.lost, m.crcRejected]).toEqual([16, 11, 5, 0]);
    expect(m.lastRecovery).toMatchObject({ recoveryMs: 2400, detectionMs: 2400, algorithm: 'BFS' });
    expect(e.config.routingAlgorithm).toBe('DIJKSTRA');
  });

  it('reloads Classic when only the flow was changed', () => {
    const e = new SimulationEngine();
    e.setFlow('A', 'D');
    e.runDemo();
    expect(e.flow).toEqual({ source: 'A', destination: 'C' });
    for (let i = 0; i < 2000 && e.demo!.running; i++) e.advance(50);
    expect(e.getMetrics().lastRecovery?.recoveryMs).toBe(2400);
  });
});
